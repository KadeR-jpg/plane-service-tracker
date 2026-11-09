import { redirect } from '@sveltejs/kit';
import { COOKIE, endSession } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, platform }) => {
	if (platform?.env?.DB) await endSession(platform.env.DB, cookies.get(COOKIE));
	cookies.delete(COOKIE, { path: '/' });
	redirect(303, '/login');
};
