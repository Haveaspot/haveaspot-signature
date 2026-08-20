import { readFileSync } from 'node:fs';
import {
	renderSignature,
	ICON_COUNT,
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
	['disclaimer newlines -> br', html.includes('haveaspot.com<br>')],
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
checks.push([
	'both pills invert in dark mode',
	/\.hsig-logo-pill, \.hsig-icon-pill \{/.test(html),
]);

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
	checks.push(['no numbers means no line break', !noNumbers.includes('<br>\n') && !/<\/a><br>/.test(noNumbers)]);
}

checks.push(['light logo present', html.includes('/logo/logo-light.png')]);
checks.push(['dark logo present', html.includes('/logo/logo-dark.png')]);
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
checks.push(['CTA is a single image', (html.match(/section=card/g) ?? []).length === 1]);
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
const ctaSource = readFileSync('src/pages/api/cta.ts', 'utf8');
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
