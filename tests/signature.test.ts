import { readFileSync } from 'node:fs';
import { renderSignature } from '../src/lib/signature-html.ts';
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
	// #F9FAFB is legitimate as a small surface (the logo pill) but must not fill
	// the signature body — that grey wash was the legacy look being removed.
	// Two occurrences: the bgcolor attribute and the style declaration, both on
	// the pill cell.
	['surface fill limited to the pill', (html.match(/#F9FAFB/g) ?? []).length === 2],
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
checks.push([
	'pill inverts in dark mode',
	/\.hsig-logo-pill \{[^}]*background-color: rgba\(255,255,255/.test(html),
]);
// bgcolor attribute as well as the style, for Outlook's Word renderer.
checks.push(['pill has bgcolor attribute for Outlook', html.includes('bgcolor="#F9FAFB"')]);

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
