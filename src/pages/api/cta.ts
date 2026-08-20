import type { APIRoute } from 'astro';
import { ImageResponse } from '@vercel/og';
import { resolveCtaConfig } from '../../lib/campaigns';
import type { CtaConfig } from '../../lib/campaigns';
import { brand, radius, BUTTON_HEIGHT } from '../../lib/brand';
import { h, loadFonts, estimateLines, headingLines } from '../../lib/og';

export const prerender = false;

/**
 * The CTA image renderer — the replacement for Routers A/B/C/D in the plugin.
 *
 * The plugin had four near-identical GD routers that had drifted apart. This is
 * one route producing one image:
 *   ?section=card   -> the whole CTA block (heading, optional promo, button)
 *   ?section=promo  -> promo image alone
 *
 * Why an image at all, when the surrounding signature is HTML: because the
 * signature is pasted into a mail client once and frozen, whereas this URL is
 * fetched afresh every time the email is opened. It is the only part of the
 * signature that a campaign can change after the fact. The cost of that is real
 * — an image cannot respond to the reader's dark mode — which is why the block
 * is drawn as a white brand card that reads as deliberate against a dark
 * background rather than as a broken band.
 *
 * Everything is drawn at 2x and displayed at 600 CSS px, so the artwork stays
 * sharp on retina screens. The `px()` helper keeps the code in brand units.
 */

/** Displayed width in CSS pixels; matches the signature table. */
const DISPLAY_WIDTH = 600;
const SCALE = 2;

/** Convert a brand/CSS pixel value into artwork pixels. */
const px = (value: number) => value * SCALE;

const WIDTH = px(DISPLAY_WIDTH);
const PADDING = px(28);
const BORDER = px(2);
const CONTENT_WIDTH = WIDTH - PADDING * 2 - BORDER * 2;

const HEADING_SIZE = px(16);
const HEADING_LINE = px(24);
const HEADING_GAP = px(20);
const BUTTON_FONT = px(15);

/**
 * Transparent spacer for any case where there is nothing to draw.
 *
 * It is wide and one pixel tall, not 1×1, and the aspect ratio is the whole
 * point: the signature renders this at `width:100%; height:auto`, so a square
 * pixel would stretch into a 600px-tall empty block in the middle of everyone's
 * email. At full width and one pixel tall it collapses to an invisible hairline.
 */
const BLANK_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAABKwAAAABCAYAAADzajZqAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHElEQVRYw+3BMQEAAADCoPVPbQ0PoAAAAADgyAASsQABr00tewAAAABJRU5ErkJggg==',
	'base64',
);

const CACHE_HEADERS = {
	// Short cache: campaigns turn over on a schedule, and a stale banner sitting
	// in Gmail's proxy cache is the failure mode to avoid.
	'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=60',
};

function blankResponse(): Response {
	return new Response(new Uint8Array(BLANK_PNG), {
		headers: { 'Content-Type': 'image/png', ...CACHE_HEADERS },
	});
}

export const GET: APIRoute = async ({ url }) => {
	const email = (url.searchParams.get('user') ?? '').toLowerCase().trim();
	const section = url.searchParams.get('section') ?? 'card';

	if (!email) return blankResponse();

	try {
		const config = await resolveCtaConfig(email);
		return await drawCta(config, section);
	} catch (error) {
		// Never surface an error status here. These URLs are embedded in emails
		// that are already sent, and a non-image response renders as a broken-image
		// icon in every signature at once. A blank pixel fails invisibly, and the
		// short cache means the banner reappears as soon as the fault clears.
		console.error('[cta] render failed, serving blank', error);
		return blankResponse();
	}
};

/**
 * Draw the CTA image from an already-resolved config.
 *
 * Split from the route so it can be rendered without a database — the dev
 * preview needs to show the real artwork while iterating on the design, and
 * requiring Postgres for that would make the preview useless on a laptop.
 */
export async function drawCta(config: CtaConfig, section: string): Promise<Response> {
	if (config.disableCta) return blankResponse();

	const fonts = await loadFonts();

	const hasPromo = !config.disablePromo && Boolean(config.promoImageUrl);
	// Promo art is assumed 3:1. The admin upload should enforce that, or this
	// should read the real dimensions.
	const promoHeight = hasPromo ? Math.round(CONTENT_WIDTH / 3) : 0;

	// --- Promo alone -----------------------------------------------------------
	if (section === 'promo' || config.promoOnly) {
		if (!hasPromo) return blankResponse();

		return new ImageResponse(
			card([
				h('img', {
					src: config.promoImageUrl,
					style: {
						width: `${CONTENT_WIDTH}px`,
						height: `${promoHeight}px`,
						objectFit: 'cover',
						borderRadius: `${px(radius.button)}px`,
					},
				}),
			]),
			{
				width: WIDTH,
				height: promoHeight + PADDING * 2 + BORDER * 2,
				fonts,
				headers: CACHE_HEADERS,
			},
		);
	}

	if (section !== 'card') return blankResponse();

	// --- The full card ---------------------------------------------------------
	const lines = headingLines(config.headingText);
	const lineCount = estimateLines(config.headingText, HEADING_SIZE, CONTENT_WIDTH);

	const height =
		PADDING * 2 +
		BORDER * 2 +
		lineCount * HEADING_LINE +
		HEADING_GAP +
		(hasPromo ? promoHeight + HEADING_GAP : 0) +
		px(BUTTON_HEIGHT);

	return new ImageResponse(
		card([
			h(
				'div',
				{ style: { display: 'flex', flexDirection: 'column' } },
				...lines.map((line) =>
					h(
						'div',
						{
							style: {
								fontSize: HEADING_SIZE,
								lineHeight: `${HEADING_LINE}px`,
								// Weight 400 — body copy. The heading is a sentence, not a
								// display heading, and 800 here would shout.
								fontWeight: 400,
								color: brand.ink,
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
							marginTop: `${HEADING_GAP}px`,
							objectFit: 'cover',
							borderRadius: `${px(radius.button)}px`,
						},
					})
				: null,
			// Brand primary button: 44px tall, 6px radius, ink background, white
			// label at weight 500.
			h(
				'div',
				{
					style: {
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						alignSelf: 'flex-start',
						marginTop: `${HEADING_GAP}px`,
						height: `${px(BUTTON_HEIGHT)}px`,
						padding: `0 ${px(24)}px`,
						backgroundColor: brand.ink,
						color: brand.white,
						borderRadius: `${px(radius.button)}px`,
						fontSize: BUTTON_FONT,
						fontWeight: 500,
					},
				},
				config.buttonText,
			),
		]),
		{ width: WIDTH, height, fonts, headers: CACHE_HEADERS },
	);
}

/**
 * The brand card wrapper: white, 2px ink border, 12px radius.
 *
 * The border is what makes this read as an intentional card rather than a
 * stray white rectangle when the reader is in dark mode — the one place the
 * image-based approach would otherwise look broken.
 */
function card(children: unknown[]) {
	return h(
		'div',
		{
			style: {
				width: '100%',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'flex-start',
				boxSizing: 'border-box',
				padding: `${PADDING}px`,
				backgroundColor: brand.white,
				border: `${BORDER}px solid ${brand.ink}`,
				borderRadius: `${px(radius.card)}px`,
				fontFamily: 'Poppins',
			},
		},
		...children,
	);
}
