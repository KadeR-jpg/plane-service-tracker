import { error, fail } from '@sveltejs/kit';
import { isTrustee, STATUSES } from '$lib/research';

type FleetRow = { hex: string; registration: string; model: string; top_airport: string | null; region_share: number | null };
import { db } from '$lib/server/db';
import { latestRefresh, refreshProgress } from '$lib/server/refresh';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, params }) => {
	const d = db(platform);
	const hex = params.hex.toLowerCase();
	const candidate = await d
		.prepare(
			`SELECT c.*, s.first_seen, s.last_seen, s.adsb_registration, s.adsb_type, s.top_airport,
			        s.top_airport_share, s.nights_observed, s.nights_in_region, s.region_share,
			        s.landings_in_region, s.landings_total, s.partial
			   FROM candidates c LEFT JOIN scores s ON s.hex = c.hex WHERE c.hex = ?`
		)
		.bind(hex)
		.first<Record<string, string | number | null>>();
	if (!candidate) error(404, 'Not in candidate list');
	const reg = String(candidate.registration ?? '').toUpperCase();
	const [nights, landings, run, registry, prior, operator, callsigns, prospect, sameOwner, sameOperator] = await Promise.all([
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
		}>(),
		d.prepare('SELECT * FROM faa_registry WHERE registration = ?').bind(reg).first<Record<string, string>>(),
		d
			.prepare('SELECT * FROM faa_prior WHERE registration = ? ORDER BY cancel_date DESC')
			.bind(reg)
			.all<Record<string, string>>(),
		d.prepare('SELECT * FROM part135 WHERE registration = ?').bind(reg).first<Record<string, string>>(),
		d
			.prepare('SELECT callsign, days, last_day FROM callsigns WHERE hex = ? ORDER BY days DESC')
			.bind(hex)
			.all<{ callsign: string; days: number; last_day: string }>(),
		d.prepare('SELECT * FROM prospects WHERE hex = ?').bind(hex).first<Record<string, string>>(),
		// other candidates registered to the same owner (skipped for trustees: they hold hundreds of unrelated aircraft)
		isTrustee(String(candidate.registered_owner ?? ''))
			? Promise.resolve({ results: [] as FleetRow[] })
			: d
					.prepare(
						`SELECT c.hex, c.registration, c.model, s.top_airport, s.region_share
						   FROM candidates c LEFT JOIN scores s ON s.hex = c.hex
						  WHERE c.hex != ?1 AND c.registered_owner = ?2 ORDER BY s.region_share DESC LIMIT 100`
					)
					.bind(hex, candidate.registered_owner ?? '')
					.all<FleetRow>(),
		// other candidates on the same Part 135 certificate
		d
			.prepare(
				`SELECT c.hex, c.registration, c.model, s.top_airport, s.region_share
				   FROM part135 p JOIN candidates c ON UPPER(c.registration) = p.registration
				   LEFT JOIN scores s ON s.hex = c.hex
				  WHERE c.hex != ?1 AND p.operator = (SELECT operator FROM part135 WHERE registration = ?2)
				  ORDER BY s.region_share DESC LIMIT 200`
			)
			.bind(hex, reg)
			.all<FleetRow>()
	]);
	return {
		candidate,
		progress: refreshProgress(await latestRefresh(d)),
		nights: nights.results,
		landings: landings.results,
		run,
		registry,
		prior: prior.results,
		operator,
		callsigns: callsigns.results,
		prospect,
		sameOwner: sameOwner.results,
		sameOperator: sameOperator.results
	};
};

const FIELDS = ['contact_name', 'contact_role', 'contact_phone', 'contact_email', 'notes'] as const;

export const actions: Actions = {
	prospect: async ({ request, platform, params, locals }) => {
		if (!locals.user) return fail(403, { error: 'Sign in to edit.' });
		const f = await request.formData();
		const status = String(f.get('status') ?? 'new');
		if (!STATUSES.some((s) => s.value === status)) return fail(400, { error: 'Unknown status.' });
		const v = Object.fromEntries(FIELDS.map((k) => [k, String(f.get(k) ?? '').slice(0, k === 'notes' ? 10000 : 300)]));
		await db(platform)
			.prepare(
				`INSERT INTO prospects (hex, status, contact_name, contact_role, contact_phone, contact_email, notes, updated_at, updated_by)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
				 ON CONFLICT (hex) DO UPDATE SET status = ?2, contact_name = ?3, contact_role = ?4, contact_phone = ?5,
				   contact_email = ?6, notes = ?7, updated_at = ?8, updated_by = ?9`
			)
			.bind(params.hex.toLowerCase(), status, v.contact_name, v.contact_role, v.contact_phone, v.contact_email, v.notes, new Date().toISOString(), locals.user.name || locals.user.email)
			.run();
		return { saved: true };
	}
};
