import { toCsv } from '$lib/csv';
import { db, regionAirportsByHex, results, RESULT_FIELDS } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
	const d = db(platform);
	const [rows, byHex] = await Promise.all([results(d), regionAirportsByHex(d)]);
	const out = rows.map((r) => ({ ...r, region_airports: byHex.get(r.hex) ?? '' }));
	const fields = [...RESULT_FIELDS, 'landings_total', 'top_region_airport', 'region_airports'];
	return new Response(toCsv(out, fields), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': 'attachment; filename="regional_base_candidates.csv"'
		}
	});
};
