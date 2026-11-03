import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, params }) => {
	const d = db(platform);
	const hex = params.hex.toLowerCase();
	const candidate = await d
		.prepare(
			`SELECT c.*, s.first_seen, s.last_seen, s.adsb_registration, s.adsb_type, s.top_airport,
			        s.top_airport_share, s.nights_observed, s.nights_in_region, s.region_share,
			        s.landings_in_region, s.landings_total
			   FROM candidates c LEFT JOIN scores s ON s.hex = c.hex WHERE c.hex = ?`
		)
		.bind(hex)
		.first<Record<string, string | number | null>>();
	if (!candidate) error(404, 'Not in candidate list');
	const [nights, landings, run] = await Promise.all([
		d
			.prepare(
				`SELECT o.night, o.airport, o.in_region, a.name, a.city, a.iso_region
				   FROM overnights o LEFT JOIN airports a ON a.ident = o.airport WHERE o.hex = ? ORDER BY o.night`
			)
			.bind(hex)
			.all<{ night: string; airport: string; in_region: number; name: string; city: string; iso_region: string }>(),
		d
			.prepare(
				`SELECT l.t, l.airport, l.in_region, l.inferred, a.name, a.city
				   FROM landings l LEFT JOIN airports a ON a.ident = l.airport WHERE l.hex = ? ORDER BY l.t DESC`
			)
			.bind(hex)
			.all<{ t: number; airport: string; in_region: number; inferred: number; name: string; city: string }>(),
		d.prepare('SELECT window_start, window_end FROM ingest_runs ORDER BY id DESC LIMIT 1').first<{
			window_start: string;
			window_end: string;
		}>()
	]);
	return { candidate, nights: nights.results, landings: landings.results, run };
};
