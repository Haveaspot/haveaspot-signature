import postgres from 'postgres';
import { env } from './env';

/**
 * Postgres client.
 *
 * Serverless functions are stateless and short-lived, so the pool is kept
 * deliberately small — Vercel Postgres/Neon pool connections at the proxy, and
 * opening ten sockets per invocation is how you exhaust the connection limit
 * under any real traffic.
 *
 * The client is created on first use rather than at import time. Connecting
 * eagerly would mean a missing POSTGRES_URL takes down the whole module graph
 * at cold start — including routes and constants that never touch the database
 * — and turns a clear error into an opaque 500.
 */
let client: postgres.Sql | null = null;

function getClient(): postgres.Sql {
	if (client) return client;

	// Accept any of the names Vercel's Postgres integrations produce.
	//
	// The variable a Neon/Vercel integration creates depends on which provider
	// was chosen and what "custom prefix" was set when connecting, so hard-coding
	// one name means a correctly-connected database can still look unreachable.
	// That failure is near-invisible from the outside: the image routes fall back
	// to a blank spacer, so signatures simply lose their banner with no error.
	//
	// Order matters — POSTGRES_URL first, since that is what .env.example
	// documents and what a manually-set value would use.
	const candidates = [
		'POSTGRES_URL',
		'DATABASE_URL',
		'STORAGE_URL',
		'POSTGRES_PRISMA_URL',
		'POSTGRES_URL_NON_POOLING',
	];

	const found = candidates.find((key) => env(key));
	if (!found) {
		throw new Error(
			`No Postgres connection string found. Set one of: ${candidates.join(', ')}. ` +
				'Locally, copy .env.example to .env; on Vercel, connect a Postgres store.',
		);
	}

	const connectionString = env(found)!;

	client = postgres(connectionString, {
		max: 1,
		idle_timeout: 20,
		connect_timeout: 10,
		prepare: false, // required when talking through a connection pooler
	});

	return client;
}

/**
 * Tagged-template proxy over the lazy client, so call sites read as plain
 * ``sql`SELECT …` `` while the connection is still deferred to first query.
 */
export const sql = new Proxy((() => {}) as unknown as postgres.Sql, {
	apply(_target, _thisArg, args: unknown[]) {
		return (getClient() as (...a: unknown[]) => unknown)(...args);
	},
	get(_target, property) {
		return getClient()[property as keyof postgres.Sql];
	},
});

// -----------------------------------------------------------------------------
// Row types
// -----------------------------------------------------------------------------

export interface SignatureRow {
	id: number;
	email: string;
	first_name: string;
	last_name: string;
	job_title: string;
	mobile: string;
	office: string;
	/** Their own LinkedIn profile; blank falls back to the company page. */
	linkedin_url: string;
	disable_cta: boolean;
	disable_promo: boolean;
	promo_only_mode: boolean;
	cta_heading: string;
	cta_link: string;
	btn_text: string;
	promo_image_url: string;
}

export interface CampaignRow {
	id: number;
	name: string;
	starts_at: Date | null;
	ends_at: Date | null;
	is_deactivated: boolean;
	cta_heading: string;
	cta_link: string;
	btn_text: string;
	promo_image_url: string;
	promo_only_mode: boolean;
	target_all: boolean;
}

// -----------------------------------------------------------------------------
// Queries
// -----------------------------------------------------------------------------

/**
 * Look up one employee by email. The PHP did this with a meta_query ordered by
 * `modified DESC` because postmeta allowed duplicates; here `email` is UNIQUE,
 * so there is exactly one row or none.
 */
export async function getSignatureByEmail(
	email: string,
): Promise<SignatureRow | null> {
	const rows = await sql<SignatureRow[]>`
		SELECT * FROM signatures WHERE email = ${email.toLowerCase()} LIMIT 1
	`;
	return rows[0] ?? null;
}

/** Department ids this signature belongs to — used for campaign targeting. */
export async function getDepartmentIds(signatureId: number): Promise<number[]> {
	const rows = await sql<{ department_id: number }[]>`
		SELECT department_id FROM signature_departments WHERE signature_id = ${signatureId}
	`;
	return rows.map((r) => r.department_id);
}

/**
 * Insert-or-update an employee from the public generator form.
 * Mirrors `mech_ajax_sync_signature`: first submission creates the CRM record,
 * later ones update it — but the admin-only override columns are never touched,
 * so a marketing override cannot be clobbered by someone re-running the form.
 */
export async function upsertSignature(input: {
	email: string;
	first_name: string;
	last_name: string;
	job_title: string;
	mobile: string;
	office: string;
	linkedin_url: string;
}): Promise<SignatureRow> {
	const rows = await sql<SignatureRow[]>`
		INSERT INTO signatures (
			email, first_name, last_name, job_title, mobile, office, linkedin_url
		)
		VALUES (
			${input.email.toLowerCase()}, ${input.first_name}, ${input.last_name},
			${input.job_title}, ${input.mobile}, ${input.office}, ${input.linkedin_url}
		)
		ON CONFLICT (email) DO UPDATE SET
			first_name   = EXCLUDED.first_name,
			last_name    = EXCLUDED.last_name,
			job_title    = EXCLUDED.job_title,
			mobile       = EXCLUDED.mobile,
			office       = EXCLUDED.office,
			linkedin_url = EXCLUDED.linkedin_url,
			updated_at   = now()
		RETURNING *
	`;
	return rows[0]!;
}
