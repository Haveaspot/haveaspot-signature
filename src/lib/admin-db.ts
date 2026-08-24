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

// -----------------------------------------------------------------------------
// Analytics
// -----------------------------------------------------------------------------

/**
 * Everything here groups by UK local date, not UTC, using the same timezone as
 * campaign scheduling. Grouping by UTC would put early-morning BST clicks on
 * the previous day and make a daily chart quietly disagree with the campaign
 * windows shown elsewhere.
 */

export interface AnalyticsSummary {
	clicks: number;
	visitors: number;
	staff: number;
}

export async function analyticsSummary(days: number): Promise<AnalyticsSummary> {
	const rows = await sql<AnalyticsSummary[]>`
		SELECT count(*)::int                      AS clicks,
		       count(DISTINCT visitor_hash)::int  AS visitors,
		       count(DISTINCT sender_email)::int  AS staff
		FROM clicks
		WHERE clicked_at > now() - (${days} || ' days')::interval
	`;
	return rows[0] ?? { clicks: 0, visitors: 0, staff: 0 };
}

export interface DayPoint {
	day: string;
	clicks: number;
}

/**
 * Daily series with gaps filled.
 *
 * `generate_series` produces every day in the window whether or not it had a
 * click, so a quiet Sunday shows as a zero-height bar rather than being dropped
 * and silently compressing the timeline.
 */
export async function analyticsDaily(days: number): Promise<DayPoint[]> {
	return sql<DayPoint[]>`
		WITH span AS (
			SELECT generate_series(
				(now() AT TIME ZONE ${CAMPAIGN_TZ})::date - (${days - 1} || ' days')::interval,
				(now() AT TIME ZONE ${CAMPAIGN_TZ})::date,
				'1 day'
			)::date AS day
		)
		SELECT to_char(span.day, 'YYYY-MM-DD') AS day,
		       count(c.id)::int AS clicks
		FROM span
		LEFT JOIN clicks c
		  ON (c.clicked_at AT TIME ZONE ${CAMPAIGN_TZ})::date = span.day
		GROUP BY span.day
		ORDER BY span.day
	`;
}

export interface Breakdown {
	label: string;
	clicks: number;
}

/** Counts for one column, biggest first. Column name is whitelisted, not free. */
export async function analyticsBreakdown(
	column: 'asset_type' | 'email_client' | 'device_type' | 'os_platform' | 'country_code',
	days: number,
): Promise<Breakdown[]> {
	// Interpolating a column name has to be done with sql(), which quotes it as
	// an identifier — never by string concatenation.
	return sql<Breakdown[]>`
		SELECT ${sql(column)}::text AS label, count(*)::int AS clicks
		FROM clicks
		WHERE clicked_at > now() - (${days} || ' days')::interval
		GROUP BY 1
		ORDER BY clicks DESC, label
	`;
}

export interface StaffClicks {
	id: number | null;
	name: string;
	email: string;
	clicks: number;
}

/**
 * Grouped by sender_email, not by signature_id.
 *
 * A click carries both, but signature_id is null when the click was recorded
 * before that person's record existed or after it was deleted. Grouping by the
 * id therefore split one person across two rows — a named one and a bare email
 * — which read as two people and contradicted the "staff with activity" count
 * above it. The email is the stable identity; the id is looked up from it so
 * the row can still link through where a record exists.
 */
export async function analyticsTopStaff(days: number, limit = 10): Promise<StaffClicks[]> {
	return sql<StaffClicks[]>`
		SELECT max(s.id) AS id,
		       COALESCE(
		         NULLIF(trim(max(s.first_name) || ' ' || max(s.last_name)), ''),
		         c.sender_email
		       ) AS name,
		       c.sender_email AS email,
		       count(*)::int AS clicks
		FROM clicks c
		LEFT JOIN signatures s ON s.email = c.sender_email
		WHERE c.clicked_at > now() - (${days} || ' days')::interval
		GROUP BY c.sender_email
		ORDER BY clicks DESC
		LIMIT ${limit}
	`;
}

export interface CampaignClicks {
	name: string;
	clicks: number;
	visitors: number;
	/** Banner fetches that reached the server — a floor, not a true open count. */
	views: number;
}

/**
 * Campaign clicks against the default, so a campaign can be judged rather than
 * merely counted. The default is included as a row so the comparison is on the
 * same axis.
 */
export async function analyticsCampaigns(days: number): Promise<CampaignClicks[]> {
	/**
	 * Clicks and impressions are counted separately and then stitched together,
	 * rather than joined, because they live at different grains — one row per
	 * click against one aggregated row per person per campaign per day.
	 *
	 * The union of both key sets is what drives the rows, so a banner with
	 * impressions and no clicks still appears. That is the case most worth
	 * seeing: a campaign nobody is clicking looks identical to a campaign nobody
	 * has been shown if you only ever list the things that were clicked.
	 *
	 * `IS NOT DISTINCT FROM` rather than `=` throughout: campaign_id is NULL for
	 * the default banner, and a plain equality join drops NULL against NULL.
	 */
	return sql<CampaignClicks[]>`
		WITH imp AS (
			SELECT campaign_id, sum(views)::int AS views
			FROM impressions
			WHERE day > current_date - ${days}::int
			GROUP BY campaign_id
		),
		clk AS (
			SELECT campaign_id,
			       count(*)::int AS clicks,
			       count(DISTINCT visitor_hash)::int AS visitors
			FROM clicks
			WHERE asset_type IN ('cta_campaign', 'cta_default')
			  AND clicked_at > now() - (${days} || ' days')::interval
			GROUP BY campaign_id
		),
		keys AS (
			SELECT campaign_id FROM imp
			UNION
			SELECT campaign_id FROM clk
		)
		SELECT COALESCE(ca.name, 'Default banner') AS name,
		       COALESCE(clk.clicks, 0)::int   AS clicks,
		       COALESCE(clk.visitors, 0)::int AS visitors,
		       COALESCE(imp.views, 0)::int    AS views
		FROM keys k
		LEFT JOIN campaigns ca ON ca.id = k.campaign_id
		LEFT JOIN imp ON imp.campaign_id IS NOT DISTINCT FROM k.campaign_id
		LEFT JOIN clk ON clk.campaign_id IS NOT DISTINCT FROM k.campaign_id
		ORDER BY views DESC, clicks DESC
	`;
}

/** Total banner views in the window — the denominator for click-through rate. */
export async function impressionsTotal(days: number): Promise<number> {
	const rows = await sql<{ n: number }[]>`
		SELECT COALESCE(sum(views), 0)::int AS n
		FROM impressions
		WHERE day > current_date - ${days}::int
	`;
	return rows[0]?.n ?? 0;
}

/**
 * Every click ever recorded, ignoring the dashboard's period filter.
 *
 * The delete controls need this because the dashboard only ever shows a window:
 * someone looking at "7 days" and deleting everything should be told the real
 * number going, not the one on screen.
 */
export async function totalClicks(): Promise<number> {
	const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM clicks`;
	return rows[0]?.n ?? 0;
}

/** Total impressions ever recorded, for the same reason as `totalClicks`. */
export async function totalImpressions(): Promise<number> {
	const rows = await sql<{ n: number }[]>`SELECT COALESCE(sum(views), 0)::int AS n FROM impressions`;
	return rows[0]?.n ?? 0;
}

/** Impressions older than the cutoff, matching `clicksOlderThan`. */
export async function impressionsOlderThan(days: number): Promise<number> {
	const rows = await sql<{ n: number }[]>`
		SELECT COALESCE(sum(views), 0)::int AS n
		FROM impressions
		WHERE day <= current_date - ${days}::int
	`;
	return rows[0]?.n ?? 0;
}

/** Clicks older than the cutoff — the count the retention delete would remove. */
export async function clicksOlderThan(days: number): Promise<number> {
	const rows = await sql<{ n: number }[]>`
		SELECT count(*)::int AS n
		FROM clicks
		WHERE clicked_at <= now() - (${days} || ' days')::interval
	`;
	return rows[0]?.n ?? 0;
}

/**
 * Delete analytics history. Irreversible — there is no soft delete and no
 * archive.
 *
 * Two scopes, deliberately not one with a number attached: 'all' is the
 * clear-the-decks case (test data before a rollout), 'older' is routine
 * retention trimming. Anything more flexible would be a way to delete a
 * surprising subset by mistake.
 *
 * **Clicks and impressions go together.** Deleting one and not the other would
 * leave a click-through rate computed from a numerator and a denominator that
 * cover different spans of time — a number that looks fine and is wrong, which
 * is worse than no number.
 *
 * No other table is touched. Every click figure elsewhere in the admin — a
 * staff member's count, a campaign's performance — is a `count(*)` over these
 * rather than a stored total, so they all follow automatically and there is no
 * counter left to drift out of step.
 *
 * Returns what was removed, so the caller can report what happened rather than
 * guessing from the counts it showed beforehand.
 */
export interface DeletedAnalytics {
	clicks: number;
	impressions: number;
}

export async function deleteAnalytics(
	scope: 'all' | 'older',
	days = 90,
): Promise<DeletedAnalytics> {
	if (scope === 'all') {
		const [clicks, impressions] = await Promise.all([
			sql<{ id: number }[]>`DELETE FROM clicks RETURNING id`,
			sql<{ views: number }[]>`DELETE FROM impressions RETURNING views`,
		]);
		return { clicks: clicks.length, impressions: sumViews(impressions) };
	}

	const [clicks, impressions] = await Promise.all([
		sql<{ id: number }[]>`
			DELETE FROM clicks
			WHERE clicked_at <= now() - (${days} || ' days')::interval
			RETURNING id
		`,
		sql<{ views: number }[]>`
			DELETE FROM impressions
			WHERE day <= current_date - ${days}::int
			RETURNING views
		`,
	]);
	return { clicks: clicks.length, impressions: sumViews(impressions) };
}

/** Impression rows are aggregated, so the row count is not the view count. */
function sumViews(rows: { views: number }[]): number {
	return rows.reduce((total, row) => total + row.views, 0);
}
