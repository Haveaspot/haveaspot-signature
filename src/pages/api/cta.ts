import type { APIRoute } from 'astro';
import { ImageResponse } from '@vercel/og';
import { resolveCtaConfig } from '../../lib/campaigns';
import { recordImpression } from '../../lib/impressions';
import type { CtaConfig } from '../../lib/campaigns';
import {
	brand,
	radius,
	BUTTON_HEIGHT,
	darkModePillSurface,
	darkModeSurface,
	darkModeDivider,
	darkModeInk,
	darkModeButtonSurface,
	darkModeButtonLabel,
} from '../../lib/brand';
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
 * signature that a campaign can change after the fact.
 *
 * An image cannot answer a media query, so dark mode is handled by rendering
 * the card twice — `?theme=light` and `?theme=dark` — and letting the
 * signature's CSS show one and hide the other.
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

/**
 * The banner is served uncacheable, deliberately.
 *
 * These are the headers the WordPress plugin sent, and they are the reason it
 * behaved correctly where this did not. `public, max-age=0, must-revalidate`
 * looks strict and is not: `public` explicitly authorises a shared cache —
 * Gmail proxies every image through one — to store the response, and
 * `must-revalidate` without an ETag or Last-Modified gives that cache nothing
 * to revalidate against. A settings change then never reached anyone who had
 * already opened the email.
 *
 * `no-store` says do not keep a copy at all. `Pragma` and the 1984 `Expires`
 * are for HTTP/1.0-era proxies that ignore Cache-Control, carried over from the
 * plugin — belt and braces on a response that must not be held anywhere.
 *
 * **The cost is a render per open**, since there is no `s-maxage` for Vercel's
 * edge to hold either. That is the trade the plugin made too, and it is the
 * right way round: a banner that is occasionally slow is a smaller problem than
 * a banner that is permanently wrong. If invocation volume ever justifies it,
 * the answer is a cache on *our* side — as the plugin had, a short-lived server
 * cache keyed on a version bumped whenever settings change — never a cache in
 * the reader's mail client, which we cannot reach to clear.
 */
const CACHE_HEADERS = {
	'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
	Pragma: 'no-cache',
	Expires: 'Wed, 11 Jan 1984 05:00:00 GMT',

	/**
	 * Cache on our side, never on theirs — the other half of the plugin's design.
	 *
	 * The plugin paired `no-store` to the client with a five-minute transient on
	 * its own server, so it answered instantly without redrawing. Dropping that
	 * half left every open paying for a full render: ~1.2s before the first byte,
	 * because the promo art is fetched from Blob storage and the card rasterised
	 * from scratch each time.
	 *
	 * `Vercel-CDN-Cache-Control` is read by Vercel's edge and **stripped before
	 * the response reaches the reader**, so it cannot reintroduce the stale
	 * banner bug: the mail client still sees `no-store` and still asks every
	 * time. It just gets an answer from the edge rather than a cold render.
	 *
	 * Sixty seconds, not five minutes. Long enough that repeat opens are free,
	 * short enough that a settings change or a campaign still lands almost at
	 * once — the property that took three attempts to get right.
	 *
	 * The cost is impression precision: when the edge answers, this function
	 * does not run and the open is not counted. Views are already documented as
	 * a floor; this lowers the floor a little further in exchange for a banner
	 * that appears immediately.
	 */
	'Vercel-CDN-Cache-Control': 'max-age=60',
};

/** JPEG quality. 85 is invisible on a photograph at this size. */
const JPEG_QUALITY = 85;

/**
 * No chroma subsampling.
 *
 * JPEG's default halves the resolution of colour information, which is fine for
 * a photograph and poor for everything else in this image: the card is a hard
 * 2px border against a flat background, with text and a coloured button on it.
 * At 4:2:0 the rounded corners came out `#f9fff8` instead of white — a faint
 * halo where the card meets the email. 4:4:4 lands them exactly on the
 * background and costs about 38 KB, on an image that has already dropped from
 * 953 KB to 159 KB.
 */
const JPEG_CHROMA = '4:4:4';

/**
 * Re-encode the rendered card as a JPEG.
 *
 * `ImageResponse` only emits PNG, which stores every pixel exactly. That is the
 * right choice for a logo and the wrong one for a photograph: a banner carrying
 * promo artwork came out at **953 KB**, and since the banner is deliberately
 * uncacheable, every recipient downloaded that on every open. Mail clients
 * paint a PNG as it arrives, so a slow connection showed the top of the card
 * with no bottom edge until the rest landed. JPEG at quality 85 renders the
 * same image at about 120 KB.
 *
 * `background` is the colour behind the card in the signature — white in light
 * mode, the dark surface in dark mode — not the card's own fill. The card has
 * rounded corners, and the pixels outside that radius are transparent so the
 * email shows through. JPEG has no transparency, so those corners have to be
 * painted, and this is the only colour that leaves the result identical. It is
 * exact because light and dark are rendered as separate images.
 *
 * **Falls back to the PNG on any failure, including sharp failing to load.**
 * The import is dynamic for that reason: these URLs sit in signatures that are
 * already sent, so a module that throws on load would replace every banner in
 * every inbox with a broken-image icon. A heavy banner is a far better failure
 * than no banner.
 */
async function toJpeg(png: Buffer, background: string): Promise<Response> {
	try {
		const sharp = (await import('sharp')).default;
		const jpeg = await sharp(png)
			.flatten({ background })
			.jpeg({ quality: JPEG_QUALITY, mozjpeg: true, chromaSubsampling: JPEG_CHROMA })
			.toBuffer();

		return new Response(new Uint8Array(jpeg), {
			headers: { 'Content-Type': 'image/jpeg', ...CACHE_HEADERS },
		});
	} catch (error) {
		console.error('[cta] JPEG encode failed, serving PNG', error);
		return new Response(new Uint8Array(png), {
			headers: { 'Content-Type': 'image/png', ...CACHE_HEADERS },
		});
	}
}

/**
 * Turn a rendered `ImageResponse` into what actually goes down the wire.
 *
 * Two jobs, both of which have bitten this route before: re-encode as JPEG (see
 * `toJpeg`), and make sure our cache headers are the ones that reach the client.
 *
 * `ImageResponse` sets its own `cache-control: public, immutable, no-transform,
 * max-age=31536000`, and passing `headers` does not replace it — the two are
 * concatenated, ours last, which production was serving as:
 *
 *   public, immutable, no-transform, max-age=31536000, public, max-age=0
 *
 * Caches take the first `max-age` they see, and `immutable` tells them not to
 * revalidate at all. Every banner was therefore cached for a **year**: a
 * settings change or a new campaign never reached a signature whose banner had
 * been fetched once, which is the one thing this tool exists to do. It passed
 * every direct test, because a URL fetched for the first time always renders
 * fresh — only a reader who had already seen the banner was stuck with it.
 *
 * The body is copied into a plain Response rather than mutating headers on the
 * original, because `headers.set()` leaves the concatenated value in place.
 */
async function deliver(image: Response, background: string): Promise<Response> {
	return toJpeg(Buffer.from(await image.arrayBuffer()), background);
}

function blankResponse(): Response {
	return new Response(new Uint8Array(BLANK_PNG), {
		headers: { 'Content-Type': 'image/png', ...CACHE_HEADERS },
	});
}

export const GET: APIRoute = async ({ url }) => {
	const email = (url.searchParams.get('user') ?? '').toLowerCase().trim();
	const section = url.searchParams.get('section') ?? 'card';
	const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';

	if (!email) return blankResponse();

	try {
		const config = await resolveCtaConfig(email);

		/**
		 * Count the impression.
		 *
		 * Light only. Every signature contains exactly one `theme=light` banner
		 * and — for everything except Outlook — a hidden `theme=dark` one beside
		 * it, which most clients fetch too. Counting both would double the figure
		 * for some clients and not others; counting light gives one impression
		 * per open everywhere.
		 *
		 * Skipped when the banner is suppressed, because a blank spacer is not an
		 * impression of anything.
		 *
		 * Awaited, not fire-and-forget: a serverless function can be frozen the
		 * moment the response is returned, which drops the write. Wrapped in its
		 * own catch because analytics must never cost anyone their banner — the
		 * image is already in an inbox and cannot be corrected after the fact.
		 */
		if (theme === 'light' && !config.disableCta) {
			try {
				await recordImpression(email, config.campaign?.id ?? null);
			} catch (error) {
				console.error('[cta] impression not recorded', error);
			}
		}

		return await drawCta(config, section, theme);
	} catch (error) {
		// Never surface an error status here. These URLs are embedded in emails
		// that are already sent, and a non-image response renders as a broken-image
		// icon in every signature at once. A blank pixel fails invisibly, and the
		// short cache means the banner reappears as soon as the fault clears.
		console.error('[cta] render failed, serving blank', error);
		return blankResponse();
	}
};

export type CtaTheme = 'light' | 'dark';

/**
 * Draw the CTA image from an already-resolved config.
 *
 * Split from the route so it can be rendered without a database — the dev
 * preview needs to show the real artwork while iterating on the design, and
 * requiring Postgres for that would make the preview useless on a laptop.
 *
 * `theme` exists because an image cannot answer a media query: the mail client
 * just fetches a URL and tells the server nothing about the reader's
 * appearance setting. So both themes are rendered as separate images and the
 * signature's CSS swaps between them, the same way it swaps the logo.
 */
export async function drawCta(
	config: CtaConfig,
	section: string,
	theme: CtaTheme = 'light',
): Promise<Response> {
	if (config.disableCta) return blankResponse();

	const fonts = await loadFonts();
	const dark = theme === 'dark';

	// The dark card must match the logo pill's fill exactly, since the two sit
	// one above the other in the same signature.
	const surface = dark ? darkModePillSurface : brand.white;
	// What sits *behind* the card in the signature. Used to paint the rounded
	// corners when the PNG is flattened to JPEG, which has no transparency.
	const pageBackground = dark ? darkModeSurface : brand.white;
	const borderColour = dark ? darkModeDivider : brand.ink;
	const textColour = dark ? darkModeInk : brand.ink;
	const buttonSurface = dark ? darkModeButtonSurface : brand.ink;
	const buttonLabel = dark ? darkModeButtonLabel : brand.white;

	const hasPromo = !config.disablePromo && Boolean(config.promoImageUrl);
	// Promo art is assumed 3:1. The admin upload should enforce that, or this
	// should read the real dimensions.
	const promoHeight = hasPromo ? Math.round(CONTENT_WIDTH / 3) : 0;

	// --- Promo alone -----------------------------------------------------------
	if (section === 'promo' || config.promoOnly) {
		if (!hasPromo) return blankResponse();

		return deliver(
			new ImageResponse(
				card(surface, borderColour, [
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
			),
			pageBackground,
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

	return deliver(
		new ImageResponse(
			card(surface, borderColour, [
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
									// Weight 800 — the brand's H1/H2 weight. Heavier than the
									// card-title 700, on the reading that this line is the
									// signature's one piece of display type.
									fontWeight: 800,
									color: textColour,
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
							backgroundColor: buttonSurface,
							color: buttonLabel,
							borderRadius: `${px(radius.button)}px`,
							fontSize: BUTTON_FONT,
							fontWeight: 500,
						},
					},
					config.buttonText,
				),
			]),
			{ width: WIDTH, height, fonts, headers: CACHE_HEADERS },
		),
		pageBackground,
	);
}

/**
 * The brand card wrapper: white, 2px ink border, 12px radius.
 *
 * The border is what makes this read as an intentional card rather than a
 * stray white rectangle when the reader is in dark mode — the one place the
 * image-based approach would otherwise look broken.
 */
function card(surface: string, borderColour: string, children: unknown[]) {
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
				backgroundColor: surface,
				border: `${BORDER}px solid ${borderColour}`,
				borderRadius: `${px(radius.card)}px`,
				fontFamily: 'Poppins',
			},
		},
		...children,
	);
}
