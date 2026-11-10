/**
 * Stay / overnight reconstruction for one aircraft.
 *
 *  - Ground point (alt === "ground" or gs < 40 kt) within 3 NM of an airport -> at that airport.
 *  - Coverage gap > 20 min after an airborne point that is low and close to an airport
 *    (<= 8 NM and < 3000 ft above field, or <= 20 NM and < 6000 ft) -> inferred landing there.
 *    Symmetric rule for the first airborne point after a gap -> inferred departure. Candidates are
 *    ranked by distance plus a penalty for medium (1.5 NM) and small (4 NM) airports, and must
 *    have a paved runway >= 5000 ft (valley approaches otherwise snap to private grass strips).
 *  - A stay at X runs from arrival until the first later airborne observation. If that point is
 *    > 150 NM from X (departure not seen) the stay is capped at 36 h after the last evidence at X.
 *  - Before an aircraft's first evidence / after its last, a parked stay extends at most 14 days.
 *  - Night D is assigned to X if a stay at X covers 03:00 local (airport tz) on D+1, and the UTC
 *    day containing that 03:00 was fetched (missing archive days never produce nights).
 */
import { Airports, nm, type Airport } from './airports';
import { addDays, epochAtLocal, localDate } from './tz';

/** [epoch_s, lat, lon, alt_ft | "ground" | null, gs_kt | null] */
export type Pt = [number, number, number, number | 'ground' | null, number | null];

export const GAP_S = 20 * 60;
export const CAP_S = 36 * 3600;
export const EDGE_CAP_S = 14 * 86400;
export const BRACKET_NM = 150;
export const GROUND_SNAP_NM = 3;

export function isGround(p: Pt): boolean {
	const [, , , alt, gs] = p;
	if (alt === 'ground') return true;
	return gs != null && gs < 40 && (alt == null || alt < 15000);
}

export type Item =
	| { k: 'at'; t: number; a: Airport; inferred: boolean }
	| { k: 'air'; t: number; lat: number; lon: number };

export interface Stay {
	airport: Airport;
	a: number;
	d: number;
	last: number;
	landing: boolean;
	inferred: boolean;
}

function snapGround(ap: Airports, lat: number, lon: number): Airport | null {
	const c = ap.near(lat, lon, GROUND_SNAP_NM);
	return c.length ? c[0][1] : null;
}

/** Rank penalty (NM) so an approach near a big field is not snapped to an adjacent small strip. */
const RANK_PENALTY_NM = [0, 1.5, 4];
/** Inferred landings/departures only at fields a large-cabin jet uses: paved runway >= 5000 ft. */
export const INFERRED_MIN_PAVED_FT = 5000;

export function snapLowAirborne(ap: Airports, lat: number, lon: number, alt: Pt[3]): Airport | null {
	if (typeof alt !== 'number') return null;
	let best: Airport | null = null;
	let bestScore = Infinity;
	for (const [d, a] of ap.near(lat, lon, 20)) {
		if (a.pavedFt < INFERRED_MIN_PAVED_FT) continue;
		const agl = alt - a.elev;
		if (!((d <= 8 && agl < 3000) || (d <= 20 && agl < 6000))) continue;
		const score = d + RANK_PENALTY_NM[a.rank];
		if (score < bestScore) {
			best = a;
			bestScore = score;
		}
	}
	return best;
}

/** Inferred landing / departure items for a coverage gap between consecutive points prev -> p. */
export function gapItems(prev: Pt, p: Pt, ap: Airports): Item[] {
	const out: Item[] = [];
	if (p[0] - prev[0] <= GAP_S) return out;
	if (!isGround(prev)) {
		const a = snapLowAirborne(ap, prev[1], prev[2], prev[3]);
		if (a) out.push({ k: 'at', t: prev[0] + 1, a, inferred: true });
	}
	if (!isGround(p)) {
		const a = snapLowAirborne(ap, p[1], p[2], p[3]);
		if (a) out.push({ k: 'at', t: p[0] - 1, a, inferred: true });
	}
	return out;
}

export function buildItems(pts: Pt[], ap: Airports): Item[] {
	const items: Item[] = [];
	let prev: Pt | null = null;
	for (const p of pts) {
		const [t, lat, lon] = p;
		const g = isGround(p);
		if (prev) for (const x of gapItems(prev, p, ap)) items.push(x);
		if (g) {
			const a = snapGround(ap, lat, lon);
			if (a) items.push({ k: 'at', t, a, inferred: false });
		} else items.push({ k: 'air', t, lat, lon });
		prev = p;
	}
	return items;
}

export function buildStays(items: Item[], wStart: number, wEnd: number): Stay[] {
	const stays: Stay[] = [];
	let cur: Stay | null = null;
	let seenAny = false;
	for (let i = 0; i < items.length; i++) {
		const it = items[i];
		if (it.k === 'at') {
			if (cur && cur.airport === it.a) cur.last = it.t;
			else {
				if (cur) {
					cur.d = Math.min(it.t, cur.last + CAP_S);
					stays.push(cur);
				}
				cur = {
					airport: it.a,
					a: seenAny ? it.t : Math.max(wStart, it.t - EDGE_CAP_S),
					d: 0,
					last: it.t,
					landing: seenAny,
					inferred: it.inferred
				};
			}
		} else if (cur) {
			const dist = nm(cur.airport.lat, cur.airport.lon, it.lat, it.lon);
			if (dist < GROUND_SNAP_NM) {
				// taxi blip: next 'at' item is the same field within 5 min
				let nxt: Item | undefined;
				for (let j = i + 1; j < Math.min(items.length, i + 40); j++)
					if (items[j].k === 'at') {
						nxt = items[j];
						break;
					}
				if (nxt && nxt.k === 'at' && nxt.a === cur.airport && nxt.t - it.t < 300) {
					seenAny = true;
					continue;
				}
			}
			cur.d = dist <= BRACKET_NM ? it.t : Math.min(it.t, cur.last + CAP_S);
			stays.push(cur);
			cur = null;
		}
		seenAny = true;
	}
	if (cur) {
		cur.d = Math.min(wEnd, cur.last + EDGE_CAP_S);
		stays.push(cur);
	}
	return stays;
}

/** night (evening date, YYYY-MM-DD) -> airport */
export function nightsFromStays(
	stays: Stay[],
	ap: Airports,
	wStart: number,
	wEnd: number,
	fetchedDays?: Set<string>
): Map<string, Airport> {
	const nights = new Map<string, Airport>();
	for (const s of stays) {
		const tz = ap.tz(s.airport);
		const d1 = localDate(s.d, tz);
		for (let d = addDays(localDate(s.a, tz), -1); d <= d1; d = addDays(d, 1)) {
			const cutoff = epochAtLocal(addDays(d, 1), 3, tz);
			const covered = !fetchedDays || fetchedDays.has(new Date(cutoff * 1000).toISOString().slice(0, 10));
			if (covered && s.a <= cutoff && cutoff < s.d && wStart <= cutoff && cutoff <= wEnd && !nights.has(d))
				nights.set(d, s.airport);
		}
	}
	return new Map([...nights].sort((x, y) => (x[0] < y[0] ? -1 : 1)));
}

export interface Score {
	hex: string;
	first_seen: string;
	last_seen: string;
	top_airport: string | null;
	top_airport_share: number;
	nights_observed: number;
	nights_in_region: number;
	region_share: number;
	landings_in_region: number;
	landings_total: number;
	top_region_airport: string | null;
}

export function scoreAircraft(
	hex: string,
	rawPts: Pt[],
	ap: Airports,
	wStart: number,
	wEnd: number,
	fetchedDays?: Set<string>
) {
	const byT = new Map<number, Pt>();
	for (const p of rawPts) byT.set(p[0], p);
	const pts = [...byT.values()].sort((a, b) => a[0] - b[0]);
	return scoreItems(hex, buildItems(pts, ap), pts.length ? pts[0][0] : null, pts.length ? pts[pts.length - 1][0] : null, ap, wStart, wEnd, fetchedDays);
}

/** Score from an item list (raw-point path above, or joined day records). */
export function scoreItems(
	hex: string,
	items: Item[],
	firstT: number | null,
	lastT: number | null,
	ap: Airports,
	wStart: number,
	wEnd: number,
	fetchedDays?: Set<string>
) {
	const stays = buildStays(items, wStart, wEnd);
	const nights = nightsFromStays(stays, ap, wStart, wEnd, fetchedDays);
	const landings = stays.filter((s) => s.landing);
	const cnt = new Map<string, number>();
	const reg = new Map<string, number>();
	for (const a of nights.values()) {
		cnt.set(a.ident, (cnt.get(a.ident) ?? 0) + 1);
		if (a.region) reg.set(a.ident, (reg.get(a.ident) ?? 0) + 1);
	}
	const top = [...cnt].sort((x, y) => y[1] - x[1])[0];
	const topReg = [...reg].sort((x, y) => y[1] - x[1])[0];
	const nReg = [...reg.values()].reduce((s, n) => s + n, 0);
	const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
	const round = (x: number) => Math.round(x * 1000) / 1000;
	const score: Score = {
		hex,
		first_seen: firstT != null ? day(firstT) : '',
		last_seen: lastT != null ? day(lastT) : '',
		top_airport: top?.[0] ?? null,
		top_airport_share: top ? round(top[1] / nights.size) : 0,
		nights_observed: nights.size,
		nights_in_region: nReg,
		region_share: nights.size ? round(nReg / nights.size) : 0,
		landings_in_region: landings.filter((s) => s.airport.region).length,
		landings_total: landings.length,
		top_region_airport: topReg?.[0] ?? null
	};
	return { score, nights, landings };
}
