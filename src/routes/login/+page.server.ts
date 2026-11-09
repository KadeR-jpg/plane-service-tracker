import { fail, redirect } from '@sveltejs/kit';
import { authenticate, COOKIE, cookieOptions, startSession, userCount } from '$lib/server/auth';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	if (locals.user) redirect(303, safeNext(url.searchParams.get('next')));
	if ((await userCount(db(platform))) === 0) redirect(303, '/setup');
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, platform, url }) => {
		const f = await request.formData();
		const email = String(f.get('email') ?? '');
		const user = await authenticate(db(platform), email, String(f.get('password') ?? ''));
		if (!user) return fail(403, { email, error: 'Wrong email or password.' });
		const { token, maxAge } = await startSession(db(platform), user.id);
		cookies.set(COOKIE, token, cookieOptions(url, maxAge));
		redirect(303, safeNext(url.searchParams.get('next')));
	}
};
