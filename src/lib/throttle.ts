import { createHash } from 'node:crypto';
import { sql } from './db';
import { env } from './env';

/**
 * Volume limiting for the public generator endpoint.
 *
 * `/api/sync` writes to the staff table and is reachable by anyone. The
 * honeypot catches naive bots and the domain guard restricts which addresses
 * can be created, but neither caps volume — a script that knows the domain
 * could fill the CRM with junk records.
 *
 * Counted in Postgres rather than in memory, for the same reason as the admin
 * login throttle: serverless invocations share no state, so an in-process
 * counter resets on every cold start and protects nothing.
 */

/**
 * Deliberately generous. On rollout day an entire office may generate their
 * signatures within an hour from a single NAT address, and blocking that would
 * be a far worse failure than the abuse this guards against. The point is to
 * stop a script doing thousands, not to ration ordinary use.
 */
const MAX_PER_WINDOW = 40;
const WINDOW_MINUTES = 60;

export const THROTTLE_MESSAGE =
	'Too many signatures generated from this network recently. Try again shortly.';

function hashIp(headers: Headers): string {
	const ip =
		headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		headers.get('x-real-ip') ??
		'0.0.0.0';
	// Salted, and namespaced separately from the click and login hashes so the
	// same address cannot be correlated across the three tables.
	const salt = env('CRON_SECRET') ?? 'has-signature';
	return createHash('sha256').update(`sync:${ip}:${salt}`).digest('hex');
}

/**
 * Whether this address has exceeded the window, recording the attempt either
 * way.
 *
 * Fails open. The alternative is that a database hiccup stops staff generating
 * signatures, and since /api/sync cannot do its actual job without the database
 * anyway, failing closed here would only turn a clear error into a misleading
 * one.
 */
export async function isSyncThrottled(headers: Headers): Promise<boolean> {
	try {
		const ip = hashIp(headers);

		const rows = await sql<{ count: string }[]>`
			SELECT count(*) FROM sync_attempts
			WHERE ip_hash = ${ip}
			  AND attempted_at > now() - (${WINDOW_MINUTES} || ' minutes')::interval
		`;

		if (Number(rows[0]?.count ?? 0) >= MAX_PER_WINDOW) return true;

		await sql`INSERT INTO sync_attempts (ip_hash) VALUES (${ip})`;
		return false;
	} catch (error) {
		console.error('[throttle] unavailable, allowing request', error);
		return false;
	}
}

/**
 * Drop attempts older than the window.
 *
 * Called from the daily cron, which until now only reported and did nothing.
 * Without this the table grows forever to support a one-hour lookback.
 */
export async function pruneSyncAttempts(): Promise<number> {
	const rows = await sql<{ id: number }[]>`
		DELETE FROM sync_attempts
		WHERE attempted_at < now() - (${WINDOW_MINUTES * 2} || ' minutes')::interval
		RETURNING id
	`;
	return rows.length;
}

/** The same, for the admin login table, which had the same unbounded growth. */
export async function pruneLoginAttempts(): Promise<number> {
	const rows = await sql<{ id: number }[]>`
		DELETE FROM admin_login_attempts
		WHERE attempted_at < now() - interval '24 hours'
		RETURNING id
	`;
	return rows.length;
}
