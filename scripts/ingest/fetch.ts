/**
 * CLI cache of adsb.lol daily archives: matching traces are compacted to traces/YYYY-MM-DD/<hex>.json.
 * traces/YYYY-MM-DD/.done records the hex set used; a day is refetched only if the current candidate
 * set has hexes it lacks or the format version changed. Archive reading is shared with the worker
 * (src/lib/ingest/archive.ts).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { extractDay, partUrls } from '../../src/lib/ingest/archive.ts';

export { compact } from '../../src/lib/ingest/archive.ts';

/** Bump when the compact trace format changes; older cached days are refetched. */
export const FORMAT_VERSION = 2;

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
	const { seen, kept } = await extractDay(urls, hexes, (hex, c) => writeFileSync(`${tmp}/${hex}.json`, JSON.stringify(c)));
	if (seen === 0) throw new Error(`${day}: no traces in archive`);
	writeFileSync(`${tmp}/.done`, JSON.stringify({ v: FORMAT_VERSION, kept, seen, hexes: [...hexes].sort() }));
	rmSync(outDir, { recursive: true, force: true });
	renameSync(tmp, outDir);
	log(`${day} ok parts=${urls.length} traces_in_archive=${seen} kept=${kept} secs=${Math.round((Date.now() - t0) / 1000)}`);
	return 'ok';
}
