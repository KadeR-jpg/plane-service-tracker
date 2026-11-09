import { fail } from '@sveltejs/kit';
import {
	authenticate, COOKIE, createUser, endOtherSessions, setPassword, validatePassword, validEmail
} from '$lib/server/auth';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => {
	const { results } = await db(platform)
		.prepare('SELECT id, email, name, created_at FROM users ORDER BY created_at')
		.all<{ id: number; email: string; name: string; created_at: string }>();
	return { users: results };
};

export const actions: Actions = {
	password: async ({ request, platform, locals, cookies }) => {
		const user = locals.user!;
		const f = await request.formData();
		const d = db(platform);
		if (!(await authenticate(d, user.email, String(f.get('current') ?? ''))))
			return fail(403, { pwError: 'Current password is wrong.' });
		const next = String(f.get('password') ?? '');
		const bad = validatePassword(next);
		if (bad) return fail(400, { pwError: bad });
		if (next !== f.get('confirm')) return fail(400, { pwError: 'Passwords do not match.' });
		await setPassword(d, user.id, next);
		await endOtherSessions(d, user.id, cookies.get(COOKIE));
		return { pwSaved: true };
	},
	add: async ({ request, platform }) => {
		const f = await request.formData();
		const email = String(f.get('email') ?? '').trim();
		const name = String(f.get('name') ?? '').trim();
		const password = String(f.get('password') ?? '');
		if (!validEmail(email)) return fail(400, { addError: 'Enter a valid email.', email, name });
		const bad = validatePassword(password);
		if (bad) return fail(400, { addError: bad, email, name });
		const d = db(platform);
		if (await d.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first())
			return fail(400, { addError: 'That email already has an account.', email, name });
		await createUser(d, email, name, password);
		return { added: email };
	},
	remove: async ({ request, platform, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (id === locals.user!.id) return fail(400, { removeError: 'You cannot remove your own account.' });
		await db(platform).prepare('DELETE FROM users WHERE id = ?').bind(id).run();
		return { removed: true };
	}
};
