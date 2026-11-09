import { classify, db, results, thresholds } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, url }) => {
	const d = db(platform);
	const { minShare, minNights } = thresholds(url);
	const [rows, ops, pros, reg] = await Promise.all([
		results(d),
		d.prepare('SELECT registration, operator FROM part135').all<{ registration: string; operator: string }>(),
		d
			.prepare('SELECT hex, status, contact_name, contact_role, updated_at FROM prospects')
			.all<{ hex: string; status: string; contact_name: string; contact_role: string; updated_at: string }>(),
		d.prepare('SELECT registration, city, state FROM faa_registry').all<{ registration: string; city: string; state: string }>()
	]);
	const opBy = new Map(ops.results.map((o) => [o.registration, o.operator]));
	const proBy = new Map(pros.results.map((p) => [p.hex, p]));
	const regBy = new Map(reg.results.map((r) => [r.registration, r]));
	const { based, visitors } = classify(rows, minShare, minNights);
	const enrich = (kind: 'based' | 'visitor') => (r: (typeof rows)[number]) => {
		const p = proBy.get(r.hex);
		const R = r.registration.toUpperCase();
		return {
			kind,
			hex: r.hex,
			registration: r.registration,
			model: r.model,
			owner: r.registered_owner,
			owner_place: regBy.get(R) ? `${regBy.get(R)!.city}, ${regBy.get(R)!.state}` : r.owner_city_state,
			operator: opBy.get(R) ?? '',
			top_region_airport: r.top_region_airport ?? r.top_airport ?? '',
			region_share: r.region_share,
			nights_observed: r.nights_observed,
			landings_in_region: r.landings_in_region,
			status: p?.status ?? 'new',
			contact: p?.contact_name ? `${p.contact_name}${p.contact_role ? `, ${p.contact_role}` : ''}` : '',
			updated_at: p?.updated_at?.slice(0, 10) ?? ''
		};
	};
	return {
		minShare,
		minNights,
		rows: [...based.map(enrich('based')), ...visitors.map(enrich('visitor'))]
	};
};
