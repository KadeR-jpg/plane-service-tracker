import { beforeAll, describe, expect, it } from 'vitest';
import { Airports } from './airports.ts';
import { scoreAircraft, type Pt } from './analyze.ts';
import { epochAtLocal, localDate } from './tz.ts';

let ap: Airports;
beforeAll(async () => {
	ap = await Airports.load('data');
}, 60_000);

const T = (iso: string) => Date.parse(iso) / 1000;
// KBZN Bozeman 45.7775,-111.1530 elev ~4473; KSLC 40.7884,-111.9778 elev ~4227
const BZN: [number, number] = [45.7775, -111.153];
const SLC: [number, number] = [40.7884, -111.9778];

function ground(t: number, [lat, lon]: [number, number]): Pt {
	return [t, lat, lon, 'ground', 5];
}
function air(t: number, lat: number, lon: number, alt: number): Pt {
	return [t, lat, lon, alt, 250];
}

describe('tz helpers', () => {
	it('03:00 Mountain on a DST date', () => {
		expect(new Date(epochAtLocal('2026-10-15', 3, 'America/Denver') * 1000).toISOString()).toBe('2026-10-15T09:00:00.000Z');
		expect(new Date(epochAtLocal('2026-11-10', 3, 'America/Denver') * 1000).toISOString()).toBe('2026-11-10T10:00:00.000Z');
		expect(localDate(T('2026-10-15T05:00:00Z'), 'America/Los_Angeles')).toBe('2026-10-14');
	});
});

describe('region classification', () => {
	it('uses the airport rule', () => {
		expect(ap.byIdent.get('KBZN')?.region).toBe(true);
		expect(ap.byIdent.get('KSLC')?.region).toBe(true);
		expect(ap.byIdent.get('KGEG')?.region).toBe(true);
		expect(ap.byIdent.get('KSEA')?.region).toBe(false);
		expect(ap.byIdent.get('KPVU')?.region).toBe(true); // Provo 40.2N: spec rule is lat > 39.5
		expect(ap.byIdent.get('KCDC')?.region).toBe(false); // Cedar City 37.7N
		expect(ap.byIdent.get('KDEN')?.region).toBe(false);
	});
});

describe('stays and overnights', () => {
	const wStart = T('2026-10-01T00:00:00Z');
	const wEnd = T('2026-10-11T00:00:00Z');

	it('parked between two observed flights counts every night', () => {
		const pts: Pt[] = [
			air(T('2026-10-02T17:50:00Z'), 45.6, -111.2, 7000),
			ground(T('2026-10-02T18:00:00Z'), BZN),
			ground(T('2026-10-02T18:05:00Z'), BZN),
			// departs Oct 6
			ground(T('2026-10-06T15:00:00Z'), BZN),
			air(T('2026-10-06T15:02:00Z'), 45.8, -111.0, 6500)
		];
		const { score, nights, landings } = scoreAircraft('a00001', pts, ap, wStart, wEnd);
		expect([...nights.keys()]).toEqual(['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
		expect([...nights.values()].every((a) => a.ident === 'KBZN')).toBe(true);
		expect(score.region_share).toBe(1);
		expect(landings.length).toBe(1);
	});

	it('infers a landing from a low track that ends near an airport', () => {
		const pts: Pt[] = [
			air(T('2026-10-03T20:00:00Z'), 41.5, -112.0, 15000),
			air(T('2026-10-03T20:10:00Z'), 40.85, -111.98, 6500), // ~4 NM N of SLC, ~2300 ft AGL
			// next seen departing SLC two days later
			air(T('2026-10-05T16:00:00Z'), 40.85, -111.98, 6200),
			air(T('2026-10-05T16:05:00Z'), 41.3, -112.2, 14000)
		];
		const { nights, landings } = scoreAircraft('a00002', pts, ap, wStart, wEnd);
		expect(landings[0].airport.ident).toBe('KSLC');
		expect(landings[0].inferred).toBe(true);
		expect([...nights.keys()]).toEqual(['2026-10-03', '2026-10-04']);
	});

	it('caps a stay whose departure was not seen', () => {
		const pts: Pt[] = [
			air(T('2026-10-02T17:50:00Z'), 45.6, -111.2, 7000),
			ground(T('2026-10-02T18:00:00Z'), BZN),
			// next seen 5 days later over Texas
			air(T('2026-10-07T18:00:00Z'), 31.0, -97.0, 39000)
		];
		const { nights } = scoreAircraft('a00003', pts, ap, wStart, wEnd);
		expect([...nights.keys()]).toEqual(['2026-10-02']); // 36 h cap ends before 03:00 on Oct 4
	});

	it('valley approach snaps to the paved airport, not a nearby grass strip', () => {
		// track into Sun Valley lost ~5 NM south of KSUN; Sluder Airstrip (ID16, gravel) is closer
		const pts: Pt[] = [
			air(T('2026-10-03T20:00:00Z'), 43.2, -114.2, 14000),
			air(T('2026-10-03T20:10:00Z'), 43.42, -114.28, 8500),
			air(T('2026-10-05T16:00:00Z'), 43.42, -114.28, 8600),
			air(T('2026-10-05T16:05:00Z'), 43.2, -114.1, 15000)
		];
		const { landings } = scoreAircraft('a00005', pts, ap, wStart, wEnd);
		expect(landings[0].airport.ident).toBe('KSUN');
	});

	it('mid-cruise gaps are not landings', () => {
		const pts: Pt[] = [
			air(T('2026-10-02T17:00:00Z'), ...SLC, 39000),
			air(T('2026-10-02T18:00:00Z'), ...BZN, 41000)
		];
		const { landings } = scoreAircraft('a00004', pts, ap, wStart, wEnd);
		expect(landings.length).toBe(0);
	});
});
