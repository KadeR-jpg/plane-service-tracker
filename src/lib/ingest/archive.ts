/**
 * adsb.lol globe_history daily archives (runtime-neutral: Node 18+ and Workers).
 *
 * Each day is a GitHub release on adsblol/globe_history_<year>, tag v<YYYY.MM.DD>-planes-readsb-prod-0,
 * with assets <tag>.tar.aa, .tar.ab, ... that concatenate into one tar. Traces are
 * ./traces/<last2hex>/trace_full_<hex>.json (gzip JSON, readsb format). The parts are streamed
 * through the tar reader; nothing is buffered except the matching traces.
 */
import { isGround, type Pt } from './analyze';
import { tarEntries } from './tar';

const BASE = 'https://github.com/adsblol/globe_history_{year}/releases/download/{tag}/{tag}.tar.{part}';
export const TRACE_RE = /(?:^|\/)traces\/[0-9a-f]{2}\/trace_full_([0-9a-f]{6})\.json$/;

export function partUrl(day: string, part: string): string {
	const tag = `v${day.replaceAll('-', '.')}-planes-readsb-prod-0`;
	return BASE.replace('{year}', day.slice(0, 4)).replaceAll('{tag}', tag).replace('{part}', part);
}

/** URLs of all archive parts for a day; [] if the day is not published (yet). */
export async function partUrls(day: string): Promise<string[]> {
	const urls: string[] = [];
	for (let i = 0; i < 26 * 26; i++) {
		const url = partUrl(day, String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26)));
		const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
		await res.body?.cancel();
		if (res.status === 200 || res.status === 206) urls.push(url);
		else break;
	}
	return urls;
}

async function* concatParts(urls: string[]): AsyncGenerator<Uint8Array> {
	for (const url of urls) {
		const res = await fetch(url);
		if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
		const reader = res.body.getReader();
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			yield value;
		}
	}
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
	if (data[0] !== 0x1f || data[1] !== 0x8b) return data;
	const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface RawTrace {
	icao?: string;
	r?: string;
	t?: string;
	desc?: string;
	ownOp?: string;
	timestamp?: number;
	trace?: unknown[][];
}

export interface CompactTrace {
	icao?: string;
	r?: string;
	t?: string;
	desc?: string;
	ownOp?: string;
	cs: Record<string, number>;
	pts: Pt[];
}

/** Absolute timestamps, keep [t, lat, lon, alt, gs]; thin airborne to 20 s, ground to 60 s; collect callsigns. */
export function compact(d: RawTrace): CompactTrace {
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

/**
 * Stream one day's archive and call onTrace for every trace whose hex is in `hexes`.
 * Returns the number of traces in the archive (0 means the stream was not a valid archive).
 */
export async function extractDay(
	urls: string[],
	hexes: Set<string>,
	onTrace: (hex: string, trace: CompactTrace) => void | Promise<void>
): Promise<{ seen: number; kept: number }> {
	let seen = 0,
		kept = 0;
	const want = (name: string) => {
		const m = TRACE_RE.exec(name);
		if (!m) return false;
		seen++;
		return hexes.has(m[1]);
	};
	const dec = new TextDecoder();
	for await (const entry of tarEntries(concatParts(urls), want)) {
		const hex = TRACE_RE.exec(entry.name)![1];
		const c = compact(JSON.parse(dec.decode(await gunzip(entry.data))) as RawTrace);
		if (!c.pts.length) continue;
		await onTrace(hex, c);
		kept++;
	}
	return { seen, kept };
}
