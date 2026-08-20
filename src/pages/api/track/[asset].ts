import type { APIRoute } from 'astro';
import { resolveCtaConfig } from '../../../lib/campaigns';
import { getSettings } from '../../../lib/settings';
import { logClick } from '../../../lib/tracking';
import type { AssetType } from '../../../lib/tracking';

export const prerender = false;

/**
 * Click tracker + redirector — replaces the plugin's `settlin_route_sig` and
 * `settlin_track` query-string routers.
 *
 * /api/track/cta?user=...       -> the campaign-aware call-to-action target
 * /api/track/website?user=...   -> haveaspot.com
 * /api/track/mail?user=...      -> contact page
 * /api/track/linkedin?user=...  -> company LinkedIn
 */

const SIMPLE_ASSETS = ['website', 'mail', 'linkedin'] as const;
type SimpleAsset = (typeof SIMPLE_ASSETS)[number];

/**
 * Last-resort destination if the database is unreachable.
 *
 * These URLs are already sitting in inboxes and cannot be corrected after the
 * fact, so a redirect must never fail — landing someone on the homepage is a
 * bad day, an error page is a broken company-wide signature.
 */
const FALLBACK_TARGET = 'https://haveaspot.com';

export const GET: APIRoute = async ({ params, url, request }) => {
	const asset = params.asset ?? '';
	const email = (url.searchParams.get('user') ?? '').toLowerCase().trim();

	let target = FALLBACK_TARGET;
	let assetType: AssetType | null = null;
	let campaignId: number | null = null;

	try {
		const settings = await getSettings();
		target = settings.link_web;

		if (asset === 'cta') {
			const config = await resolveCtaConfig(email);
			target = config.buttonUrl || settings.cta_url;
			// Campaign clicks are attributed separately so a campaign's performance
			// can be measured against the default CTA.
			assetType = config.campaign ? 'cta_campaign' : 'cta_default';
			campaignId = config.campaign?.id ?? null;
		} else if ((SIMPLE_ASSETS as readonly string[]).includes(asset)) {
			const simple = asset as SimpleAsset;
			assetType = simple;
			target =
				simple === 'linkedin'
					? settings.link_li
					: simple === 'mail'
						? settings.link_mail
						: settings.link_web;
		}

		if (assetType && email) {
			// Awaited rather than fire-and-forget: a serverless function can be
			// frozen the moment the response is returned, dropping the insert.
			await logClick({ email, assetType, campaignId, headers: request.headers });
		}
	} catch (error) {
		// Losing one analytics row is acceptable; losing the click is not.
		console.error('[track] falling back to default target', error);
	}

	return new Response(null, {
		status: 302,
		headers: { Location: target, 'Cache-Control': 'no-store' },
	});
};
