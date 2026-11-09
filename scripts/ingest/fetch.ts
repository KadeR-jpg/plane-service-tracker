/**
 * Stream adsb.lol globe_history daily archives and keep only target aircraft.
 *
 * Each day is a GitHub release on adsblol/globe_history_<year>, tag
 * v<YYYY.MM.DD>-planes-readsb-prod-0, with assets <tag>.tar.aa, .tar.ab, ... that concatenate
 * into one tar. Traces are ./traces/<last2hex>/trace_full_<hex>.json (gzip JSON, readsb format).
 *
 * The parts are piped from fetch() straight into a tar parser: no raw archive touches disk.
 * Matching traces are compacted to traces/YYYY-MM-DD/<hex>.json. traces/YYYY-MM-DD/.done records
 * the hex set used; a day is refetched only if the current candidate set has hexes it lacks.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { isGround, type Pt } from './analyze.ts';
import { tarEntries } from './tar.ts';

const BASE = 'https://github.com/adsblol/globe_history_{year}/releases/download/{tag}/{tag}.tar.{part}';
/** Bump when the compact trace format changes; older cached days are refetched. */
export const FORMAT_VERSION = 2;
const TRACE_RE = /(?:^|\/)traces\/[0-9a-f]{2}\/trace_full_([0-9a-f]{6})\.json$/;

export function log(msg: string, file = 'progress.log') {
	const line = `${new Date().toISOString().slice(0, 19)}Z ${msg}`;
	console.log(line);
	appendFileSync(file, line + '\n');
}

/** Dates with a prod release, read from git tags (no GitHub API needed). */
export function availableDays(year: number): Set<string> {
	let out = '';
	try {
		out = execFileSync('git', ['ls-remote', '--tags', `https://github.com/adsblol/globe_history_${year}`], {
			encoding: 'utf8',
			maxBuffer: 64 << 20
		});
	} catch {
		return new Set();
	}
	const days = new Set<string>();
	for (const m of out.matchAll(/refs\/tags\/v(\d{4})\.(\d{2})\.(\d{2})-planes-readsb-prod-0$/gm))
		days.add(`${m[1]}-${m[2]}-${m[3]}`);
	return days;
}

async function partUrls(day: string): Promise<string[]> {
	const tag = `v${day.replaceAll('-', '.')}-planes-readsb-prod-0`;
	const urls: string[] = [];
	for (let i = 0; i < 26 * 26; i++) {
		const part = String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26));
		const url = BASE.replace('{year}', day.slice(0, 4)).replaceAll('{tag}', tag).replace('{part}', part);
		const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
		await res.body?.cancel();
		if (res.status === 200 || res.status === 206) urls.push(url);
		else break;
	}
	return urls;
}

/** The parts, concatenated, as one byte stream. */
async function* concatParts(urls: string[]): AsyncGenerator<Uint8Array> {
	for (const url of urls) {
		const res = await fetch(url);
		if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
		for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) yield chunk;
	}
}

interface RawTrace {
	icao?: string;
	r?: string;
	t?: string;
	desc?: string;
	ownOp?: string;
	timestamp?: number;
	trace?: unknown[][];
}

/** Absolute timestamps, keep [t, lat, lon, alt, gs]; thin airborne to 20 s, ground to 60 s. */
export function compact(d: RawTrace) {
	const t0 = d.timestamp ?? 0;
	const pts: Pt[] = (d.trace ?? [])
		.filter((p) => p[1] != null && p[2] != null)
		.map((p) => [
			Math.round((t0 + (p[0] as number)) * 10) / 10,
			Math.round((p[1] as number) * 1e5) / 1e5,
			Math.round((p[2] as number) * 1e5) / 1e5,
			(p[3] as Pt[3]) ?? null,
			(p[4] as number | null) ?? null
		]);
	const keep: Pt[] = [];
	let lastT: number | null = null;
	for (let i = 0; i < pts.length; i++) {
		const p = pts[i];
		const g = isGround(p);
		const edge =
			i === 0 ||
			i === pts.length - 1 ||
			g !== isGround(pts[i - 1]) ||
			g !== isGround(pts[i + 1]) ||
			pts[i + 1][0] - p[0] > 60 ||
			p[0] - pts[i - 1][0] > 60;
		if (edge || lastT === null || p[0] - lastT >= (g ? 60 : 20)) {
			keep.push(p);
			lastT = p[0];
		}
	}
	// callsigns broadcast during the day (operator ICAO prefix, or the N-number), with point counts
	const cs: Record<string, number> = {};
	for (const p of d.trace ?? []) {
		const info = p[8] as { flight?: string } | null | undefined;
		const f = info?.flight?.trim();
		if (f) cs[f] = (cs[f] ?? 0) + 1;
	}
	return { icao: d.icao, r: d.r, t: d.t, desc: d.desc, ownOp: d.ownOp, cs, pts: keep };
}

export function dayDone(outRoot: string, day: string, hexes: Set<string>): boolean {
	const f = `${outRoot}/${day}/.done`;
	if (!existsSync(f)) return false;
	try {
		const done = JSON.parse(readFileSync(f, 'utf8')) as { hexes: string[]; v?: number };
		if ((done.v ?? 1) < FORMAT_VERSION) return false;
		const have = new Set(done.hexes);
		for (const h of hexes) if (!have.has(h)) return false;
		return true;
	} catch {
		return false;
	}
}

export async function fetchDay(day: string, outRoot: string, hexes: Set<string>): Promise<'ok' | 'missing'> {
	const urls = await partUrls(day);
	if (!urls.length) {
		log(`${day} no archive parts found`);
		return 'missing';
	}
	const outDir = `${outRoot}/${day}`;
	const tmp = `${outDir}.partial`;
	rmSync(tmp, { recursive: true, force: true });
	mkdirSync(tmp, { recursive: true });
	const t0 = Date.now();
	let seen = 0,
		kept = 0;
	const want = (name: string) => {
		const m = TRACE_RE.exec(name);
		if (!m) return false;
		seen++;
		return hexes.has(m[1]);
	};
	for await (const entry of tarEntries(concatParts(urls), want)) {
		const m = TRACE_RE.exec(entry.name)!;
		let buf = entry.data;
		if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
		const c = compact(JSON.parse(buf.toString('utf8')) as RawTrace);
		if (!c.pts.length) continue;
		writeFileSync(`${tmp}/${m[1]}.json`, JSON.stringify(c));
		kept++;
	}
	if (seen === 0) throw new Error(`${day}: no traces in archive`);
	writeFileSync(`${tmp}/.done`, JSON.stringify({ v: FORMAT_VERSION, kept, seen, hexes: [...hexes].sort() }));
	rmSync(outDir, { recursive: true, force: true });
	renameSync(tmp, outDir);
	log(`${day} ok parts=${urls.length} traces_in_archive=${seen} kept=${kept} secs=${Math.round((Date.now() - t0) / 1000)}`);
	return 'ok';
}
