/**
 * Airport index for snapping aircraft positions (runtime-neutral: Node CLI and Workers).
 *
 * Kept: OurAirports large and medium airports, and small airports with an open runway >= 4000 ft.
 * Records are built from airports.csv + runways.csv by `buildAirportRecords` (Node), stored as a
 * compact JSON array, and loaded with `Airports.fromRecords` (both runtimes).
 */
import tzlookup from 'tz-lookup';
import { parseCsvObjects } from '../csv';
import { inRegion } from '../region';

export interface Airport {
	ident: string;
	name: string;
	city: string;
	isoRegion: string;
	lat: number;
	lon: number;
	elev: number;
	region: boolean;
	/** 0 large, 1 medium, 2 small */
	rank: number;
	/** longest open paved runway, ft */
	pavedFt: number;
	tz: string;
}

/** [ident, name, city, iso_region, lat, lon, elev_ft, rank, paved_ft] */
export type AirportRecord = [string, string, string, string, number, number, number, number, number];

export const MIN_RUNWAY_FT = 4000;
const PAVED = /ASP|CON|PEM|BIT|TAR|PAV|TRTD|SEAL|PER/i;

export function nm(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const r = Math.PI / 180;
	const p1 = lat1 * r,
		p2 = lat2 * r;
	const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
	return 2 * 3440.065 * Math.asin(Math.sqrt(a));
}

/** Filter OurAirports CSVs down to airports a large-cabin jet can use. */
export function buildAirportRecords(airportsCsv: string, runwaysCsv: string): AirportRecord[] {
	const longest = new Map<string, number>();
	const paved = new Map<string, number>();
	for (const r of parseCsvObjects(runwaysCsv)) {
		if (r.closed === '1' || !r.length_ft) continue;
		const len = Number(r.length_ft);
		longest.set(r.airport_ref, Math.max(longest.get(r.airport_ref) ?? 0, len));
		if (PAVED.test(r.surface)) paved.set(r.airport_ref, Math.max(paved.get(r.airport_ref) ?? 0, len));
	}
	const out: AirportRecord[] = [];
	for (const r of parseCsvObjects(airportsCsv)) {
		if (!['large_airport', 'medium_airport', 'small_airport'].includes(r.type)) continue;
		if (r.type === 'small_airport' && (longest.get(r.id) ?? 0) < MIN_RUNWAY_FT) continue;
		out.push([
			r.icao_code || r.gps_code || r.ident,
			r.name,
			r.municipality,
			r.iso_region,
			Math.round(Number(r.latitude_deg) * 1e5) / 1e5,
			Math.round(Number(r.longitude_deg) * 1e5) / 1e5,
			Number(r.elevation_ft || 0),
			r.type === 'large_airport' ? 0 : r.type === 'medium_airport' ? 1 : 2,
			paved.get(r.id) ?? 0
		]);
	}
	return out;
}

export class Airports {
	byIdent = new Map<string, Airport>();
	private grid = new Map<string, Airport[]>();

	static fromRecords(records: AirportRecord[]): Airports {
		const ap = new Airports();
		for (const [ident, name, city, isoRegion, lat, lon, elev, rank, pavedFt] of records) {
			const a: Airport = { ident, name, city, isoRegion, lat, lon, elev, rank, pavedFt, region: inRegion(isoRegion, lat, lon), tz: '' };
			ap.byIdent.set(ident, a);
			const k = `${Math.floor(lat)},${Math.floor(lon)}`;
			if (!ap.grid.has(k)) ap.grid.set(k, []);
			ap.grid.get(k)!.push(a);
		}
		return ap;
	}

	near(lat: number, lon: number, radiusNm: number): [number, Airport][] {
		const out: [number, Airport][] = [];
		const la = Math.floor(lat),
			lo = Math.floor(lon);
		for (let i = -1; i <= 1; i++)
			for (let j = -1; j <= 1; j++)
				for (const a of this.grid.get(`${la + i},${lo + j}`) ?? []) {
					const d = nm(lat, lon, a.lat, a.lon);
					if (d <= radiusNm) out.push([d, a]);
				}
		return out.sort((x, y) => x[0] - y[0]);
	}

	tz(a: Airport): string {
		if (!a.tz) a.tz = tzlookup(a.lat, a.lon);
		return a.tz;
	}
}
