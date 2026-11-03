import { toCsv } from '$lib/csv';
import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
	const { results } = await db(platform)
		.prepare(
			`SELECT c.registration, o.hex, o.night, o.airport, a.name AS airport_name, o.in_region
			   FROM overnights o JOIN candidates c ON c.hex = o.hex LEFT JOIN airports a ON a.ident = o.airport
			  ORDER BY c.registration, o.night`
		)
		.all<Record<string, unknown>>();
	return new Response(toCsv(results, ['registration', 'hex', 'night', 'airport', 'airport_name', 'in_region']), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': 'attachment; filename="overnights.csv"'
		}
	});
};
