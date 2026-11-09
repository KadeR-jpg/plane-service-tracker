/** Admin session: a cookie holding SHA-256(ADMIN_TOKEN). Rotating the secret signs everyone out. */
const COOKIE = 'pst_admin';

async function sha256(s: string): Promise<string> {
	const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
	return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let x = 0;
	for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return x === 0;
}

export async function isAdmin(cookie: string | undefined, token: string | undefined): Promise<boolean> {
	if (!cookie || !token) return false;
	return safeEqual(cookie, await sha256(token));
}

export async function tokenMatches(given: string, token: string | undefined): Promise<boolean> {
	if (!token || !given) return false;
	return safeEqual(await sha256(given), await sha256(token));
}

export async function sessionValue(token: string): Promise<string> {
	return sha256(token);
}

export { COOKIE };
