import { error } from '@sveltejs/kit';

export function db(platform: App.Platform | undefined): D1Database {
	const d = platform?.env?.DB;
	if (!d) error(500, 'D1 binding DB is not configured');
	return d;
}

export interface ResultRow {
	registration: string;
	hex: string;
	model: string;
	registered_owner: string;
	owner_city_state: string;
	top_airport: string | null;
	top_airport_share: number;
	nights_observed: number;
	nights_in_region: number;
	region_share: number;
	landings_in_region: number;
	first_seen: string | null;
	last_seen: string | null;
	landings_total: number;
	top_region_airport: string | null;
	adsb_registration: string | null;
	adsb_type: string | null;
}

export const RESULT_FIELDS = [
	'registration', 'hex', 'model', 'registered_owner', 'owner_city_state', 'top_airport', 'top_airport_share',
	'nights_observed', 'nights_in_region', 'region_share', 'landings_in_region', 'first_seen', 'last_seen'
] as const;

/** Every candidate with its score, sorted by region_share then nights_observed. */
export async function results(d: D1Database): Promise<ResultRow[]> {
	const { results } = await d
		.prepare(
			`SELECT c.registration, c.hex, c.model, c.registered_owner,
			        TRIM(c.owner_city || CASE WHEN c.owner_city != '' AND c.owner_state != '' THEN ', ' ELSE '' END || c.owner_state) AS owner_city_state,
			        s.top_airport, COALESCE(s.top_airport_share, 0) AS top_airport_share,
			        COALESCE(s.nights_observed, 0) AS nights_observed, COALESCE(s.nights_in_region, 0) AS nights_in_region,
			        COALESCE(s.region_share, 0) AS region_share, COALESCE(s.landings_in_region, 0) AS landings_in_region,
			        s.first_seen, s.last_seen, COALESCE(s.landings_total, 0) AS landings_total, s.top_region_airport,
			        s.adsb_registration, s.adsb_type
			   FROM candidates c LEFT JOIN scores s ON s.hex = c.hex
			  ORDER BY region_share DESC, nights_observed DESC, landings_in_region DESC, c.registration`
		)
		.all<ResultRow>();
	return results;
}

export interface AirportCount {
	ident: string;
	name: string;
	city: string;
	iso_region: string;
	aircraft: number;
	overnights: number;
	landings: number;
}

/** In-region airports with overnight and landing totals. */
export async function regionAirportCounts(d: D1Database): Promise<AirportCount[]> {
	const { results } = await d
		.prepare(
			`SELECT a.ident, a.name, a.city, a.iso_region,
			        (SELECT COUNT(DISTINCT hex) FROM overnights o WHERE o.airport = a.ident) AS aircraft,
			        (SELECT COUNT(*) FROM overnights o WHERE o.airport = a.ident) AS overnights,
			        (SELECT COUNT(*) FROM landings l WHERE l.airport = a.ident) AS landings
			   FROM airports a WHERE a.in_region = 1
			  ORDER BY overnights DESC, landings DESC`
		)
		.all<AirportCount>();
	return results;
}

/** hex -> "IDENT:<nights>n/<landings>l ..." for in-region airports. */
export async function regionAirportsByHex(d: D1Database): Promise<Map<string, string>> {
	const { results } = await d
		.prepare(
			`SELECT hex, airport, SUM(n) AS n, SUM(l) AS l FROM (
			   SELECT hex, airport, COUNT(*) AS n, 0 AS l FROM overnights WHERE in_region = 1 GROUP BY hex, airport
			   UNION ALL
			   SELECT hex, airport, 0, COUNT(*) FROM landings WHERE in_region = 1 GROUP BY hex, airport
			 ) GROUP BY hex, airport ORDER BY hex, n DESC, l DESC`
		)
		.all<{ hex: string; airport: string; n: number; l: number }>();
	const m = new Map<string, string>();
	for (const r of results) m.set(r.hex, ((m.get(r.hex) ?? '') + ` ${r.airport}:${r.n}n/${r.l}l`).trim());
	return m;
}

export interface IngestRun {
	window_start: string;
	window_end: string;
	days: number;
	candidates: number;
	aircraft_seen: number;
	finished_at: string;
}

export async function lastRun(d: D1Database): Promise<IngestRun | null> {
	return d.prepare('SELECT * FROM ingest_runs ORDER BY id DESC LIMIT 1').first<IngestRun>();
}

export async function airportNames(d: D1Database): Promise<Map<string, { name: string; city: string; iso_region: string }>> {
	const { results } = await d
		.prepare('SELECT ident, name, city, iso_region FROM airports')
		.all<{ ident: string; name: string; city: string; iso_region: string }>();
	return new Map(results.map((r) => [r.ident, r]));
}

export function thresholds(url: URL) {
	const share = Number(url.searchParams.get('minShare') ?? 0.5);
	const nights = Number(url.searchParams.get('minNights') ?? 10);
	return {
		minShare: Number.isFinite(share) ? share : 0.5,
		minNights: Number.isFinite(nights) ? nights : 10
	};
}

export function classify(rows: ResultRow[], minShare: number, minNights: number) {
	const based = rows.filter((r) => r.region_share >= minShare && r.nights_observed >= minNights);
	const basedSet = new Set(based.map((r) => r.hex));
	const active = rows.filter((r) => r.nights_in_region > 0 || r.landings_in_region > 0);
	const visitors = active
		.filter((r) => !basedSet.has(r.hex) && r.landings_in_region >= 3)
		.sort((a, b) => b.landings_in_region - a.landings_in_region || b.nights_in_region - a.nights_in_region);
	return { based, active, visitors, seen: rows.filter((r) => r.first_seen).length };
}
