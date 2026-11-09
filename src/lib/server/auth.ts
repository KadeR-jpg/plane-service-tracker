/**
 * Email + password accounts stored in D1.
 * Passwords: PBKDF2-SHA256 (100k iterations, the Workers maximum) with a random salt.
 * Sessions: random 32-byte token in an httpOnly cookie; only its SHA-256 is stored.
 */
export const COOKIE = 'pst_session';
const ITERATIONS = 100_000;
const SESSION_DAYS = 30;

export interface User {
	id: number;
	email: string;
	name: string;
}

const enc = new TextEncoder();
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const DUMMY_HASH = `pbkdf2-sha256$${ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;

async function sha256hex(s: string): Promise<string> {
	const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
	return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
	const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
	return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	return `pbkdf2-sha256$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [alg, it, salt, hash] = stored.split('$');
	if (alg !== 'pbkdf2-sha256') return false;
	const got = await pbkdf2(password, unb64(salt), Number(it));
	const want = unb64(hash);
	if (got.length !== want.length) return false;
	let x = 0;
	for (let i = 0; i < got.length; i++) x |= got[i] ^ want[i];
	return x === 0;
}

export function validatePassword(p: string): string | null {
	return p.length >= 10 ? null : 'Password must be at least 10 characters.';
}

export function validEmail(e: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

export async function userCount(db: D1Database): Promise<number> {
	return (await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())?.n ?? 0;
}

export async function createUser(db: D1Database, email: string, name: string, password: string): Promise<number> {
	const r = await db
		.prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?) RETURNING id')
		.bind(email.trim(), name.trim(), await hashPassword(password), new Date().toISOString())
		.first<{ id: number }>();
	return r!.id;
}

export async function authenticate(db: D1Database, email: string, password: string): Promise<User | null> {
	const u = await db
		.prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?')
		.bind(email.trim())
		.first<User & { password_hash: string }>();
	// hash even for an unknown email so response time does not reveal which emails exist
	const ok = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH);
	return u && ok ? { id: u.id, email: u.email, name: u.name } : null;
}

export async function setPassword(db: D1Database, userId: number, password: string) {
	await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), userId).run();
}

export async function startSession(db: D1Database, userId: number): Promise<{ token: string; maxAge: number }> {
	const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => (c === '+' ? '-' : c === '/' ? '_' : ''));
	const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
	await db.batch([
		db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(new Date().toISOString()),
		db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256hex(token), userId, expires)
	]);
	return { token, maxAge: SESSION_DAYS * 86400 };
}

export async function sessionUser(db: D1Database, token: string | undefined): Promise<User | null> {
	if (!token) return null;
	return db
		.prepare(
			`SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
			  WHERE s.id = ? AND s.expires_at > ?`
		)
		.bind(await sha256hex(token), new Date().toISOString())
		.first<User>();
}

export async function endSession(db: D1Database, token: string | undefined) {
	if (token) await db.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256hex(token)).run();
}

/** Sign the user out everywhere except the current browser (after a password change). */
export async function endOtherSessions(db: D1Database, userId: number, keepToken: string | undefined) {
	await db
		.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
		.bind(userId, keepToken ? await sha256hex(keepToken) : '')
		.run();
}

export function cookieOptions(url: URL, maxAge: number) {
	return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: url.protocol === 'https:', maxAge };
}
