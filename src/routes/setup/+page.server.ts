import { fail, redirect } from '@sveltejs/kit';
import { COOKIE, cookieOptions, createUser, startSession, userCount, validatePassword, validEmail } from '$lib/server/auth';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

/** First-run only: creates the first account while no accounts exist. */
export const load: PageServerLoad = async ({ platform }) => {
	if ((await userCount(db(platform))) > 0) redirect(303, '/login');
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, platform, url }) => {
		const d = db(platform);
		if ((await userCount(d)) > 0) redirect(303, '/login');
		const f = await request.formData();
		const email = String(f.get('email') ?? '').trim();
		const name = String(f.get('name') ?? '').trim();
		const password = String(f.get('password') ?? '');
		if (!validEmail(email)) return fail(400, { email, name, error: 'Enter a valid email.' });
		const bad = validatePassword(password);
		if (bad) return fail(400, { email, name, error: bad });
		if (password !== f.get('confirm')) return fail(400, { email, name, error: 'Passwords do not match.' });
		const id = await createUser(d, email, name, password);
		const { token, maxAge } = await startSession(d, id);
		cookies.set(COOKIE, token, cookieOptions(url, maxAge));
		redirect(303, '/');
	}
};
