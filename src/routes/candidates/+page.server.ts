import { fail } from '@sveltejs/kit';
import { normalizeCandidates, type Field } from '$lib/candidates';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => {
	const d = db(platform);
	const stats = await d
		.prepare('SELECT COUNT(*) AS n, MAX(uploaded_at) AS uploaded_at FROM candidates')
		.first<{ n: number; uploaded_at: string | null }>();
	const sample = await d
		.prepare('SELECT * FROM candidates ORDER BY registration LIMIT 25')
		.all<Record<string, string>>();
	return { count: stats?.n ?? 0, uploadedAt: stats?.uploaded_at ?? null, sample: sample.results };
};

const CHUNK = 400;

export const actions: Actions = {
	save: async ({ request, platform }) => {
		const form = await request.formData();
		const expected = platform?.env?.ADMIN_TOKEN;
		if (!expected) return fail(500, { error: 'ADMIN_TOKEN secret is not configured on the Worker.' });
		if (form.get('token') !== expected) return fail(403, { error: 'Wrong admin token.' });

		let raw: Partial<Record<Field, string>>[];
		try {
			raw = JSON.parse(String(form.get('rows') ?? '[]'));
			if (!Array.isArray(raw)) throw new Error();
		} catch {
			return fail(400, { error: 'Rows payload is not a JSON array.' });
		}
		const { rows, dropped } = normalizeCandidates(raw);
		if (!rows.length) return fail(400, { error: 'No rows with a valid 6-character hex.' });

		const d = db(platform);
		const now = new Date().toISOString();
		// json_each keeps each statement to one bound parameter (D1 caps parameters per query)
		const stmts = [d.prepare('DELETE FROM candidates')];
		for (let i = 0; i < rows.length; i += CHUNK)
			stmts.push(
				d
					.prepare(
						`INSERT INTO candidates (hex, registration, model, registered_owner, owner_city, owner_state, uploaded_at)
						 SELECT json_extract(value, '$.hex'), json_extract(value, '$.registration'), json_extract(value, '$.model'),
						        json_extract(value, '$.registered_owner'), json_extract(value, '$.owner_city'),
						        json_extract(value, '$.owner_state'), ?2
						   FROM json_each(?1)`
					)
					.bind(JSON.stringify(rows.slice(i, i + CHUNK)), now)
			);
		await d.batch(stmts);
		return { saved: rows.length, dropped };
	}
};
