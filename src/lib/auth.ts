import { createHmac, createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { sql } from './db';
import { env } from './env';

/**
 * Admin authentication.
 *
 * Deliberately split into two layers so the credential check can be replaced
 * without touching anything else:
 *
 *   1. *Credential check* — currently one shared password (`verifyPassword`).
 *      Swapping this for emailed one-time codes means replacing this function
 *      and the login form; everything below stays as it is.
 *   2. *Session* — a signed, expiring cookie. Independent of how the person
 *      proved who they were.
 *
 * The session key is derived from the password rather than being a separate
 * secret. That keeps the setup to one environment variable, and gives a useful
 * property for a shared credential: rotating the password immediately
 * invalidates every existing session, which is exactly what you want when
 * someone leaves or the password is thought to have leaked.
 */

const COOKIE_NAME = 'has_admin';
const SESSION_HOURS = 8;

/** Failed attempts allowed from one address before it is locked out. */
const MAX_ATTEMPTS = 10;
const LOCKOUT_MINUTES = 15;

export { COOKIE_NAME };

function getPassword(): string {
	const password = env('ADMIN_PASSWORD');
	if (!password) {
		throw new Error('ADMIN_PASSWORD is not set — the admin area cannot be used.');
	}
	return password;
}

/** Signing key for session cookies, derived from the current password. */
function sessionKey(): Buffer {
	return createHash('sha256').update(`has-signature-session:${getPassword()}`).digest();
}

/** Compare without leaking length or content through timing. */
function safeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a, 'utf8');
	const bufB = Buffer.from(b, 'utf8');
	// timingSafeEqual throws on length mismatch, so hash first to fix the length.
	const hashA = createHash('sha256').update(bufA).digest();
	const hashB = createHash('sha256').update(bufB).digest();
	return timingSafeEqual(hashA, hashB);
}

export function verifyPassword(candidate: string): boolean {
	if (!candidate) return false;
	return safeEqual(candidate, getPassword());
}

// -----------------------------------------------------------------------------
// Sessions
// -----------------------------------------------------------------------------

/**
 * Token format: `<expiryMs>.<id>.<hmac>`.
 *
 * The id is random per session so two people logging in with the same shared
 * password do not hold byte-identical cookies — it makes a stolen cookie
 * traceable in logs and lets a future version revoke one session individually.
 */
export function createSessionToken(): string {
	const expiry = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
	const id = randomUUID();
	const payload = `${expiry}.${id}`;
	const signature = createHmac('sha256', sessionKey()).update(payload).digest('hex');
	return `${payload}.${signature}`;
}

export function verifySessionToken(token: string | undefined): boolean {
	if (!token) return false;

	const parts = token.split('.');
	if (parts.length !== 3) return false;

	const [expiryRaw, id, signature] = parts as [string, string, string];

	const expiry = Number(expiryRaw);
	if (!Number.isFinite(expiry) || Date.now() > expiry) return false;

	const expected = createHmac('sha256', sessionKey())
		.update(`${expiryRaw}.${id}`)
		.digest('hex');

	return safeEqual(signature, expected);
}

export function sessionCookieOptions() {
	return {
		httpOnly: true, // unreadable from JavaScript, so XSS cannot lift it
		secure: import.meta.env.PROD, // HTTPS only in production
		sameSite: 'lax' as const, // survives a normal link click, blocks cross-site POSTs
		path: '/admin', // never sent to the public generator or the image routes
		maxAge: SESSION_HOURS * 60 * 60,
	};
}

// -----------------------------------------------------------------------------
// Brute-force throttling
// -----------------------------------------------------------------------------

/**
 * A single shared password on a public URL is guessable given enough attempts,
 * so failures are counted per address.
 *
 * The counter lives in Postgres rather than memory because serverless
 * invocations do not share state — an in-memory counter would reset on every
 * cold start and protect nothing.
 */
function hashIp(headers: Headers): string {
	const ip =
		headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		headers.get('x-real-ip') ??
		'0.0.0.0';
	return createHash('sha256').update(`admin-login:${ip}`).digest('hex');
}

export async function isLockedOut(headers: Headers): Promise<boolean> {
	try {
		const rows = await sql<{ count: string }[]>`
			SELECT count(*) FROM admin_login_attempts
			WHERE ip_hash = ${hashIp(headers)}
			  AND succeeded = false
			  AND attempted_at > now() - (${LOCKOUT_MINUTES} || ' minutes')::interval
		`;
		return Number(rows[0]?.count ?? 0) >= MAX_ATTEMPTS;
	} catch (error) {
		// Fails open — deliberately, and only for the throttle.
		//
		// The password is the actual gate and does not touch the database; this
		// counter is defence in depth on top of it. Failing closed would mean a
		// database outage locks everyone out of the admin area, including the
		// dashboard whose purpose is to report that the database is down. Trading
		// rate limiting for reachability is the right way round here, given an
		// attacker still needs the password either way.
		console.error('[auth] throttle unavailable, allowing attempt', error);
		return false;
	}
}

export async function recordAttempt(headers: Headers, succeeded: boolean): Promise<void> {
	try {
		await sql`
			INSERT INTO admin_login_attempts (ip_hash, succeeded)
			VALUES (${hashIp(headers)}, ${succeeded})
		`;

		// A correct password clears the counter, so a legitimate admin who
		// mistyped a few times is not left locked out by their own fumbling.
		if (succeeded) {
			await sql`
				DELETE FROM admin_login_attempts
				WHERE ip_hash = ${hashIp(headers)} AND succeeded = false
			`;
		}
	} catch (error) {
		console.error('[auth] could not record login attempt', error);
	}
}

export const LOCKOUT_MESSAGE = `Too many attempts. Try again in ${LOCKOUT_MINUTES} minutes.`;
