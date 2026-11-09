import {
	classify, db, lastRun, regionAirportCounts, regionAirportsByHex, results, thresholds
} from '$lib/server/db';
import type { RequestHandler } from './$types';

const cell = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|');
const pct = (x: number) => x.toFixed(2);

export const GET: RequestHandler = async ({ platform, url }) => {
	const d = db(platform);
	const { minShare, minNights } = thresholds(url);
	const [rows, airports, byHex, run] = await Promise.all([
		results(d), regionAirportCounts(d), regionAirportsByHex(d), lastRun(d)
	]);
	const { based, active, visitors, seen } = classify(rows, minShare, minNights);
	const basedAt = new Map<string, number>();
	for (const r of based) {
		const k = r.top_region_airport ?? r.top_airport ?? '';
		basedAt.set(k, (basedAt.get(k) ?? 0) + 1);
	}

	const L: string[] = ['# ULR large-cabin aircraft: regional home-base finder', ''];
	if (run) L.push(`- History window: **${run.window_start} to ${run.window_end}** (${run.days} days of adsb.lol globe_history)`);
	L.push(
		`- Candidates: **${rows.length}**; seen at least once in window: **${seen}**`,
		'- Region: US-MT, US-ID, US-WY, US-WA east of -120.5 lon, US-UT north of 39.5 lat',
		`- Aircraft with any in-region activity (overnight or landing): **${active.length}**`,
		`- Likely based (region_share >= ${minShare} and nights_observed >= ${minNights}): **${based.length}**`,
		'',
		'## Column definitions',
		'',
		'- **Nights tracked**: nights where the 3 AM local parking location is known (anywhere).',
		'- **Nights in region**: of those, nights parked at an in-region airport.',
		'- **Region share**: nights in region / nights tracked.',
		'- **Landings in region**: arrivals at in-region airports, including day trips.',
		'',
		'## Likely based in region',
		'',
		'| Registration | Hex | Model | Owner | Top overnight airport | % of nights there | Nights tracked | Nights in region | Region share | Landings in region |',
		'|---|---|---|---|---|---|---|---|---|---|'
	);
	for (const r of based)
		L.push(
			`| ${cell(r.registration)} | ${r.hex} | ${cell(r.model)} | ${cell(r.registered_owner)} | ${cell(r.top_airport)} | ` +
				`${pct(r.top_airport_share)} | ${r.nights_observed} | ${r.nights_in_region} | ${pct(r.region_share)} | ${r.landings_in_region} |`
		);
	L.push(
		'',
		'## Frequent visitors (>= 3 in-region landings, not classed as based)',
		'',
		'| Registration | Hex | Model | Owner | Top overnight airport | Nights tracked | Nights in region | Region share | Landings in region | In-region airports (nights/landings) |',
		'|---|---|---|---|---|---|---|---|---|---|'
	);
	for (const r of visitors)
		L.push(
			`| ${cell(r.registration)} | ${r.hex} | ${cell(r.model)} | ${cell(r.registered_owner)} | ${cell(r.top_airport)} | ` +
				`${r.nights_observed} | ${r.nights_in_region} | ${pct(r.region_share)} | ${r.landings_in_region} | ${byHex.get(r.hex) ?? ''} |`
		);
	L.push(
		'',
		'## Counts by in-region airport',
		'',
		'| Airport | Likely-based aircraft | Distinct aircraft overnighting | Overnights | Landings |',
		'|---|---|---|---|---|'
	);
	for (const a of [...airports].sort((x, y) => (basedAt.get(y.ident) ?? 0) - (basedAt.get(x.ident) ?? 0) || y.overnights - x.overnights))
		L.push(
			`| ${a.ident} (${cell(a.city || a.name)}, ${a.iso_region.slice(3)}) | ${basedAt.get(a.ident) ?? 0} | ${a.aircraft} | ${a.overnights} | ${a.landings} |`
		);
	return new Response(L.join('\n') + '\n', {
		headers: {
			'content-type': 'text/markdown; charset=utf-8',
			'content-disposition': 'attachment; filename="summary.md"'
		}
	});
};
