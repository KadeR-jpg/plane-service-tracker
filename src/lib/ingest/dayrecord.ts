/**
 * Per aircraft-day summary, stored once per fetched day and joined at scoring time.
 *
 * A record keeps the day's first and last raw points (to apply the coverage-gap rule across day
 * boundaries exactly as the all-points path does) and the day's items, condensed:
 *  - consecutive 'at' items at the same airport -> first and last (buildStays only uses those)
 *  - consecutive 'air' items spanning >= 10 min -> first and last; shorter runs are kept whole so the
 *    taxi-blip check (which looks for a return to the same field within 5 min) sees the same items.
 * scoreFromRecords(records) returns the same result as scoreAircraft(all points of those days).
 */
import { Airports } from './airports';
import { buildItems, gapItems, scoreItems, type Item, type Pt } from './analyze';

/** compact item: ['a', t, ident, inferred 0|1] | ['r', t, lat, lon] */
export type CItem = ['a', number, string, 0 | 1] | ['r', number, number, number];

export interface DayRecord {
	/** first and last point of the day */
	f: Pt;
	l: Pt;
	i: CItem[];
	/** callsigns broadcast that day, with point counts */
	cs?: Record<string, number>;
}

const AIR_KEEP_ALL_S = 600;

export function condense(items: Item[]): Item[] {
	const out: Item[] = [];
	let i = 0;
	while (i < items.length) {
		const it = items[i];
		let j = i + 1;
		if (it.k === 'at') {
			while (j < items.length && items[j].k === 'at' && (items[j] as typeof it).a === it.a) j++;
		} else {
			while (j < items.length && items[j].k === 'air') j++;
		}
		const run = items.slice(i, j);
		if (run.length <= 2 || (it.k === 'air' && run[run.length - 1].t - it.t < AIR_KEEP_ALL_S)) out.push(...run);
		else out.push(run[0], run[run.length - 1]);
		i = j;
	}
	return out;
}

const toC = (it: Item): CItem => (it.k === 'at' ? ['a', it.t, it.a.ident, it.inferred ? 1 : 0] : ['r', it.t, it.lat, it.lon]);

function fromC(c: CItem, ap: Airports): Item | null {
	if (c[0] === 'r') return { k: 'air', t: c[1], lat: c[2], lon: c[3] };
	const a = ap.byIdent.get(c[2]);
	return a ? { k: 'at', t: c[1], a, inferred: c[3] === 1 } : null;
}

/** Build the record for one aircraft-day from its (time-sorted) points. */
export function dayRecord(pts: Pt[], ap: Airports, cs?: Record<string, number>): DayRecord | null {
	if (!pts.length) return null;
	const rec: DayRecord = { f: pts[0], l: pts[pts.length - 1], i: condense(buildItems(pts, ap)).map(toC) };
	if (cs && Object.keys(cs).length) rec.cs = cs;
	return rec;
}

/** Score an aircraft from its day records (any order; sorted here by first point time). */
export function scoreFromRecords(
	hex: string,
	records: DayRecord[],
	ap: Airports,
	wStart: number,
	wEnd: number,
	fetchedDays?: Set<string>
) {
	const recs = [...records].sort((a, b) => a.f[0] - b.f[0]);
	const items: Item[] = [];
	let prev: Pt | null = null;
	for (const r of recs) {
		if (prev) for (const x of gapItems(prev, r.f, ap)) items.push(x);
		for (const c of r.i) {
			const it = fromC(c, ap);
			if (it) items.push(it);
		}
		prev = r.l;
	}
	return scoreItems(
		hex,
		items,
		recs.length ? recs[0].f[0] : null,
		recs.length ? recs[recs.length - 1].l[0] : null,
		ap,
		wStart,
		wEnd,
		fetchedDays
	);
}
