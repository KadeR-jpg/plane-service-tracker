/**
 * Ingest CLI: run locally, pushes results to the app's D1 database via wrangler.
 *
 *   npm run ingest -- fetch [--days 90] [--end YYYY-MM-DD] [--local]
 *   npm run ingest -- score [--local] [--dry-run]
 *   npm run ingest -- run   [--days 90] [--local]          (fetch + score)
 *   npm run ingest -- import-candidates <file.xlsx|csv> [--local]   (replace the candidate list)
 *
 * Candidate hexes are read from D1 (uploaded in the app). `--candidates file.csv` overrides that.
 * Default target is the remote (deployed) D1; `--local` uses wrangler's local dev database.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { readSheet } from 'read-excel-file/node';
import { candidatesFromCsvRows, cellsToStrings, normalizeCandidates } from '../../src/lib/candidates.ts';
import { parseCsv } from '../../src/lib/csv.ts';
import { Airports } from './airports.ts';
import { scoreAircraft, type Pt } from './analyze.ts';
import { executeFile, inserts, query, type Target } from './d1.ts';
import { availableDays, dayDone, fetchDay, log } from './fetch.ts';
import { addDays } from './tz.ts';

const { values: opt, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		days: { type: 'string', default: '90' },
		end: { type: 'string' },
		local: { type: 'boolean', default: false },
		candidates: { type: 'string' },
		traces: { type: 'string', default: 'traces' },
		data: { type: 'string', default: 'data' },
		'dry-run': { type: 'boolean', default: false }
	}
});
const target: Target = opt.local ? '--local' : '--remote';
const cmd = positionals[0] ?? 'run';

async function readCandidateFile(file: string) {
	const rows = file.toLowerCase().endsWith('.xlsx')
		? cellsToStrings(await readSheet(file))
		: parseCsv(readFileSync(file, 'utf8'));
	return normalizeCandidates(candidatesFromCsvRows(rows));
}

async function loadHexes(): Promise<Set<string>> {
	if (opt.candidates) return new Set((await readCandidateFile(opt.candidates)).rows.map((r) => r.hex));
	return new Set(query<{ hex: string }>('SELECT hex FROM candidates', target).map((r) => r.hex));
}

function windowDays(): string[] {
	const now = new Date();
	const y = now.getUTCFullYear();
	const avail = new Set([...availableDays(y), ...availableDays(y - 1)]);
	if (!avail.size) throw new Error('could not list adsb.lol release tags (git ls-remote failed)');
	const end = opt.end ?? [...avail].sort().at(-1)!;
	const n = Number(opt.days);
	const want: string[] = [];
	for (let i = n - 1; i >= 0; i--) {
		const d = addDays(end, -i);
		if (avail.has(d)) want.push(d);
	}
	return want;
}

async function cmdFetch(hexes: Set<string>) {
	if (!hexes.size) throw new Error('no candidates: upload the list in the app first (or pass --candidates)');
	const days = windowDays();
	log(`fetch: ${hexes.size} candidate hexes, window ${days[0]} .. ${days.at(-1)} (${days.length} days)`);
	for (const day of days) {
		if (dayDone(opt.traces!, day, hexes)) continue;
		for (let attempt = 1; ; attempt++) {
			try {
				await fetchDay(day, opt.traces!, hexes);
				break;
			} catch (e) {
				log(`${day} FAILED attempt ${attempt}: ${(e as Error).message}`);
				if (attempt >= 3) break;
				await new Promise((r) => setTimeout(r, 5000 * attempt));
			}
		}
	}
	log('fetch complete');
}

async function cmdScore(hexes: Set<string>) {
	const days = existsSync(opt.traces!)
		? readdirSync(opt.traces!)
				.filter((d) => existsSync(`${opt.traces}/${d}/.done`))
				.sort()
		: [];
	if (!days.length) throw new Error('no fetched days; run `fetch` first');
	const end = opt.end ?? days.at(-1)!;
	const start = addDays(end, -(Number(opt.days) - 1));
	const use = days.filter((d) => d >= start && d <= end);
	if (!use.length) throw new Error('no fetched days in window; run `fetch` first');
	const wStart = Date.parse(`${use[0]}T00:00:00Z`) / 1000;
	const wEnd = Date.parse(`${addDays(use.at(-1)!, 1)}T00:00:00Z`) / 1000;

	const ap = await Airports.load(opt.data);
	const pts = new Map<string, Pt[]>();
	const meta = new Map<string, { r?: string; t?: string }>();
	for (const day of use)
		for (const f of readdirSync(`${opt.traces}/${day}`)) {
			if (!f.endsWith('.json')) continue;
			const hex = f.slice(0, -5);
			if (!hexes.has(hex)) continue;
			const d = JSON.parse(readFileSync(`${opt.traces}/${day}/${f}`, 'utf8'));
			if (!pts.has(hex)) pts.set(hex, []);
			pts.get(hex)!.push(...(d.pts as Pt[]));
			meta.set(hex, { r: d.r, t: d.t });
		}

	const scoreRows: unknown[][] = [];
	const nightRows: unknown[][] = [];
	const landRows: unknown[][] = [];
	const usedAirports = new Set<string>();
	const fetched = new Set(use);
	for (const [hex, p] of pts) {
		const { score: s, nights, landings } = scoreAircraft(hex, p, ap, wStart, wEnd, fetched);
		const m = meta.get(hex) ?? {};
		scoreRows.push([
			hex, s.first_seen, s.last_seen, m.r ?? null, m.t ?? null, s.top_airport, s.top_airport_share,
			s.nights_observed, s.nights_in_region, s.region_share, s.landings_in_region, s.landings_total,
			s.top_region_airport
		]);
		for (const [night, a] of nights) {
			nightRows.push([hex, night, a.ident, a.region ? 1 : 0]);
			usedAirports.add(a.ident);
		}
		for (const l of landings) {
			landRows.push([hex, Math.round(l.a), l.airport.ident, l.airport.region ? 1 : 0, l.inferred ? 1 : 0]);
			usedAirports.add(l.airport.ident);
		}
	}
	const airportRows = [...usedAirports].map((id) => {
		const a = ap.byIdent.get(id)!;
		return [a.ident, a.name, a.city, a.isoRegion, a.lat, a.lon, a.region ? 1 : 0];
	});

	const sql = [
		'DELETE FROM scores;',
		'DELETE FROM overnights;',
		'DELETE FROM landings;',
		'DELETE FROM airports;',
		...inserts('airports', ['ident', 'name', 'city', 'iso_region', 'lat', 'lon', 'in_region'], airportRows),
		...inserts(
			'scores',
			['hex', 'first_seen', 'last_seen', 'adsb_registration', 'adsb_type', 'top_airport', 'top_airport_share',
				'nights_observed', 'nights_in_region', 'region_share', 'landings_in_region', 'landings_total',
				'top_region_airport'],
			scoreRows
		),
		...inserts('overnights', ['hex', 'night', 'airport', 'in_region'], nightRows),
		...inserts('landings', ['hex', 't', 'airport', 'in_region', 'inferred'], landRows),
		...inserts(
			'ingest_runs',
			['window_start', 'window_end', 'days', 'candidates', 'aircraft_seen', 'finished_at'],
			[[use[0], use.at(-1), use.length, hexes.size, pts.size, new Date().toISOString()]]
		)
	].join('\n');
	mkdirSync('ingest-out', { recursive: true });
	writeFileSync('ingest-out/push.sql', sql + '\n');
	log(
		`score: window ${use[0]} .. ${use.at(-1)} (${use.length} days), ${pts.size}/${hexes.size} aircraft seen, ` +
			`${nightRows.length} overnights, ${landRows.length} landings -> ingest-out/push.sql`
	);
	if (opt['dry-run']) return;
	executeFile('ingest-out/push.sql', target);
	log(`pushed to D1 (${target.slice(2)})`);
}

async function cmdImportCandidates(file: string | undefined) {
	if (!file) throw new Error('usage: import-candidates <file.xlsx|csv>');
	const { rows, dropped, duplicates } = await readCandidateFile(file);
	if (!rows.length) throw new Error('no rows with a valid hex (check the header row)');
	const now = new Date().toISOString();
	const sql = [
		'DELETE FROM candidates;',
		...inserts(
			'candidates',
			['hex', 'registration', 'model', 'registered_owner', 'owner_city', 'owner_state', 'uploaded_at'],
			rows.map((r) => [r.hex, r.registration, r.model, r.registered_owner, r.owner_city, r.owner_state, now])
		)
	].join('\n');
	mkdirSync('ingest-out', { recursive: true });
	writeFileSync('ingest-out/candidates.sql', sql + '\n');
	log(`import-candidates: ${rows.length} candidates (${dropped} without hex dropped, ${duplicates} duplicates)`);
	if (opt['dry-run']) return;
	executeFile('ingest-out/candidates.sql', target);
	log(`candidates written to D1 (${target.slice(2)})`);
}

if (cmd === 'import-candidates') {
	await cmdImportCandidates(positionals[1]);
	process.exit(0);
}
const hexes = await loadHexes();
if (cmd === 'fetch') await cmdFetch(hexes);
else if (cmd === 'score') await cmdScore(hexes);
else if (cmd === 'run') {
	await cmdFetch(hexes);
	await cmdScore(hexes);
} else {
	console.error(`unknown command ${cmd}; use fetch | score | run | import-candidates`);
	process.exit(1);
}
