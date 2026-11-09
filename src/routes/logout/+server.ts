import { redirect } from '@sveltejs/kit';
import { COOKIE } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ cookies }) => {
	cookies.delete(COOKIE, { path: '/' });
	redirect(303, '/');
};
