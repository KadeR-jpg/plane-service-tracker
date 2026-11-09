import type { Handle } from '@sveltejs/kit';
import { COOKIE, isAdmin } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.admin = await isAdmin(event.cookies.get(COOKIE), event.platform?.env?.ADMIN_TOKEN);
	return resolve(event);
};
