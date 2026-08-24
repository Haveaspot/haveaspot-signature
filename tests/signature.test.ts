import { readFileSync } from 'node:fs';
import {
	renderSignature,
	ICON_COUNT,
	ICON_SIZE,
	ICON_GAP,
	ICON_PILL_PADDING_X,
	ICON_PILL_WIDTH,
	LOGO_PILL_WIDTH,
	PILL_HEIGHT,
	PILL_GAP,
} from '../src/lib/signature-html.ts';
import { SETTING_DEFAULTS } from '../src/lib/settings.ts';
import { estimateLines, headingLines } from '../src/lib/og.ts';

const settings = { ...SETTING_DEFAULTS } as any;

const baseConfig = {
	headingText: settings.global_cta_text,
	buttonText: 'Find Out More',
	buttonUrl: 'https://haveaspot.com',
	promoImageUrl: '',
	disableCta: false,
	disablePromo: false,
	promoOnly: false,
	campaign: null,
	signature: null,
} as any;

const fields = {
	firstName: 'Ross',
	lastName: 'Chesterfield',
	jobTitle: 'Founder & CEO',
	email: 'ross@haveaspot.com',
	mobile: '07700 900123',
	office: '01823 555000',
};

const html = renderSignature({
	fields,
	config: baseConfig,
	settings,
	baseUrl: 'https://sig.haveaspot.com',
	version: 'test',
});

// --- Assertions -------------------------------------------------------------
const checks: [string, boolean][] = [
	['contains first name', html.includes('Ross')],
	['contains last name', html.includes('Chesterfield')],
	// Brand rule: green is an action/hover colour, never a default text colour.
	// Email has no hover, so the only green in a signature is inside the logo
	// artwork — none should appear in the markup.
	['no green in the markup', !html.includes('#0AAD0A')],
	['ink colour used', html.includes('#021300')],
	// Brand rule: never grey text. Lightness comes from weight 300.
	['no grey text', !/#6B7280|#374151|#888888|#666666/i.test(html)],
	['disclaimer uses weight 300', /font-size:11px; font-weight:300/.test(html)],
	// The legacy dashed/grey treatment is gone.
	['no dashed borders', !html.includes('dashed')],
	['white background', html.includes('background-color:#FFFFFF')],
	// #F9FAFB is legitimate on a pill but must never fill the signature body —
	// that grey wash was the legacy look being removed. Asserted by context
	// rather than by count, so adding another pill does not break the test while
	// a stray body fill still would.
	[
		'surface fill only ever appears on a pill',
		html
			.split('\n')
			.filter((line) => line.includes('#F9FAFB'))
			.every((line) => line.includes('-pill')),
	],
	['body cells are white', !/<td[^>]*background-color:#F9FAFB[^>]*class="hsig-td"/.test(html)],
	['hairline divider above disclaimer', html.includes('border-top:1px solid #E5E7EB')],
	['no Settlin navy', !html.includes('#010334')],
	['no Cal Sans', !html.includes('Cal Sans')],
	['absolute cta image', html.includes('https://sig.haveaspot.com/api/cta?user=ross%40haveaspot.com')],
	['tel href stripped', html.includes('tel:07700900123')],
	['vcard link', html.includes('/api/vcard?user=')],
	['tracked cta link', html.includes('/api/track/cta?user=')],
	['dark mode block', html.includes('prefers-color-scheme: dark')],
	['600px width', html.includes('max-width:600px')],
	['disclaimer newlines -> br', html.includes('Somerset TA21 8SN<br>')],
];

// --- Logo -------------------------------------------------------------------
// Two variants ship so the green "a" survives dark mode; the icons' invert
// filter must never be applied to the wordmark, and Outlook must only ever see
// the light one.
// The logo pill uses the brand's surface + non-featured border + pill radius,
// and must invert in dark mode — left at #F9FAFB it would put the white
// dark-mode wordmark on a near-white fill.
checks.push(['pill uses brand surface', html.includes('background-color:#F9FAFB')]);
checks.push(['pill uses light border', html.includes('border:1px solid #E5E7EB')]);
checks.push(['pill is fully rounded', html.includes('border-radius:100px')]);
// bgcolor attribute as well as the style, for Outlook's Word renderer.
checks.push(['pill has bgcolor attribute for Outlook', html.includes('bgcolor="#F9FAFB"')]);

// The two pills are only the same width because the icon padding was computed
// from the icon count and spacing. Adding a fifth icon, or changing the gap,
// silently breaks that alignment — so assert the arithmetic still holds.
//
// Computed from the exported geometry rather than scraped back out of the
// markup: regexes over HTML were getting this wrong in both directions (the
// icon <img> puts class before width, the logo <img> the other way round),
// which is a brittle way to test a number the module already knows.
checks.push([
	`pills are the same width (icon ${ICON_PILL_WIDTH} vs logo ${LOGO_PILL_WIDTH})`,
	ICON_PILL_WIDTH === LOGO_PILL_WIDTH,
]);
checks.push([
	'icon count matches the geometry constant',
	(html.match(/class="hsig-icon"/g) ?? []).length === ICON_COUNT,
]);
checks.push(['icon pill shares the pill styling', html.includes('hsig-icon-pill')]);

// Regression: the icons used to be inline images spaced with `margin-right`,
// with exactly zero slack inside the pill, so any mobile client that scaled the
// message down wrapped the last icon onto a second line. One cell per icon
// cannot wrap. Guard both halves — the cells, and the absence of the margins.
{
	const iconCells = (
		html.match(new RegExp(`width:${ICON_SIZE}px;[^"]*padding:0`, 'g')) ?? []
	).length;
	checks.push([
		`each icon sits in its own cell (found ${iconCells} of ${ICON_COUNT})`,
		iconCells === ICON_COUNT,
	]);
}
checks.push([
	'icons are not spaced with margins, which wrap',
	!new RegExp(`class="hsig-icon"[^>]*margin-right`).test(html),
]);
checks.push([
	'the icon pill refuses to wrap',
	/hsig-icon-pill[^>]*white-space:nowrap/.test(html),
]);

// The pill's total width is fixed by the logo pill, so the only slack the icon
// row can have is padding it can give back under a client's rescaling. Keeping
// the padding wider than the gaps is what reserves that slack; putting the
// width back into the gaps would look identical and wrap again on mobile.
checks.push([
	`padding (${ICON_PILL_PADDING_X}) leaves slack over the gaps (${ICON_GAP})`,
	ICON_PILL_PADDING_X > ICON_GAP,
]);

// The right column mirrors the left column's 44 / 10 / 44 bands so the name and
// title centre against the logo pill and the contact line against the icon
// pill. Two banded cells on each side, and the gap rows share one constant.
{
	const bandCells = (html.match(new RegExp(`height:${PILL_HEIGHT}px`, 'g')) ?? []).length;
	const gapRows = (html.match(new RegExp(`height:${PILL_GAP}px`, 'g')) ?? []).length;
	checks.push([`right column mirrors the pill bands (${bandCells} banded cells)`, bandCells === 2]);
	checks.push([`both columns share one gap (${gapRows} gap rows)`, gapRows === 2]);
}
// With no job title the name must still centre in its band rather than ride to
// the top — which is what a hand-tuned margin would have done.
{
	const noTitle = renderSignature({
		fields: { ...fields, jobTitle: '' },
		config: baseConfig,
		settings,
		baseUrl: 'https://x.test',
		version: 'test',
	});
	checks.push([
		'banded layout survives a missing job title',
		(noTitle.match(new RegExp(`height:${PILL_HEIGHT}px`, 'g')) ?? []).length === 2,
	]);
}
// Only the icon pill is CSS-drawn now, so only it needs a dark-mode rule. The
// logo pill carries its own baked background and must NOT have one — a CSS
// background behind an image that already has one would show as a fringe.
checks.push(['icon pill inverts in dark mode', /\.hsig-icon-pill \{/.test(html)]);
checks.push(['logo pill has no CSS background to invert', !html.includes('hsig-logo-pill')]);

// --- Disclaimer links -------------------------------------------------------
// Gmail auto-links anything address-shaped in its own blue, which was the only
// off-brand colour left. Linking them ourselves first keeps them #021300 —
// Gmail only auto-links text that is not already a link.
checks.push([
	'disclaimer email is linked in brand ink',
	/<a class="hsig-link" href="mailto:support@haveaspot\.com" style="color:#021300/.test(html),
]);
checks.push([
	'disclaimer domain is linked in brand ink',
	/<a class="hsig-link" href="https:\/\/haveaspot\.com" style="color:#021300/.test(html),
]);
checks.push(['no blue anywhere', !/#1155cc|#0000ee|blue/i.test(html)]);

// The linkifier must not turn ordinary prose into links. These are the phrases
// in the real disclaimer most likely to trip a naive word.word pattern.
{
	const prose = renderSignature({
		fields,
		config: baseConfig,
		settings: {
			...settings,
			disclaimer_text:
				'Contact e.g. the sender and delete the message. This does not constitute legal advice. See www.haveaspot.com or mail support@haveaspot.com.',
		},
		baseUrl: 'https://x.test',
		version: 'test',
	});
	const disclaimer = prose.slice(prose.lastIndexOf('hsig-disc'));
	const links = (disclaimer.match(/href="(?:mailto:|https:\/\/)/g) ?? []).length;
	checks.push([`only real links in the disclaimer (${links} found, expected 2)`, links === 2]);
	checks.push(['"e.g." is not linked', !prose.includes('href="https://e.g')]);
	checks.push(['sentence-ending "advice." is not linked', !/href="[^"]*advice/.test(prose)]);
}

// --- CTA dark mode ----------------------------------------------------------
// The CTA is a PNG and cannot answer a media query, so both themes are rendered
// and swapped by CSS — the same approach as the logo.
checks.push(['light CTA render requested', html.includes('section=card&theme=light')]);
checks.push(['dark CTA render requested', html.includes('section=card&theme=dark')]);
checks.push([
	'dark CTA hidden by default',
	html.includes('class="hsig-cta-dark" style="display:none;'),
]);
checks.push([
	'dark CTA hidden from Outlook',
	/hsig-cta-dark[^>]*mso-hide:all/.test(html),
]);
checks.push(['CTA swaps in dark mode', /\.hsig-cta-light \{ display: none/.test(html)]);

// --- Contact line -----------------------------------------------------------
// Phones belong on their own line under the email, and the pipe is a separator
// between numbers rather than a prefix on each — so nothing starts with a pipe.
{
	// Anchored to the mailto link specifically: the icon links close earlier in
	// the markup, so splitting on the first </a> lands in the left column.
	checks.push([
		'phones break onto their own line',
		/href="mailto:[^"]*"[^>]*>[^<]*<\/a><br>/.test(html),
	]);
	checks.push([
		'no pipe before the first number',
		!/<br>\s*<span class="hsig-pipe"/.test(html),
	]);
	checks.push([
		'one pipe between two numbers',
		(html.match(/class="hsig-pipe"/g) ?? []).length === 1,
	]);

	// A single number must carry no pipe at all.
	const oneNumber = renderSignature({
		fields: { ...fields, office: '' },
		config: baseConfig,
		settings,
		baseUrl: 'https://x.test',
		version: 'test',
	});
	checks.push(['single number has no pipe', !oneNumber.includes('class="hsig-pipe"')]);
	checks.push(['single number still breaks to its own line', oneNumber.includes('<br>')]);

	// No numbers at all: no stray break to push the email off-centre.
	const noNumbers = renderSignature({
		fields: { ...fields, mobile: '', office: '' },
		config: baseConfig,
		settings,
		baseUrl: 'https://x.test',
		version: 'test',
	});
	// Scoped to the mailto anchor: the disclaimer's linked domain also produces
	// </a><br>, so an unscoped check would now fail on unrelated markup.
	checks.push([
		'no numbers means no line break',
		!new RegExp(`href="mailto:${fields.email}"[^>]*>[^<]*</a><br>`).test(noNumbers),
	]);
}

// The pill is baked into the artwork rather than styled in CSS, so clients that
// impose their own dark mode cannot invert the background out from under the
// wordmark. Verified in Gmail, which strips the stylesheet and every class.
checks.push(['light logo pill present', html.includes('/logo/logo-pill-light.png')]);
checks.push(['dark logo pill present', html.includes('/logo/logo-pill-dark.png')]);
checks.push([
	'logo pill is sized to the pill, not the wordmark',
	new RegExp(`width="${LOGO_PILL_WIDTH}" height="${PILL_HEIGHT}"`).test(html),
]);
checks.push(['dark logo hidden by default', html.includes('class="hsig-logo-dark" style="display:none;')]);
checks.push(['dark logo behind mso conditional', html.includes('<!--[if !mso]><!-->')]);
checks.push(['logo not inverted like the icons', !html.includes('.hsig-logo {')]);

// XSS: a name containing markup must come out escaped.
const evil = renderSignature({
	fields: { ...fields, firstName: '<script>alert(1)</script>' },
	config: baseConfig,
	settings,
	baseUrl: 'https://x.test',
	version: 'test',
});
checks.push(['escapes injected script', !evil.includes('<script>alert(1)</script>')]);
checks.push(['escaped form present', evil.includes('&lt;script&gt;')]);

// disableCta must drop the CTA rows entirely.
const off = renderSignature({
	fields,
	config: { ...baseConfig, disableCta: true },
	settings,
	baseUrl: 'https://x.test',
	version: 'test',
});
checks.push(['disableCta removes image rows', !off.includes('/api/cta?')]);

// promoOnly must drop the button but keep a promo render.
const promoOnly = renderSignature({
	fields,
	config: { ...baseConfig, promoOnly: true, promoImageUrl: 'https://x.test/p.png' },
	settings,
	baseUrl: 'https://x.test',
	version: 'test',
});
// The CTA is now a single image whatever the mode — drawCta decides internally
// whether that is heading + button or the promo alone, so the markup asks for
// one `section=card` either way and there is no second request to drop.
checks.push(['promoOnly still renders one CTA image', promoOnly.includes('section=card')]);
// Two card requests, not one: they are the light and dark alternates, only one
// of which is ever displayed. The point of the earlier merge stands — heading
// and button are one composition rather than two stacked images — so what
// matters is that there is no separate button render.
checks.push(['CTA card requested once per theme', (html.match(/section=card/g) ?? []).length === 2]);
checks.push([
	'exactly one CTA visible at a time',
	(html.match(/class="hsig-cta-dark" style="display:none;/g) ?? []).length === 1,
]);
checks.push(['no separate button image', !html.includes('section=button')]);

// Heading helpers
checks.push(['pipe splits lines', headingLines('One | Two | Three').length === 3]);
checks.push(['short text is one line', estimateLines('Hello there', 28, 1096) === 1]);
checks.push([
	'long text wraps',
	estimateLines('word '.repeat(60), 28, 1096) > 1,
]);

// --- Regression: the blank CTA spacer must be wide, not square ---------------
// The signature renders the CTA images at `width:100%; height:auto`. A 1x1
// pixel therefore stretches into a 598px-tall empty block in the middle of the
// email; only a full-width, one-pixel-tall image collapses to an invisible
// hairline. This was a real bug, caught by rendering the signature in a browser.
// Resolved from cwd, not import.meta.url: the runner bundles this file to the
// project root, which would shift any URL-relative path up a directory.
/**
 * The generator's dark preview has to force the signature's dark rules on.
 *
 * They live in a `prefers-color-scheme: dark` block, which answers the reader's
 * operating system and not a button on the page — so without this the toggle
 * darkened the stage behind the signature and left the signature light, which
 * reads as dark mode being broken.
 *
 * Asserted against the source because the failure is invisible on a machine set
 * to dark mode: there the rules apply anyway and the preview looks correct.
 */
{
	const indexSource = readFileSync('src/pages/index.astro', 'utf8');
	checks.push([
		'the generator forces dark rules under the dark preview class',
		/darkRulesCss\(\s*'\.preview-stage--dark\s'\s*\)/.test(indexSource),
	]);
	checks.push([
		'those rules are re-emitted, not copied',
		indexSource.includes("import { darkRulesCss }"),
	]);
}

const ctaSource = readFileSync('src/pages/api/cta.ts', 'utf8');

/**
 * The banner must never be served as immutable.
 *
 * `ImageResponse` sets its own year-long immutable cache-control and passing
 * `headers` only appends to it, so every banner was cached for a year and a
 * settings or campaign change never reached a signature that had been opened
 * once. The route now re-wraps the response; these guard the wrapping.
 */
checks.push([
	'cta responses are re-wrapped so our cache header wins',
	/async function deliver/.test(ctaSource) && !/return new ImageResponse/.test(ctaSource),
]);
/**
 * These are the WordPress plugin's headers, kept because they are the reason it
 * behaved correctly. `public` is the trap: it authorises Gmail's shared image
 * proxy to store the banner, and a stored banner is a permanently wrong one.
 */
{
	const from = ctaSource.indexOf('const CACHE_HEADERS');
	const cacheBlock = ctaSource.slice(from, ctaSource.indexOf('};', from));
	checks.push(['the banner is sent no-store', /no-store/.test(cacheBlock)]);
	checks.push(['the banner is never sent as public', !/public/.test(cacheBlock)]);
	checks.push([
		'HTTP/1.0 proxies are covered too',
		/Pragma/.test(cacheBlock) && /Expires/.test(cacheBlock),
	]);
	/**
	 * The edge cache is what makes the banner appear instantly. It is safe only
	 * because Vercel strips this header before the response reaches the reader —
	 * a plain `s-maxage` here would let a mail client cache it and bring the
	 * stale-banner bug straight back.
	 */
	checks.push([
		'the edge caches, briefly',
		/'Vercel-CDN-Cache-Control': 'max-age=60'/.test(cacheBlock),
	]);
	checks.push(['no s-maxage, which the client would also see', !/s-maxage/.test(cacheBlock)]);
}

/**
 * The banner is re-encoded as JPEG because PNG stores a photograph losslessly —
 * a promo banner came out at 953 KB, downloaded on every open since the image
 * is deliberately uncacheable.
 *
 * The two things that must not regress: the encoder failing can never cost
 * anyone their banner, and the transparent spacer must stay a PNG. Flattening
 * that to JPEG would paint a visible bar across every signature that has no
 * banner.
 */
checks.push([
	'the card is re-encoded as JPEG',
	/\.jpeg\(\{ quality: JPEG_QUALITY/.test(ctaSource),
]);
checks.push([
	'a failed encode falls back to the PNG rather than failing',
	/catch \(error\) \{[\s\S]{0,200}serving PNG/.test(ctaSource),
]);
checks.push([
	'sharp is imported dynamically, so a load failure is catchable',
	/await import\('sharp'\)/.test(ctaSource) && !/^import sharp/m.test(ctaSource),
]);
checks.push([
	'the transparent spacer is never flattened to JPEG',
	/function blankResponse[\s\S]{0,300}image\/png/.test(ctaSource),
]);
checks.push([
	'chroma subsampling is off, so hard edges keep their colour',
	/chromaSubsampling: JPEG_CHROMA/.test(ctaSource) && /'4:4:4'/.test(ctaSource),
]);
const spacerBase64 = ctaSource.match(/BLANK_PNG = Buffer\.from\(\s*'([^']+)'/)?.[1] ?? '';
const spacerPng = Buffer.from(spacerBase64, 'base64');

// PNG IHDR layout: 8-byte signature, 4-byte length, 4-byte type, width, height.
const spacerWidth = spacerPng.readUInt32BE(16);
const spacerHeight = spacerPng.readUInt32BE(20);

checks.push([
	`blank spacer is full-width and 1px tall (${spacerWidth}x${spacerHeight})`,
	spacerWidth > 1000 && spacerHeight === 1,
]);

let failed = 0;
for (const [name, pass] of checks) {
	console.log(`${pass ? '  ok' : 'FAIL'}  ${name}`);
	if (!pass) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
