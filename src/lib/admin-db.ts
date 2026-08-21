import { sql } from './db';
import type { SignatureRow, CampaignRow } from './db';

/**
 * Queries used only by the admin screens.
 *
 * Kept apart from db.ts, which holds the hot path the signature images and
 * tracking redirects run on. Nothing here is reached by an email being opened,
 * so these can be shaped for a human reading a table rather than for latency.
 */

// -----------------------------------------------------------------------------
// Departments
// -----------------------------------------------------------------------------

export interface DepartmentRow {
	id: number;
	name: string;
	slug: string;
	/** How many staff are assigned — shown so a delete is an informed one. */
	member_count: number;
}

export async function listDepartments(): Promise<DepartmentRow[]> {
	return sql<DepartmentRow[]>`
		SELECT d.id, d.name, d.slug,
		       (SELECT count(*) FROM signature_departments sd
		         WHERE sd.department_id = d.id)::int AS member_count
		FROM departments d
		ORDER BY d.name
	`;
}

/** Slugs are derived, not typed: one less field to get wrong or to collide. */
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
}

export async function createDepartment(name: string): Promise<void> {
	const slug = slugify(name);
	if (!slug) throw new Error('Name must contain at least one letter or number.');

	await sql`
		INSERT INTO departments (name, slug) VALUES (${name}, ${slug})
		ON CONFLICT (slug) DO NOTHING
	`;
}

export async function renameDepartment(id: number, name: string): Promise<void> {
	const slug = slugify(name);
	if (!slug) throw new Error('Name must contain at least one letter or number.');

	await sql`UPDATE departments SET name = ${name}, slug = ${slug} WHERE id = ${id}`;
}

/**
 * Deleting a department also drops its rows in `signature_departments` and
 * `campaign_targets` by cascade — staff are unassigned and any campaign that
 * targeted only this department stops matching anyone. The UI says so before
 * asking.
 */
export async function deleteDepartment(id: number): Promise<void> {
	await sql`DELETE FROM departments WHERE id = ${id}`;
}

// -----------------------------------------------------------------------------
// Signatures
// -----------------------------------------------------------------------------

export interface SignatureListRow extends SignatureRow {
	department_names: string[];
	click_count: number;
	updated_at: Date;
}

export async function listSignatures(): Promise<SignatureListRow[]> {
	return sql<SignatureListRow[]>`
		SELECT s.*,
		       COALESCE(
		         array_agg(d.name ORDER BY d.name) FILTER (WHERE d.name IS NOT NULL),
		         '{}'
		       ) AS department_names,
		       (SELECT count(*) FROM clicks c WHERE c.signature_id = s.id)::int AS click_count
		FROM signatures s
		LEFT JOIN signature_departments sd ON sd.signature_id = s.id
		LEFT JOIN departments d ON d.id = sd.department_id
		GROUP BY s.id
		ORDER BY s.last_name, s.first_name
	`;
}

export async function getSignature(id: number): Promise<SignatureListRow | null> {
	const rows = await sql<SignatureListRow[]>`
		SELECT s.*,
		       COALESCE(
		         array_agg(d.name ORDER BY d.name) FILTER (WHERE d.name IS NOT NULL),
		         '{}'
		       ) AS department_names,
		       (SELECT count(*) FROM clicks c WHERE c.signature_id = s.id)::int AS click_count
		FROM signatures s
		LEFT JOIN signature_departments sd ON sd.signature_id = s.id
		LEFT JOIN departments d ON d.id = sd.department_id
		WHERE s.id = ${id}
		GROUP BY s.id
	`;
	return rows[0] ?? null;
}

/**
 * Update the fields an admin owns.
 *
 * Deliberately excludes name, email, job title and phone numbers: those are the
 * person's own, kept current by them re-running the generator, and an admin
 * edit would be silently overwritten the next time they did. Only the marketing
 * overrides are editable here.
 */
export async function updateSignatureOverrides(
	id: number,
	input: {
		disable_cta: boolean;
		disable_promo: boolean;
		promo_only_mode: boolean;
		cta_heading: string;
		cta_link: string;
		btn_text: string;
		promo_image_url: string;
	},
): Promise<void> {
	await sql`
		UPDATE signatures SET
			disable_cta      = ${input.disable_cta},
			disable_promo    = ${input.disable_promo},
			promo_only_mode  = ${input.promo_only_mode},
			cta_heading      = ${input.cta_heading},
			cta_link         = ${input.cta_link},
			btn_text         = ${input.btn_text},
			promo_image_url  = ${input.promo_image_url},
			updated_at       = now()
		WHERE id = ${id}
	`;
}

export async function setSignatureDepartments(
	signatureId: number,
	departmentIds: number[],
): Promise<void> {
	// Replace wholesale rather than diffing: the set is small, and a single
	// delete-then-insert cannot leave a half-applied state the way a partial
	// diff can.
	await sql.begin(async (tx) => {
		await tx`DELETE FROM signature_departments WHERE signature_id = ${signatureId}`;
		if (departmentIds.length) {
			await tx`
				INSERT INTO signature_departments (signature_id, department_id)
				SELECT ${signatureId}, unnest(${departmentIds}::int[])
			`;
		}
	});
}

export async function deleteSignature(id: number): Promise<void> {
	await sql`DELETE FROM signatures WHERE id = ${id}`;
}

// -----------------------------------------------------------------------------
// Campaigns
// -----------------------------------------------------------------------------

/**
 * Campaign times are entered and shown in UK local time, stored as timestamptz.
 *
 * The conversion is done in SQL with `AT TIME ZONE 'Europe/London'` rather than
 * in JavaScript, because that applies the correct offset for the date in
 * question — a campaign scheduled in January is GMT and one in July is BST, and
 * a fixed offset would put one of them an hour out. Getting this wrong would
 * silently start or end campaigns at the wrong time, which is precisely the
 * thing the scheduling exists to control.
 *
 * The `::text` in the write casts is load-bearing, not noise. Without it the
 * driver infers the parameter as a timestamptz and Postgres applies the session
 * timezone before the explicit cast, so the offset lands twice: a BST time was
 * stored two hours early and read back one hour early, while GMT times looked
 * perfectly fine. Casting to text first forces it to be parsed as the naive
 * local timestamp it actually is. Covered by tests in both seasons, because a
 * winter-only test passes against the broken version.
 */
export const CAMPAIGN_TZ = 'Europe/London';

export interface CampaignListRow extends CampaignRow {
	target_department_ids: number[];
	target_signature_ids: number[];
	click_count: number;
	/** `YYYY-MM-DDTHH:MM` in UK local time, for a datetime-local input. */
	starts_local: string | null;
	ends_local: string | null;
}

export async function listCampaigns(): Promise<CampaignListRow[]> {
	return sql<CampaignListRow[]>`
		SELECT c.*,
		       to_char(c.starts_at AT TIME ZONE ${CAMPAIGN_TZ}, 'YYYY-MM-DD"T"HH24:MI') AS starts_local,
		       to_char(c.ends_at   AT TIME ZONE ${CAMPAIGN_TZ}, 'YYYY-MM-DD"T"HH24:MI') AS ends_local,
		       COALESCE(array_agg(DISTINCT t.department_id)
		                FILTER (WHERE t.department_id IS NOT NULL), '{}') AS target_department_ids,
		       COALESCE(array_agg(DISTINCT t.signature_id)
		                FILTER (WHERE t.signature_id IS NOT NULL), '{}') AS target_signature_ids,
		       (SELECT count(*) FROM clicks cl WHERE cl.campaign_id = c.id)::int AS click_count
		FROM campaigns c
		LEFT JOIN campaign_targets t ON t.campaign_id = c.id
		GROUP BY c.id
		ORDER BY c.starts_at DESC NULLS LAST, c.id DESC
	`;
}

export async function getCampaign(id: number): Promise<CampaignListRow | null> {
	const rows = await sql<CampaignListRow[]>`
		SELECT c.*,
		       to_char(c.starts_at AT TIME ZONE ${CAMPAIGN_TZ}, 'YYYY-MM-DD"T"HH24:MI') AS starts_local,
		       to_char(c.ends_at   AT TIME ZONE ${CAMPAIGN_TZ}, 'YYYY-MM-DD"T"HH24:MI') AS ends_local,
		       COALESCE(array_agg(DISTINCT t.department_id)
		                FILTER (WHERE t.department_id IS NOT NULL), '{}') AS target_department_ids,
		       COALESCE(array_agg(DISTINCT t.signature_id)
		                FILTER (WHERE t.signature_id IS NOT NULL), '{}') AS target_signature_ids,
		       (SELECT count(*) FROM clicks cl WHERE cl.campaign_id = c.id)::int AS click_count
		FROM campaigns c
		LEFT JOIN campaign_targets t ON t.campaign_id = c.id
		WHERE c.id = ${id}
		GROUP BY c.id
	`;
	return rows[0] ?? null;
}

export interface CampaignInput {
	name: string;
	/** Naive `YYYY-MM-DDTHH:MM` in UK local time, converted on write. */
	starts_at: string | null;
	ends_at: string | null;
	is_deactivated: boolean;
	cta_heading: string;
	cta_link: string;
	btn_text: string;
	promo_image_url: string;
	promo_only_mode: boolean;
	target_all: boolean;
	target_department_ids: number[];
	target_signature_ids: number[];
}

/** Create or update a campaign and its targets in one transaction. */
export async function saveCampaign(id: number | null, input: CampaignInput): Promise<number> {
	return sql.begin(async (tx) => {
		let campaignId = id;

		if (campaignId === null) {
			const rows = await tx<{ id: number }[]>`
				INSERT INTO campaigns (
					name, starts_at, ends_at, is_deactivated,
					cta_heading, cta_link, btn_text, promo_image_url,
					promo_only_mode, target_all
				) VALUES (
					${input.name},
					${input.starts_at}::text::timestamp AT TIME ZONE ${CAMPAIGN_TZ},
					${input.ends_at}::text::timestamp AT TIME ZONE ${CAMPAIGN_TZ},
					${input.is_deactivated},
					${input.cta_heading}, ${input.cta_link}, ${input.btn_text}, ${input.promo_image_url},
					${input.promo_only_mode}, ${input.target_all}
				) RETURNING id
			`;
			campaignId = rows[0]!.id;
		} else {
			await tx`
				UPDATE campaigns SET
					name = ${input.name},
					starts_at = ${input.starts_at}::text::timestamp AT TIME ZONE ${CAMPAIGN_TZ},
					ends_at = ${input.ends_at}::text::timestamp AT TIME ZONE ${CAMPAIGN_TZ},
					is_deactivated = ${input.is_deactivated},
					cta_heading = ${input.cta_heading},
					cta_link = ${input.cta_link},
					btn_text = ${input.btn_text},
					promo_image_url = ${input.promo_image_url},
					promo_only_mode = ${input.promo_only_mode},
					target_all = ${input.target_all},
					updated_at = now()
				WHERE id = ${campaignId}
			`;
		}

		await tx`DELETE FROM campaign_targets WHERE campaign_id = ${campaignId}`;

		// Targets are only stored when not targeting everyone. Keeping stale rows
		// around behind a target_all flag would make the table misleading to read.
		if (!input.target_all) {
			if (input.target_department_ids.length) {
				await tx`
					INSERT INTO campaign_targets (campaign_id, department_id)
					SELECT ${campaignId}, unnest(${input.target_department_ids}::int[])
				`;
			}
			if (input.target_signature_ids.length) {
				await tx`
					INSERT INTO campaign_targets (campaign_id, signature_id)
					SELECT ${campaignId}, unnest(${input.target_signature_ids}::int[])
				`;
			}
		}

		return campaignId;
	});
}

export async function deleteCampaign(id: number): Promise<void> {
	await sql`DELETE FROM campaigns WHERE id = ${id}`;
}

/** Live / scheduled / ended / off — the same rules `getActiveCampaign` applies. */
export function campaignStatus(c: CampaignRow): {
	label: string;
	tone: 'live' | 'scheduled' | 'ended' | 'off';
} {
	if (c.is_deactivated) return { label: 'Off', tone: 'off' };
	if (!c.starts_at || !c.ends_at) return { label: 'Draft — no dates', tone: 'off' };

	const now = Date.now();
	if (now < new Date(c.starts_at).getTime()) return { label: 'Scheduled', tone: 'scheduled' };
	if (now > new Date(c.ends_at).getTime()) return { label: 'Ended', tone: 'ended' };
	return { label: 'Live now', tone: 'live' };
}
