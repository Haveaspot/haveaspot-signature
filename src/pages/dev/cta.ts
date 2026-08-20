import type { APIRoute } from 'astro';
import { drawCta } from '../api/cta';
import type { CtaConfig } from '../../lib/campaigns';
import { SETTING_DEFAULTS } from '../../lib/settings';

export const prerender = false;

/**
 * CTA artwork rendered from defaults, with no database — development only.
 *
 * `/api/cta` resolves its config from Postgres, so on a laptop with no database
 * it correctly falls back to a blank spacer. That is right for production and
 * useless for design work: you cannot judge a layout around a hole where the
 * banner belongs. This renders the same `drawCta` from `SETTING_DEFAULTS`, so
 * the preview shows the real artwork.
 *
 * `?heading=` and `?button=` override the text, for checking how a long or
 * wrapping heading behaves before committing to it.
 */
export const GET: APIRoute = async ({ url }) => {
	if (!import.meta.env.DEV) {
		return new Response('Not found', { status: 404 });
	}

	const config: CtaConfig = {
		headingText: url.searchParams.get('heading') || SETTING_DEFAULTS.global_cta_text,
		buttonText: url.searchParams.get('button') || SETTING_DEFAULTS.btn_text,
		buttonUrl: 'https://haveaspot.com',
		promoImageUrl: url.searchParams.get('promo') || '',
		disableCta: url.searchParams.get('disabled') === '1',
		disablePromo: false,
		promoOnly: url.searchParams.get('promoOnly') === '1',
		campaign: null,
		signature: null,
	};

	return drawCta(config, url.searchParams.get('section') ?? 'card');
};
