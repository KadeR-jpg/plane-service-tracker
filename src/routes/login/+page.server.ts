import { fail, redirect } from '@sveltejs/kit';
import { COOKIE, sessionValue, tokenMatches } from '$lib/server/auth';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, cookies, platform, url }) => {
		const token = platform?.env?.ADMIN_TOKEN;
		if (!token) return fail(500, { error: 'ADMIN_TOKEN secret is not configured on the Worker.' });
		const given = String((await request.formData()).get('token') ?? '');
		if (!(await tokenMatches(given, token))) return fail(403, { error: 'Wrong admin token.' });
		cookies.set(COOKIE, await sessionValue(token), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: 60 * 60 * 24 * 30
		});
		const next = url.searchParams.get('next');
		redirect(303, next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
	}
};
