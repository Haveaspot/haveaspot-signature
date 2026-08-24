import { sql } from './db';

/**
 * Banner impressions.
 *
 * ## What the number is, and is not
 *
 * This counts banner image requests that **reached the server**. It is a floor,
 * not a true count of opens:
 *
 *  - Clients that block remote images produce no request at all, and many
 *    people never load them.
 *  - A proxy that dedupes identical URLs between recipients can still collapse
 *    two opens into one fetch, even though the banner is sent uncacheable.
 *
 * Both push the same way: impressions under-report, so any click-through rate
 * derived from them over-reports. The dashboard labels it accordingly. Trends
 * over time are the trustworthy part — the behaviour is roughly constant, so a
 * rate that doubles has really doubled, even if its absolute value is an upper
 * bound.
 *
 * This was far worse before the banner's cache headers were fixed: it was being
 * cached for a year, so most opens never reached the server at all. Numbers
 * from before that fix are not comparable with numbers after it.
 *
 * The banner *is* uncacheable, which is what makes campaigns update at all —
 * see the cache note in `src/pages/api/cta.ts`. That puts every open on the
 * render path, and is the right trade.
 *
 * ## Why one row per person per campaign per day
 *
 * A click is rare and worth keeping in full. A banner render happens every time
 * anyone opens any email from anyone, which is orders of magnitude more traffic.
 * Aggregating on the way in keeps the write cheap and the table small, at the
 * grain every question actually needs.
 */
export async function recordImpression(
	email: string,
	campaignId: number | null,
): Promise<void> {
	if (!email) return;

	await sql`
		INSERT INTO impressions (day, sender_email, campaign_id, views)
		VALUES (current_date, ${email}, ${campaignId}, 1)
		ON CONFLICT (day, sender_email, COALESCE(campaign_id, 0))
		DO UPDATE SET views = impressions.views + 1
	`;
}
