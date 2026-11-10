import { fail } from '@sveltejs/kit';
import { normalizeCandidates, type Field } from '$lib/candidates';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => {
	const d = db(platform);
	const stats = await d
		.prepare('SELECT COUNT(*) AS n, MAX(uploaded_at) AS uploaded_at FROM candidates')
		.first<{ n: number; uploaded_at: string | null }>();
	const list = await d
		.prepare(
			`SELECT hex, registration, model, registered_owner, owner_city, owner_state, uploaded_at
			   FROM candidates ORDER BY registration`
		)
		.all<{ hex: string; registration: string; model: string; registered_owner: string; owner_city: string; owner_state: string; uploaded_at: string }>();
	const faa = await d
		.prepare('SELECT COUNT(*) AS n, MAX(file_date) AS loaded, (SELECT COUNT(*) FROM faa_prior) AS prior FROM faa_registry')
		.first<{ n: number; loaded: string | null; prior: number }>();
	const p135 = await d.prepare('SELECT COUNT(*) AS n, MAX(list_date) AS loaded FROM part135').first<{ n: number; loaded: string | null }>();
	return {
		count: stats?.n ?? 0,
		uploadedAt: stats?.uploaded_at ?? null,
		list: list.results,
		registrations: list.results.map((r) => r.registration.toUpperCase()),
		faa,
		p135
	};
};

const CHUNK = 400;

const REG_COLS = [
	'registration', 'serial', 'year_mfr', 'registrant_type', 'name', 'street', 'street2', 'city', 'state', 'zip',
	'county', 'country', 'other_names', 'cert_issue_date', 'last_action_date', 'expiration_date', 'fract_owner', 'status_code'
] as const;
const PRIOR_COLS = ['registration', 'prior_registration', 'name', 'street', 'city', 'state', 'zip', 'cert_issue_date', 'cancel_date'] as const;

/**
 * Insert-or-update from json_each(?): one bound parameter per chunk (D1 limits parameters per query).
 * Rows already present are updated in place; nothing is ever deleted here.
 */
function jsonUpsert(d: D1Database, table: string, cols: readonly string[], rows: Record<string, unknown>[], extra: Record<string, string> = {}) {
	const all = [...cols, ...Object.keys(extra)];
	const sel = [...cols.map((c) => `COALESCE(json_extract(value, '$.${c}'), '')`), ...Object.keys(extra).map((_, i) => `?${i + 2}`)];
	const out = [];
	for (let i = 0; i < rows.length; i += CHUNK)
		out.push(
			d
				.prepare(`INSERT OR REPLACE INTO ${table} (${all.join(', ')}) SELECT ${sel.join(', ')} FROM json_each(?1)`)
				.bind(JSON.stringify(rows.slice(i, i + CHUNK)), ...Object.values(extra))
		);
	return out;
}

export const actions: Actions = {
	/** Add new aircraft and update existing ones. Never removes anything. */
	add: async ({ request, platform, locals }) => {
		if (!locals.user) return fail(403, { error: 'Sign in first.' });
		const form = await request.formData();

		let raw: Partial<Record<Field, string>>[];
		try {
			raw = JSON.parse(String(form.get('rows') ?? '[]'));
			if (!Array.isArray(raw)) throw new Error();
		} catch {
			return fail(400, { error: 'Rows payload is not a JSON array.' });
		}
		const { rows } = normalizeCandidates(raw);
		if (!rows.length) return fail(400, { error: 'No rows with a valid 6-character hex.' });

		const d = db(platform);
		const now = new Date().toISOString();
		const existing = new Set(
			(await d.prepare('SELECT hex FROM candidates').all<{ hex: string }>()).results.map((r) => r.hex)
		);
		const stmts = [];
		for (let i = 0; i < rows.length; i += CHUNK)
			stmts.push(
				d
					.prepare(
						// blank cells in the new file keep the value already stored
						`INSERT INTO candidates (hex, registration, model, registered_owner, owner_city, owner_state, uploaded_at)
						 SELECT json_extract(value, '$.hex'), json_extract(value, '$.registration'), json_extract(value, '$.model'),
						        json_extract(value, '$.registered_owner'), json_extract(value, '$.owner_city'),
						        json_extract(value, '$.owner_state'), ?2
						   FROM json_each(?1) WHERE true
						 ON CONFLICT (hex) DO UPDATE SET
						   registration = COALESCE(NULLIF(excluded.registration, ''), registration),
						   model = COALESCE(NULLIF(excluded.model, ''), model),
						   registered_owner = COALESCE(NULLIF(excluded.registered_owner, ''), registered_owner),
						   owner_city = COALESCE(NULLIF(excluded.owner_city, ''), owner_city),
						   owner_state = COALESCE(NULLIF(excluded.owner_state, ''), owner_state),
						   uploaded_at = excluded.uploaded_at`
					)
					.bind(JSON.stringify(rows.slice(i, i + CHUNK)), now)
			);
		await d.batch(stmts);
		const added = rows.filter((r) => !existing.has(r.hex)).length;
		return { added, updated: rows.length - added };
	},

	/** Explicit removal of selected aircraft. Their saved notes stay and return if the aircraft is added again. */
	remove: async ({ request, platform, locals }) => {
		if (!locals.user) return fail(403, { removeError: 'Sign in first.' });
		let hexes: string[];
		try {
			hexes = JSON.parse(String((await request.formData()).get('hexes') ?? '[]'));
			if (!Array.isArray(hexes) || !hexes.every((h) => typeof h === 'string' && /^[0-9a-f]{6}$/.test(h))) throw new Error();
		} catch {
			return fail(400, { removeError: 'Nothing valid selected.' });
		}
		if (!hexes.length) return fail(400, { removeError: 'Nothing selected.' });
		await db(platform)
			.prepare('DELETE FROM candidates WHERE hex IN (SELECT value FROM json_each(?))')
			.bind(JSON.stringify(hexes))
			.run();
		return { removed: hexes.length };
	},

	faa: async ({ request, platform, locals }) => {
		if (!locals.user) return fail(403, { faaError: 'Sign in first.' });
		let payload: { current: Record<string, unknown>[]; prior: Record<string, unknown>[] };
		try {
			payload = JSON.parse(String((await request.formData()).get('payload') ?? ''));
			if (!Array.isArray(payload.current) || !Array.isArray(payload.prior)) throw new Error();
		} catch {
			return fail(400, { faaError: 'Upload payload is not valid.' });
		}
		if (!payload.current.length) return fail(400, { faaError: 'No candidate aircraft were found in the registry file.' });
		const d = db(platform);
		const today = new Date().toISOString().slice(0, 10);
		// updates rows for aircraft in the file; rows for other aircraft are left as they are
		await d.batch([
			...jsonUpsert(d, 'faa_registry', REG_COLS, payload.current, { file_date: today }),
			...jsonUpsert(d, 'faa_prior', PRIOR_COLS, payload.prior)
		]);
		return { faaSaved: payload.current.length, faaPrior: payload.prior.length };
	}
};
