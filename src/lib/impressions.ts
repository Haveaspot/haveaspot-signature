import { sql } from './db';

/**
 * Banner impressions.
 *
 * ## What the number is, and is not
 *
 * This counts banner image requests that **reached the server**. It is a floor,
 * not a true count of opens, and the gap is not small:
 *
 *  - The image is cached at the CDN for five minutes (`s-maxage=300`), so opens
 *    close together in time collapse into one fetch.
 *  - Gmail proxies images through its own cache, keyed on the URL — and the URL
 *    is the same for every recipient of a given sender. Several people opening
 *    the same campaign can therefore produce a single fetch.
 *  - Clients that block remote images produce none at all.
 *
 * Both effects push the same way: impressions under-report, so any click-through
 * rate derived from them over-reports. The dashboard labels it accordingly.
 * Trends over time are the trustworthy part — the caching behaviour is roughly
 * constant, so a rate that doubles has really doubled, even though its absolute
 * value is an upper bound.
 *
 * None of this is fixable without making the banner uncacheable, which would put
 * every open on the render path and lose the property that makes campaigns cheap.
 * It is the right trade; it just has to be stated rather than papered over.
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
