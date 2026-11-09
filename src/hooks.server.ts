import { redirect, type Handle } from '@sveltejs/kit';
import { COOKIE, sessionUser, userCount } from '$lib/server/auth';

const PUBLIC = ['/login', '/setup'];

/** Every page requires a signed-in user; with no accounts yet, everything goes to /setup. */
export const handle: Handle = async ({ event, resolve }) => {
	const db = event.platform?.env?.DB;
	event.locals.user = db ? await sessionUser(db, event.cookies.get(COOKIE)) : null;
	const path = event.url.pathname;
	if (!event.locals.user && db && !PUBLIC.includes(path)) {
		if ((await userCount(db)) === 0) redirect(303, '/setup');
		redirect(303, `/login?next=${encodeURIComponent(path + event.url.search)}`);
	}
	return resolve(event);
};
