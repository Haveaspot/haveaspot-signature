import type { APIRoute } from 'astro';
import { ImageResponse } from '@vercel/og';
import { resolveCtaConfig } from '../../lib/campaigns';
import { brand } from '../../lib/brand';
import { h, loadFonts, estimateLines, headingLines } from '../../lib/og';

export const prerender = false;

/**
 * The CTA image renderer — the replacement for Routers A/B/C/D in the plugin.
 *
 * The plugin had four near-identical GD routers that had drifted apart; this is
 * one route with a `section` parameter:
 *   ?section=content  -> heading text + optional promo image
 *   ?section=button   -> the call-to-action button
 *   ?section=promo    -> promo image only
 *
 * Why images at all: it is the only way to get identical typography in Outlook,
 * Gmail and Apple Mail. Why 1196px wide: it renders at 598 CSS px in the email,
 * so the artwork is 2x for retina displays.
 */

const WIDTH = 1196;
const PADDING = 50;
const CONTENT_WIDTH = WIDTH - PADDING * 2;
const HEADING_SIZE = 28;
const LINE_HEIGHT = 46;
const BUTTON_HEIGHT = 96;

/**
 * Transparent spacer for any case where there is nothing to draw.
 *
 * It is 1196×1, not 1×1, and the aspect ratio is the whole point: the signature
 * renders this at `width:100%; height:auto`, so a square pixel would stretch
 * into a 598px-tall empty block in the middle of everyone's email. At full
 * width and one pixel tall it collapses to an invisible hairline instead.
 */
const BLANK_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAABKwAAAABCAYAAADzajZqAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHElEQVRYw+3BMQEAAADCoPVPbQ0PoAAAAADgyAASsQABr00tewAAAABJRU5ErkJggg==',
	'base64',
);

function blankResponse(): Response {
	return new Response(new Uint8Array(BLANK_PNG), {
		headers: {
			'Content-Type': 'image/png',
			// Short cache: campaigns turn over on a schedule, and a stale banner
			// sitting in Gmail's proxy cache is the failure mode to avoid.
			'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=60',
		},
	});
}

export const GET: APIRoute = async ({ url }) => {
	const email = (url.searchParams.get('user') ?? '').toLowerCase().trim();
	const section = url.searchParams.get('section') ?? 'content';

	if (!email) return blankResponse();

	try {
		return await render(email, section);
	} catch (error) {
		// Never surface an error status here. These URLs are embedded in emails
		// that are already sent, and a non-image response renders as a broken-image
		// icon in every signature at once. A blank pixel fails invisibly, and the
		// short cache means the banner reappears as soon as the fault clears.
		console.error('[cta] render failed, serving blank', error);
		return blankResponse();
	}
};

async function render(email: string, section: string): Promise<Response> {
	const config = await resolveCtaConfig(email);
	if (config.disableCta) return blankResponse();

	const fonts = await loadFonts();
	const cacheHeaders = {
		'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=60',
	};

	// --- Button ---------------------------------------------------------------
	if (section === 'button') {
		// promoOnly suppresses the button, matching the plugin.
		if (config.promoOnly) return blankResponse();

		return new ImageResponse(
			h(
				'div',
				{
					style: {
						width: '100%',
						height: '100%',
						display: 'flex',
						alignItems: 'flex-start',
						backgroundColor: brand.surface,
						padding: `0 ${PADDING}px`,
					},
				},
				h(
					'div',
					{
						style: {
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							height: `${BUTTON_HEIGHT}px`,
							padding: '0 40px',
							backgroundColor: brand.ink,
							color: brand.white,
							fontSize: 24,
							fontWeight: 500,
							fontFamily: 'Poppins',
						},
					},
					config.buttonText,
				),
			),
			{ width: WIDTH, height: BUTTON_HEIGHT + PADDING, fonts, headers: cacheHeaders },
		);
	}

	// --- Promo image only -----------------------------------------------------
	if (section === 'promo' || config.promoOnly) {
		if (!config.promoImageUrl) return blankResponse();

		// Assume a 3:1 banner; the admin UI should enforce this aspect ratio on
		// upload so the rendered height is predictable.
		const promoHeight = Math.round(CONTENT_WIDTH / 3);

		return new ImageResponse(
			h(
				'div',
				{
					style: {
						width: '100%',
						height: '100%',
						display: 'flex',
						backgroundColor: brand.surface,
						padding: `${PADDING}px`,
					},
				},
				h('img', {
					src: config.promoImageUrl,
					style: { width: `${CONTENT_WIDTH}px`, height: `${promoHeight}px`, objectFit: 'cover' },
				}),
			),
			{ width: WIDTH, height: promoHeight + PADDING * 2, fonts, headers: cacheHeaders },
		);
	}

	// --- Heading text (+ optional promo image) --------------------------------
	const lines = headingLines(config.headingText);
	const lineCount = estimateLines(config.headingText, HEADING_SIZE, CONTENT_WIDTH);

	const hasPromo = !config.disablePromo && Boolean(config.promoImageUrl);
	const promoHeight = hasPromo ? Math.round(CONTENT_WIDTH / 3) : 0;
	const promoMargin = hasPromo ? 40 : 0;

	const height = PADDING + lineCount * LINE_HEIGHT + 24 + promoHeight + promoMargin;

	return new ImageResponse(
		h(
			'div',
			{
				style: {
					width: '100%',
					height: '100%',
					display: 'flex',
					flexDirection: 'column',
					backgroundColor: brand.surface,
					padding: `${PADDING}px ${PADDING}px 0 ${PADDING}px`,
					fontFamily: 'Poppins',
				},
			},
			h(
				'div',
				{ style: { display: 'flex', flexDirection: 'column' } },
				...lines.map((line) =>
					h(
						'div',
						{
							style: {
								fontSize: HEADING_SIZE,
								lineHeight: `${LINE_HEIGHT}px`,
								color: brand.ink,
								fontWeight: 400,
							},
						},
						line,
					),
				),
			),
			hasPromo
				? h('img', {
						src: config.promoImageUrl,
						style: {
							width: `${CONTENT_WIDTH}px`,
							height: `${promoHeight}px`,
							marginTop: `${promoMargin}px`,
							objectFit: 'cover',
						},
					})
				: null,
		),
		{ width: WIDTH, height, fonts, headers: cacheHeaders },
	);
}
