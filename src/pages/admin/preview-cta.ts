import type { APIRoute } from 'astro';
import { drawCta } from '../api/cta';
import type { CtaConfig } from '../../lib/campaigns';
import { getSettings } from '../../lib/settings';

export const prerender = false;

/**
 * Render banner artwork from arbitrary values, for previewing before publishing.
 *
 * Sits under /admin so the middleware gates it — this renders whatever it is
 * given, which is fine for a signed-in admin and not something to expose
 * publicly. `/dev/cta` does the same job for the design preview but is
 * development-only; this one has to work in production, which is where
 * campaigns are actually written.
 *
 * Unset fields fall back to the saved settings rather than to blanks, so the
 * preview shows what the campaign will really look like — a campaign with no
 * button text of its own inherits the global one, and the preview must show
 * that rather than an empty button.
 */
export const GET: APIRoute = async ({ url }) => {
	const p = url.searchParams;
	const settings = await getSettings();

	const config: CtaConfig = {
		headingText: p.get('heading')?.trim() || settings.global_cta_text,
		buttonText: p.get('button')?.trim() || settings.btn_text,
		buttonUrl: settings.cta_url,
		promoImageUrl: p.get('promo')?.trim() || '',
		disableCta: false,
		disablePromo: false,
		promoOnly: p.get('promoOnly') === '1',
		campaign: null,
		signature: null,
	};

	const theme = p.get('theme') === 'dark' ? 'dark' : 'light';

	// No caching: the whole point is to reflect what is in the form right now.
	const response = await drawCta(config, 'card', theme);
	const headers = new Headers(response.headers);
	headers.set('Cache-Control', 'no-store');

	return new Response(response.body, { status: response.status, headers });
};
