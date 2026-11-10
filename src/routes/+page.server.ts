import { classify, db, lastRun, regionAirportCounts, regionAirportsByHex, results, thresholds } from '$lib/server/db';
import { latestRefresh, refreshProgress } from '$lib/server/refresh';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, url }) => {
	const d = db(platform);
	const { minShare, minNights } = thresholds(url);
	const [rows, airports, byHex, run, refresh] = await Promise.all([
		results(d),
		regionAirportCounts(d),
		regionAirportsByHex(d),
		lastRun(d),
		latestRefresh(d)
	]);
	const { based, active, visitors, seen } = classify(rows, minShare, minNights);
	const basedAt = new Map<string, number>();
	for (const r of based) {
		const k = r.top_region_airport ?? r.top_airport ?? '';
		basedAt.set(k, (basedAt.get(k) ?? 0) + 1);
	}
	return {
		progress: refreshProgress(refresh),
		partialCount: rows.filter((r) => r.partial).length,
		missingCount: rows.filter((r) => !r.first_seen).length,
		minShare,
		minNights,
		run,
		totals: { candidates: rows.length, seen, active: active.length, based: based.length },
		based,
		visitors: visitors.map((r) => ({ ...r, region_airports: byHex.get(r.hex) ?? '' })),
		airports: airports
			.map((a) => ({ ...a, based: basedAt.get(a.ident) ?? 0 }))
			.sort((a, b) => b.based - a.based || b.overnights - a.overnights || b.landings - a.landings)
	};
};
