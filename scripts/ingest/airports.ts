import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import tzlookup from 'tz-lookup';
import { parseCsvObjects } from '../../src/lib/csv.ts';
import { inRegion } from '../../src/lib/region.ts';

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
	tz: string;
}

const SRC = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main';
export const MIN_RUNWAY_FT = 4000;

export function nm(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const r = Math.PI / 180;
	const p1 = lat1 * r,
		p2 = lat2 * r;
	const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
	return 2 * 3440.065 * Math.asin(Math.sqrt(a));
}

async function ensure(file: string, dir: string): Promise<string> {
	const path = `${dir}/${file}`;
	if (!existsSync(path)) {
		mkdirSync(dir, { recursive: true });
		const res = await fetch(`${SRC}/${file}`);
		if (!res.ok) throw new Error(`download ${file}: HTTP ${res.status}`);
		writeFileSync(path, await res.text());
	}
	return readFileSync(path, 'utf8');
}

/** Airports usable by a large-cabin jet: large/medium, or small with an open runway >= 4000 ft. */
export class Airports {
	byIdent = new Map<string, Airport>();
	private grid = new Map<string, Airport[]>();

	static async load(dir = 'data'): Promise<Airports> {
		const ap = new Airports();
		const longest = new Map<string, number>();
		for (const r of parseCsvObjects(await ensure('runways.csv', dir))) {
			if (r.closed === '1' || !r.length_ft) continue;
			longest.set(r.airport_ref, Math.max(longest.get(r.airport_ref) ?? 0, Number(r.length_ft)));
		}
		for (const r of parseCsvObjects(await ensure('airports.csv', dir))) {
			if (!['large_airport', 'medium_airport', 'small_airport'].includes(r.type)) continue;
			if (r.type === 'small_airport' && (longest.get(r.id) ?? 0) < MIN_RUNWAY_FT) continue;
			const lat = Number(r.latitude_deg),
				lon = Number(r.longitude_deg);
			const a: Airport = {
				ident: r.icao_code || r.gps_code || r.ident,
				name: r.name,
				city: r.municipality,
				isoRegion: r.iso_region,
				lat,
				lon,
				elev: Number(r.elevation_ft || 0),
				region: inRegion(r.iso_region, lat, lon),
				rank: r.type === 'large_airport' ? 0 : r.type === 'medium_airport' ? 1 : 2,
				tz: ''
			};
			ap.byIdent.set(a.ident, a);
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
