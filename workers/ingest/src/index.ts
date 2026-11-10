/**
 * Background refresh worker: keeps the app's D1 data current with no manual steps.
 *
 * Triggers
 *  - nightly cron, a candidate-list upload, or the app's "Refresh now" button -> {k:'plan'} on the queue
 *  - Monday cron additionally refreshes the FAA Part 135 operator list
 *
 * Pipeline (all through one queue, one message per job)
 *  plan   pick the 90-day window ending at the newest published adsb.lol archive; queue a 'day' job for
 *         every day never processed, or processed before aircraft were added (only those aircraft)
 *  day    stream that day's 3-4 GB archive, keep candidate traces, store one condensed DayRecord per
 *         aircraft in day_items; the last day job to finish starts scoring
 *  score  rebuild stays / overnights / landings / callsigns / scores for a slice of aircraft from
 *         day_items; the last slice finalizes the run
 * Progress lives in refresh_runs (shown on the app's Data page).
 */
import { readSheet } from 'read-excel-file/universal';
import { Airports, type AirportRecord } from '../../../src/lib/ingest/airports';
import type { Pt } from '../../../src/lib/ingest/analyze';
import { extractDay, partUrl, partUrls } from '../../../src/lib/ingest/archive';
import { dayRecord, scoreFromRecords, type DayRecord } from '../../../src/lib/ingest/dayrecord';
import { downloadPart135, parsePart135 } from '../../../src/lib/ingest/part135';
import { addDays } from '../../../src/lib/ingest/tz';
import airportRecords from './airports.json';

export interface Env {
	DB: D1Database;
	QUEUE: Queue<Msg>;
	/** optional override of the 90-day window (testing) */
	WINDOW_DAYS?: string;
}

export type Msg =
	| { k: 'plan'; trigger: 'schedule' | 'upload' | 'manual' }
	| { k: 'day'; run: number; day: string; since: string | null; snapshot: string }
	| { k: 'score'; run: number; offset: number; limit: number }
	| { k: 'part135' };

const WINDOW_DAYS = 90;
const SCORE_SLICE = 40;
const MAX_ATTEMPTS = 3;
/** a run older than this is treated as dead (a job was lost) and a new one may start */
const STALE_RUN_MS = 6 * 3600_000;
/** bound-parameter JSON per statement (D1 caps a single value at 2 MB) */
const CHUNK_BYTES = 900_000;

let airports: Airports | null = null;
const ap = () => (airports ??= Airports.fromRecords(airportRecords as AirportRecord[]));

const now = () => new Date().toISOString();
const dayStart = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;

/** Split rows into JSON arrays under CHUNK_BYTES each. */
function jsonChunks(rows: unknown[]): string[] {
	const out: string[] = [];
	let cur: string[] = [];
	let size = 2;
	for (const r of rows) {
		const s = JSON.stringify(r);
		if (cur.length && size + s.length + 1 > CHUNK_BYTES) {
			out.push(`[${cur.join(',')}]`);
			cur = [];
			size = 2;
		}
		cur.push(s);
		size += s.length + 1;
	}
	if (cur.length) out.push(`[${cur.join(',')}]`);
	return out;
}

/** INSERT OR REPLACE rows (objects) into table via json_each, one bound parameter per statement. */
function upsertStmts(db: D1Database, table: string, cols: string[], rows: Record<string, unknown>[]): D1PreparedStatement[] {
	const sel = cols.map((c) => `json_extract(value, '$.${c}')`).join(', ');
	return jsonChunks(rows).map((j) =>
		db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) SELECT ${sel} FROM json_each(?)`).bind(j)
	);
}

async function newestArchiveDay(): Promise<string | null> {
	const today = new Date().toISOString().slice(0, 10);
	for (let back = 1; back <= 5; back++) {
		const day = addDays(today, -back);
		const res = await fetch(partUrl(day, 'aa'), { headers: { Range: 'bytes=0-0' } });
		await res.body?.cancel();
		if (res.status === 200 || res.status === 206) return day;
	}
	return null;
}

// ---------------------------------------------------------------- plan

async function plan(env: Env, trigger: string) {
	const db = env.DB;
	const active = await db
		.prepare(`SELECT id, started_at FROM refresh_runs WHERE status IN ('downloading', 'scoring') ORDER BY id DESC LIMIT 1`)
		.first<{ id: number; started_at: string }>();
	if (active && Date.now() - Date.parse(active.started_at) < STALE_RUN_MS) {
		// one run at a time; look again later so changes made meanwhile are picked up
		await env.QUEUE.send({ k: 'plan', trigger: trigger as 'manual' }, { delaySeconds: 600 });
		return;
	}
	if (active)
		await db
			.prepare(`UPDATE refresh_runs SET status = 'failed', finished_at = ?, message = 'timed out' WHERE id = ?`)
			.bind(now(), active.id)
			.run();

	const end = await newestArchiveDay();
	if (!end) throw new Error('no adsb.lol archive found for the last 5 days');
	const start = addDays(end, -((Number(env.WINDOW_DAYS) || WINDOW_DAYS) - 1));
	const snapshot = now();

	const processed = new Map(
		(await db.prepare('SELECT day, processed_at FROM ingest_days').all<{ day: string; processed_at: string }>()).results.map(
			(r) => [r.day, r.processed_at]
		)
	);
	const newestAdd = (await db.prepare('SELECT MAX(added_at) AS m FROM candidates').first<{ m: string | null }>())?.m ?? '';
	const jobs: Msg[] = [];
	for (let d = start; d <= end; d = addDays(d, 1)) {
		const at = processed.get(d);
		if (!at) jobs.push({ k: 'day', run: 0, day: d, since: null, snapshot });
		else if (newestAdd > at) jobs.push({ k: 'day', run: 0, day: d, since: at, snapshot });
	}

	// keep storage to the window
	await db.batch([
		db.prepare('DELETE FROM day_items WHERE day < ?').bind(start),
		db.prepare('DELETE FROM ingest_days WHERE day < ?').bind(start)
	]);

	const run = await db
		.prepare(
			`INSERT INTO refresh_runs (trigger, status, started_at, window_start, window_end, days_total, days_pending)
			 VALUES (?, 'downloading', ?, ?, ?, ?, ?) RETURNING id`
		)
		.bind(trigger, snapshot, start, end, jobs.length, jobs.length)
		.first<{ id: number }>();
	const runId = run!.id;
	if (!jobs.length) return startScoring(env, runId);
	for (let i = 0; i < jobs.length; i += 100)
		await env.QUEUE.sendBatch(jobs.slice(i, i + 100).map((j) => ({ body: { ...(j as Extract<Msg, { k: 'day' }>), run: runId } })));
}

// ---------------------------------------------------------------- day

async function processDay(env: Env, m: Extract<Msg, { k: 'day' }>) {
	const db = env.DB;
	const q = m.since
		? db.prepare('SELECT hex FROM candidates WHERE added_at > ? AND added_at <= ?').bind(m.since, m.snapshot)
		: db.prepare('SELECT hex FROM candidates WHERE added_at <= ? OR added_at = ?').bind(m.snapshot, '');
	const hexes = new Set((await q.all<{ hex: string }>()).results.map((r) => r.hex));
	let seen = 0,
		kept = 0;
	if (hexes.size) {
		const urls = await partUrls(m.day);
		if (!urls.length) throw new Error(`archive for ${m.day} not found`);
		const s = dayStart(m.day);
		const rows: Record<string, unknown>[] = [];
		const res = await extractDay(urls, hexes, (hex, c) => {
			// only points inside this UTC day; neighbouring days carry their own
			const pts = [...new Map(c.pts.filter((p) => p[0] >= s && p[0] < s + 86400).map((p) => [p[0], p] as [number, Pt])).values()].sort(
				(a, b) => a[0] - b[0]
			);
			const rec = dayRecord(pts, ap(), c.cs);
			if (rec) rows.push({ hex, day: m.day, data: JSON.stringify({ ...rec, r: c.r, t: c.t }) });
		});
		if (!res.seen) throw new Error(`archive for ${m.day} had no traces`);
		seen = res.seen;
		kept = rows.length;
		const stmts = upsertStmts(db, 'day_items', ['hex', 'day', 'data'], rows);
		for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
	}
	await db
		.prepare(
			`INSERT INTO ingest_days (day, processed_at, traces_seen, kept) VALUES (?1, ?2, ?3, ?4)
			 ON CONFLICT (day) DO UPDATE SET processed_at = ?2, traces_seen = MAX(traces_seen, ?3), kept = kept + ?4`
		)
		.bind(m.day, m.snapshot, seen, kept)
		.run();
}

async function dayFinished(env: Env, run: number, failed: boolean) {
	const r = await env.DB
		.prepare(
			`UPDATE refresh_runs SET days_pending = days_pending - 1, days_failed = days_failed + ? WHERE id = ? RETURNING days_pending`
		)
		.bind(failed ? 1 : 0, run)
		.first<{ days_pending: number }>();
	if (r && r.days_pending === 0) await startScoring(env, run);
}

// ---------------------------------------------------------------- score

async function startScoring(env: Env, run: number) {
	const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM candidates').first<{ n: number }>())?.n ?? 0;
	const slices = Math.max(1, Math.ceil(n / SCORE_SLICE));
	await env.DB
		.prepare(`UPDATE refresh_runs SET status = 'scoring', score_total = ?, score_pending = ? WHERE id = ?`)
		.bind(slices, slices, run)
		.run();
	const msgs = Array.from({ length: slices }, (_, i) => ({ body: { k: 'score', run, offset: i * SCORE_SLICE, limit: SCORE_SLICE } as Msg }));
	for (let i = 0; i < msgs.length; i += 100) await env.QUEUE.sendBatch(msgs.slice(i, i + 100));
}

async function scoreSlice(env: Env, m: Extract<Msg, { k: 'score' }>) {
	const db = env.DB;
	const run = await db.prepare('SELECT window_start, window_end FROM refresh_runs WHERE id = ?').bind(m.run).first<{ window_start: string; window_end: string }>();
	if (!run) return;
	const hexes = (await db.prepare('SELECT hex FROM candidates ORDER BY hex LIMIT ? OFFSET ?').bind(m.limit, m.offset).all<{ hex: string }>()).results.map(
		(r) => r.hex
	);
	if (!hexes.length) return;
	const hexJson = JSON.stringify(hexes);
	const [items, days] = await Promise.all([
		db
			.prepare('SELECT hex, day, data FROM day_items WHERE day BETWEEN ? AND ? AND hex IN (SELECT value FROM json_each(?))')
			.bind(run.window_start, run.window_end, hexJson)
			.all<{ hex: string; day: string; data: string }>(),
		db.prepare('SELECT day FROM ingest_days WHERE day BETWEEN ? AND ?').bind(run.window_start, run.window_end).all<{ day: string }>()
	]);
	const fetched = new Set(days.results.map((d) => d.day));
	const wStart = dayStart(run.window_start);
	const wEnd = dayStart(run.window_end) + 86400;
	const byHex = new Map<string, { day: string; rec: DayRecord & { r?: string; t?: string } }[]>();
	for (const row of items.results) {
		if (!byHex.has(row.hex)) byHex.set(row.hex, []);
		byHex.get(row.hex)!.push({ day: row.day, rec: JSON.parse(row.data) });
	}

	const scores: Record<string, unknown>[] = [];
	const overnights: Record<string, unknown>[] = [];
	const landings: Record<string, unknown>[] = [];
	const callsigns: Record<string, unknown>[] = [];
	const used = new Map<string, Record<string, unknown>>();
	const useAirport = (a: { ident: string; name: string; city: string; isoRegion: string; lat: number; lon: number; region: boolean }) =>
		used.set(a.ident, { ident: a.ident, name: a.name, city: a.city, iso_region: a.isoRegion, lat: a.lat, lon: a.lon, in_region: a.region ? 1 : 0 });

	for (const [hex, recs] of byHex) {
		recs.sort((a, b) => (a.day < b.day ? -1 : 1));
		const { score: s, nights, landings: lands } = scoreFromRecords(hex, recs.map((x) => x.rec), ap(), wStart, wEnd, fetched);
		const last = recs[recs.length - 1].rec;
		scores.push({ ...s, adsb_registration: last.r ?? null, adsb_type: last.t ?? null });
		for (const [night, a] of nights) {
			overnights.push({ hex, night, airport: a.ident, in_region: a.region ? 1 : 0 });
			useAirport(a);
		}
		for (const l of lands) {
			landings.push({ hex, t: Math.round(l.a), airport: l.airport.ident, in_region: l.airport.region ? 1 : 0, inferred: l.inferred ? 1 : 0 });
			useAirport(l.airport);
		}
		const cs = new Map<string, { days: number; last_day: string }>();
		for (const { day, rec } of recs)
			for (const c of Object.keys(rec.cs ?? {})) {
				const e = cs.get(c) ?? { days: 0, last_day: day };
				e.days++;
				e.last_day = day;
				cs.set(c, e);
			}
		for (const [callsign, e] of cs) callsigns.push({ hex, callsign, ...e });
	}

	const del = (t: string) => db.prepare(`DELETE FROM ${t} WHERE hex IN (SELECT value FROM json_each(?))`).bind(hexJson);
	await db.batch([
		del('scores'),
		del('overnights'),
		del('landings'),
		del('callsigns'),
		...upsertStmts(db, 'airports', ['ident', 'name', 'city', 'iso_region', 'lat', 'lon', 'in_region'], [...used.values()]),
		...upsertStmts(
			db,
			'scores',
			['hex', 'first_seen', 'last_seen', 'adsb_registration', 'adsb_type', 'top_airport', 'top_airport_share', 'nights_observed',
				'nights_in_region', 'region_share', 'landings_in_region', 'landings_total', 'top_region_airport'],
			scores
		),
		...upsertStmts(db, 'overnights', ['hex', 'night', 'airport', 'in_region'], overnights),
		...upsertStmts(db, 'landings', ['hex', 't', 'airport', 'in_region', 'inferred'], landings),
		...upsertStmts(db, 'callsigns', ['hex', 'callsign', 'days', 'last_day'], callsigns)
	]);
}

async function sliceFinished(env: Env, run: number) {
	const r = await env.DB
		.prepare('UPDATE refresh_runs SET score_pending = score_pending - 1 WHERE id = ? RETURNING score_pending')
		.bind(run)
		.first<{ score_pending: number }>();
	if (r && r.score_pending === 0) await finalize(env, run);
}

async function finalize(env: Env, run: number) {
	const db = env.DB;
	const r = await db.prepare('SELECT window_start, window_end, days_failed FROM refresh_runs WHERE id = ?').bind(run).first<{
		window_start: string;
		window_end: string;
		days_failed: number;
	}>();
	if (!r) return;
	const notListed = (t: string) => db.prepare(`DELETE FROM ${t} WHERE hex NOT IN (SELECT hex FROM candidates)`);
	const stats = await db
		.prepare(
			`SELECT (SELECT COUNT(*) FROM candidates) AS c, (SELECT COUNT(*) FROM scores) AS s,
			        (SELECT COUNT(*) FROM ingest_days WHERE day BETWEEN ?1 AND ?2) AS d`
		)
		.bind(r.window_start, r.window_end)
		.first<{ c: number; s: number; d: number }>();
	await db.batch([
		// derived rows of aircraft that were removed from the list
		notListed('scores'),
		notListed('overnights'),
		notListed('landings'),
		notListed('callsigns'),
		db
			.prepare(
				`INSERT INTO ingest_runs (window_start, window_end, days, candidates, aircraft_seen, finished_at)
				 VALUES (?, ?, ?, ?, (SELECT COUNT(*) FROM scores), ?)`
			)
			.bind(r.window_start, r.window_end, stats?.d ?? 0, stats?.c ?? 0, now()),
		db
			.prepare(`UPDATE refresh_runs SET status = 'done', finished_at = ?, message = ? WHERE id = ?`)
			.bind(now(), r.days_failed ? `${r.days_failed} day(s) could not be downloaded; they will be retried next run` : '', run)
	]);
}

// ---------------------------------------------------------------- part 135

async function refreshPart135(env: Env) {
	const sheet = await readSheet(await downloadPart135());
	const rows = parsePart135(sheet as unknown[][]);
	const regs = new Set(
		(await env.DB.prepare('SELECT UPPER(registration) AS r FROM candidates').all<{ r: string }>()).results.map((x) => x.r)
	);
	const today = now().slice(0, 10);
	const keep = rows.filter((r) => regs.has(r.registration)).map((r) => ({ ...r, list_date: today }));
	// the FAA list is a full snapshot: operators that dropped an aircraft must disappear here too
	await env.DB.batch([
		env.DB.prepare('DELETE FROM part135'),
		...upsertStmts(env.DB, 'part135', ['registration', 'operator', 'designator', 'chdo', 'cfr', 'model', 'serial', 'list_date'], keep)
	]);
}

// ---------------------------------------------------------------- job log

let logReady = false;
async function jobLog(env: Env, m: Msg, attempt: number, event: 'start' | 'done' | 'error', secs?: number, detail = '') {
	try {
		if (!logReady) {
			await env.DB.prepare(
				`CREATE TABLE IF NOT EXISTS refresh_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, run INTEGER,
				 kind TEXT NOT NULL, day TEXT, attempt INTEGER, event TEXT NOT NULL, secs REAL, detail TEXT NOT NULL DEFAULT '')`
			).run();
			logReady = true;
		}
		const run = 'run' in m ? m.run : null;
		const day = m.k === 'day' ? m.day : m.k === 'score' ? String(m.offset) : null;
		await env.DB.prepare('INSERT INTO refresh_log (ts, run, kind, day, attempt, event, secs, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
			.bind(now(), run, m.k, day, attempt, event, secs ?? null, detail.slice(0, 500))
			.run();
		if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM refresh_log WHERE ts < datetime('now', '-14 days')").run();
	} catch {
		// logging must never break a job
	}
}

// ---------------------------------------------------------------- entry points

export default {
	async scheduled(event: ScheduledController, env: Env) {
		await env.QUEUE.send({ k: 'plan', trigger: 'schedule' });
		if (new Date(event.scheduledTime).getUTCDay() === 1) await env.QUEUE.send({ k: 'part135' });
	},

	async queue(batch: MessageBatch<Msg>, env: Env) {
		for (const msg of batch.messages) {
			const m = msg.body;
			const t0 = Date.now();
			if (m.k === 'day') await jobLog(env, m, msg.attempts, 'start');
			try {
				if (m.k === 'plan') await plan(env, m.trigger);
				else if (m.k === 'day') {
					await processDay(env, m);
					await dayFinished(env, m.run, false);
				} else if (m.k === 'score') {
					await scoreSlice(env, m);
					await sliceFinished(env, m.run);
				} else if (m.k === 'part135') await refreshPart135(env);
				if (m.k !== 'score') await jobLog(env, m, msg.attempts, 'done', (Date.now() - t0) / 1000);
				msg.ack();
			} catch (err) {
				console.error(m.k, (m as { day?: string }).day ?? '', err);
				await jobLog(env, m, msg.attempts, 'error', (Date.now() - t0) / 1000, String((err as Error)?.stack ?? err));
				if (msg.attempts < MAX_ATTEMPTS) msg.retry({ delaySeconds: 60 * msg.attempts });
				else {
					// give up on this job but keep the run moving
					if (m.k === 'day') await dayFinished(env, m.run, true);
					else if (m.k === 'score') await sliceFinished(env, m.run);
					msg.ack();
				}
			}
		}
	},

	/** GET /status for a quick look; everything else 404 (the app is a separate worker) */
	async fetch(req: Request, env: Env) {
		const path = new URL(req.url).pathname;
		if (path === '/status') {
			const r = await env.DB.prepare('SELECT * FROM refresh_runs ORDER BY id DESC LIMIT 1').first();
			return Response.json(r ?? {});
		}
		if (path === '/status/log') {
			const [log, days] = await Promise.all([
				env.DB.prepare('SELECT ts, run, kind, day, attempt, event, secs, detail FROM refresh_log ORDER BY id DESC LIMIT 40')
					.all()
					.catch(() => ({ results: [] })),
				env.DB.prepare('SELECT COUNT(*) AS n, MAX(processed_at) AS last FROM ingest_days').first()
			]);
			return Response.json({ days, log: log.results });
		}
		return new Response('Not found', { status: 404 });
	}
} satisfies ExportedHandler<Env, Msg>;
