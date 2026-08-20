import {
	brand,
	radius,
	emailFontStack,
	darkModeInk,
	darkModeSurface,
	darkModeDivider,
	darkModePillSurface,
} from './brand';
import type { CtaConfig } from './campaigns';
import type { Settings } from './settings';

export interface SignatureFields {
	firstName: string;
	lastName: string;
	jobTitle: string;
	email: string;
	mobile: string;
	office: string;
}

/** Escape untrusted values before they go into the email markup. */
function esc(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** `tel:` hrefs must be digits and a leading + only. */
function telHref(phone: string): string {
	return phone.replace(/[^0-9+]/g, '');
}

/**
 * Dark-mode overrides, as structured rules rather than a CSS string.
 *
 * Kept in this shape so the dev preview can re-emit the exact same rules under
 * a forcing class instead of keeping its own copy. A duplicated stylesheet
 * would drift, and the preview would quietly stop reflecting what actually
 * lands in someone's inbox — which is the one job it has.
 */
const DARK_RULES: readonly (readonly [string, string])[] = [
	[
		'.hsig-tbl, .hsig-td',
		`background-color: ${darkModeSurface} !important; color: ${darkModeInk} !important;`,
	],
	// Everything stays monochrome, matching light mode where text and links are
	// both #021300. Green is an action colour and there is no action to signal.
	// `.hsig-disc p` is not redundant: the class sits on the <td>, but the
	// paragraph inside carries its own inline colour, which wins over an
	// inherited one. Without the descendant selector the disclaimer stays
	// #021300 and vanishes against the dark background.
	[
		'.hsig-name, .hsig-txt, .hsig-link, .hsig-disc, .hsig-disc p, .hsig-pipe',
		`color: ${darkModeInk} !important;`,
	],
	['.hsig-disc', `border-top-color: ${darkModeDivider} !important;`],
	// The pill must invert with everything else. Left at #F9FAFB it would put
	// the white dark-mode wordmark on a near-white fill, i.e. invisible.
	[
		'.hsig-logo-pill',
		`background-color: ${darkModePillSurface} !important; border-color: ${darkModeDivider} !important;`,
	],
	['.hsig-icon', 'filter: brightness(0) invert(1) !important;'],
	['.hsig-logo-light', 'display: none !important;'],
	['.hsig-logo-dark', 'display: block !important;'],
];

/**
 * Render the dark rules, optionally scoped under a prefix.
 *
 * No prefix: used inside the signature's own `prefers-color-scheme` query.
 * With a prefix (e.g. `.force-dark `): used by the dev preview to show the dark
 * treatment without changing the operating system's appearance setting.
 */
export function darkRulesCss(prefix = ''): string {
	return DARK_RULES.map(([selector, declarations]) => {
		const scoped = selector
			.split(',')
			.map((s) => `${prefix}${s.trim()}`)
			.join(', ');
		return `${scoped} { ${declarations} }`;
	}).join('\n\t\t');
}

/**
 * The rendered email signature.
 *
 * Constraints that drive every odd-looking choice below:
 *  - Table layout with inline styles. Outlook renders through Word, which
 *    ignores flex/grid and most <style> rules.
 *  - Fixed 600px. The universal safe width for desktop mail clients.
 *  - The CTA block is a server-rendered PNG rather than HTML, because that is
 *    the only way to guarantee identical typography across Outlook, Gmail and
 *    Apple Mail. This is the one place where the plugin's approach is genuinely
 *    the right one, so it is preserved.
 *  - Dark mode via injected media query + class hooks; clients that ignore it
 *    simply keep the light design.
 */
export function renderSignature(opts: {
	fields: SignatureFields;
	config: CtaConfig;
	settings: Settings;
	baseUrl: string;
	/** Cache-buster so a re-generated signature does not show stale images. */
	version?: string;
}): string {
	const { fields, config, settings, baseUrl } = opts;
	const v = opts.version ?? String(Date.now());
	const email = fields.email.toLowerCase();
	const q = encodeURIComponent(email);

	// Every URL baked into the signature must be absolute — the email is read
	// far away from this server.
	const ctaImage = (section: string) =>
		`${baseUrl}/api/cta?user=${q}&section=${section}&v=${v}`;
	const track = (asset: string) => `${baseUrl}/api/track/${asset}?user=${q}`;
	const vcardUrl = `${baseUrl}/api/vcard?user=${q}`;
	const ctaLink = `${baseUrl}/api/track/cta?user=${q}`;

	const icons = [
		{ url: settings.icon_web || `${baseUrl}/icons/web.png`, href: track('website'), title: 'Website' },
		{ url: settings.icon_mail || `${baseUrl}/icons/mail.png`, href: track('mail'), title: 'Email us' },
		{ url: settings.icon_li || `${baseUrl}/icons/linkedin.png`, href: track('linkedin'), title: 'LinkedIn' },
		{ url: settings.icon_vcard || `${baseUrl}/icons/vcard.png`, href: vcardUrl, title: 'Save contact' },
	];

	// Phones are appended after the email address, each behind a pipe. Rendered
	// as nowrap spans so a number never breaks across two lines.
	const phoneParts = [fields.mobile, fields.office]
		.filter(Boolean)
		.map(
			(phone) =>
				`<span class="hsig-pipe" style="display:inline-block; white-space:nowrap; color:${brand.ink};">&nbsp;|&nbsp;<a class="hsig-link" href="tel:${esc(telHref(phone))}" style="color:${brand.ink}; text-decoration:none;">${esc(phone)}</a></span>`,
		)
		.join('');

	const iconsHtml = icons
		.map(
			(icon, i) =>
				`<a href="${esc(icon.href)}" style="text-decoration:none;" title="${esc(icon.title)}"><img class="hsig-icon" src="${esc(icon.url)}?v=${v}" width="20" height="20" alt="${esc(icon.title)}" style="display:inline-block; ${i < icons.length - 1 ? 'margin-right:12px;' : ''} vertical-align:middle; border:none; outline:none;"></a>`,
		)
		.join('');

	const disclaimerHtml = esc(settings.disclaimer_text).replace(/\n/g, '<br>');

	/**
	 * The logo is swapped for dark mode rather than filtered.
	 *
	 * The icons can be recoloured with `brightness(0) invert(1)` because they are
	 * single-colour silhouettes, but the wordmark carries the green "a" — that
	 * filter would flatten it to plain white and throw the brand mark away. So
	 * two variants ship, and the media query picks one.
	 *
	 * The dark variant is wrapped in a `<!--[if !mso]>` conditional because
	 * Outlook ignores media queries entirely and would otherwise render both
	 * logos stacked. Hiding it from Outlook leaves that client on the light
	 * wordmark, which is correct: Outlook is not applying dark mode either.
	 */
	const logoLight = settings.logo_url || `${baseUrl}/logo/logo-light.png`;
	const logoDark = settings.logo_url_dark || `${baseUrl}/logo/logo-dark.png`;

	/**
	 * The mark sits in a pill: `#F9FAFB` surface, `#E5E7EB` hairline border,
	 * 20px radius — the brand's subtle-surface and pill-radius tokens.
	 *
	 * Built as a nested single-cell table rather than a styled div, because
	 * Outlook renders through Word and will not give a div a reliable background
	 * or padding. Word also ignores `border-radius`, so Outlook shows a square-
	 * cornered panel — the fill and border still read correctly, which is the
	 * right way for this to degrade.
	 *
	 * Sizing is chosen so the pill lands on 44px tall — the brand's button
	 * height — rather than an arbitrary number. The wordmark is 5:1, so a 110px
	 * logo is 22px tall, plus 10px padding top and bottom and the 1px border.
	 * That gives a 148×44 pill: wide enough relative to its height to read as a
	 * pill rather than a lozenge.
	 */
	const logoWidth = 110;
	const logoHtml = `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
							<tr>
								<td class="hsig-logo-pill" align="center" valign="middle" bgcolor="${brand.surface}" style="background-color:${brand.surface}; border:1px solid ${brand.borderLight}; border-radius:${radius.pill}px; padding:10px 18px; text-align:center; vertical-align:middle;">
									<img src="${esc(logoLight)}?v=${v}" width="${logoWidth}" alt="Haveaspot" class="hsig-logo-light" style="display:block; border:none; outline:none; margin:0 auto;">
									<!--[if !mso]><!-->
									<img src="${esc(logoDark)}?v=${v}" width="${logoWidth}" alt="Haveaspot" class="hsig-logo-dark" style="display:none; border:none; outline:none; margin:0 auto; mso-hide:all;">
									<!--<![endif]-->
								</td>
							</tr>
						</table>`;

	/**
	 * The CTA block — one image, wrapped in one link.
	 *
	 * Previously two stacked images (heading, then button) so that only the
	 * button was clickable. Now a single render: it removes the hairline seam
	 * between them, halves the requests, and lets the artwork be laid out as one
	 * composition rather than two that have to agree about their shared edge.
	 * The whole block being clickable is normal for an email banner.
	 *
	 * Omitted entirely when disabled rather than rendered as a transparent
	 * spacer, so there is no stray element for Outlook to mis-space.
	 */
	const ctaRow = config.disableCta
		? ''
		: `
		<tr>
			<td align="left" style="padding:0 0 28px 0; font-size:0; line-height:0; text-align:left;">
				<a href="${esc(ctaLink)}" target="_blank" style="display:block; border:none; text-decoration:none; font-size:0; line-height:0;">
					<img src="${ctaImage('card')}" width="600" alt="${esc(config.headingText.replace(/\s*\|\s*/g, ' '))}" style="display:block; border:none; outline:none; margin:0; padding:0; width:100%; max-width:600px; height:auto;">
				</a>
			</td>
		</tr>`;

	/**
	 * Layout notes, against the brand guide:
	 *
	 *  - White background throughout. `#F9FAFB` is a card surface, not a page
	 *    background, and the old dashed rules and grey fill were inherited from
	 *    a different project.
	 *  - Structure comes from whitespace and one `#E5E7EB` hairline above the
	 *    disclaimer. Dividers are "thin structural lines only"; there is no
	 *    dashed border anywhere in the brand.
	 *  - Every piece of text is `#021300`. Lightness comes from weight — 300 for
	 *    the job title, contact line and disclaimer — never from grey.
	 *  - No green. It is an action/hover colour, and an email has no hover; the
	 *    only green is inside the logo artwork.
	 *  - The logo sits left with a generous gutter rather than a bordered cell,
	 *    so the mark has room instead of being boxed in.
	 */
	return `<style type="text/css">
	:root { color-scheme: light dark; supported-color-schemes: light dark; }
	@media (prefers-color-scheme: dark) {
		${darkRulesCss()}
	}
</style>
<table class="hsig-tbl" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px; min-width:600px; background-color:${brand.white}; color:${brand.ink}; border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; font-family:${emailFontStack}; line-height:normal;">
	<tr>
		<td class="hsig-td" style="padding:0 0 28px 0; background-color:${brand.white}; border-collapse:collapse; text-align:left;">
			<table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
				<tr>
					<td class="hsig-td" width="148" valign="middle" align="left" style="width:148px; min-width:148px; padding:0 24px 0 0; text-align:left; vertical-align:middle;">
						${logoHtml}
					</td>
					<td class="hsig-td" valign="middle" align="left" style="padding:0; text-align:left; vertical-align:middle;">
						<p class="hsig-name" style="margin:0 0 2px 0; font-family:${emailFontStack}; font-size:18px; line-height:1.25; text-align:left; font-weight:700; color:${brand.ink}; font-synthesis:none;">${esc(`${fields.firstName} ${fields.lastName}`.trim())}</p>
						${
							fields.jobTitle
								? `<p class="hsig-txt" style="margin:0 0 10px 0; font-family:${emailFontStack}; font-size:14px; font-weight:300; line-height:1.4; text-align:left; color:${brand.ink};">${esc(fields.jobTitle)}</p>`
								: ''
						}
						<p class="hsig-txt" style="margin:0 0 14px 0; font-family:${emailFontStack}; font-size:13px; font-weight:300; line-height:1.5; text-align:left; color:${brand.ink};">
							<a class="hsig-link" href="mailto:${esc(email)}" style="color:${brand.ink}; text-decoration:none;">${esc(email)}</a>${phoneParts}
						</p>
						<div style="display:block; text-align:left;">${iconsHtml}</div>
					</td>
				</tr>
			</table>
		</td>
	</tr>${ctaRow}
	<tr>
		<td class="hsig-td hsig-disc" align="left" style="border-top:1px solid ${brand.borderLight}; padding:16px 0 0 0; background-color:${brand.white}; text-align:left;">
			<p style="font-family:${emailFontStack}; font-size:11px; font-weight:300; line-height:1.6; color:${brand.ink}; margin:0;">${disclaimerHtml}</p>
		</td>
	</tr>
</table>`;
}
