import { brand, emailFontStack, darkModeInk, darkModeAccent, darkModeSurface } from './brand';
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
		`background-color: ${darkModeSurface} !important; border-color: ${darkModeAccent} !important; color: ${darkModeInk} !important;`,
	],
	['.hsig-name-first', `color: ${darkModeAccent} !important;`],
	['.hsig-name-last, .hsig-txt', `color: ${darkModeInk} !important;`],
	['.hsig-link', `color: ${darkModeAccent} !important;`],
	['.hsig-icon', 'filter: brightness(0) invert(1) !important;'],
	['.hsig-logo-light', 'display: none !important;'],
	['.hsig-logo-dark', 'display: block !important;'],
	['.hsig-disc, .hsig-pipe', `color: ${darkModeInk} !important;`],
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

	const logoHtml = `<img src="${esc(logoLight)}?v=${v}" width="130" alt="Haveaspot" class="hsig-logo-light" style="display:block; border:none; outline:none; margin:0 auto;">
						<!--[if !mso]><!-->
						<img src="${esc(logoDark)}?v=${v}" width="130" alt="Haveaspot" class="hsig-logo-dark" style="display:none; border:none; outline:none; margin:0 auto; mso-hide:all;">
						<!--<![endif]-->`;

	// The CTA rows are omitted entirely when disabled, rather than rendered as a
	// 1px transparent spacer the way the plugin did. A missing row cannot leave
	// a stray hairline in Outlook.
	const ctaRow = config.disableCta
		? ''
		: `
		<tr>
			<td class="hsig-td" align="left" style="border-top:1px dashed ${brand.ink}; border-left:1px dashed ${brand.ink}; border-right:1px dashed ${brand.ink}; padding:0; font-size:0; line-height:0; text-align:left;">
				${
					config.promoOnly
						? `<img src="${ctaImage('promo')}" width="598" alt="" style="display:block; border:none; outline:none; margin:0; padding:0; width:100%; max-width:598px; height:auto;">`
						: `<img src="${ctaImage('content')}" width="598" alt="" style="display:block; border:none; outline:none; margin:0; padding:0; width:100%; max-width:598px; height:auto;">
				<a href="${esc(ctaLink)}" target="_blank" style="display:block; border:none; text-decoration:none; font-size:0; line-height:0;">
					<img src="${ctaImage('button')}" width="598" alt="${esc(config.buttonText)}" style="display:block; border:none; outline:none; margin:0; padding:0; width:100%; max-width:598px; height:auto;">
				</a>`
				}
			</td>
		</tr>`;

	return `<style type="text/css">
	:root { color-scheme: light dark; supported-color-schemes: light dark; }
	@media (prefers-color-scheme: dark) {
		${darkRulesCss()}
	}
</style>
<table class="hsig-tbl" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px; min-width:600px; background-color:${brand.surface}; color:${brand.ink}; border:1px dashed ${brand.ink}; border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; font-family:${emailFontStack}; line-height:normal;">
	<tr>
		<td class="hsig-td" style="padding:0; background-color:${brand.surface}; border-collapse:collapse; text-align:left;">
			<table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
				<tr>
					<td class="hsig-td" width="160" valign="middle" align="center" style="width:160px; min-width:160px; border-right:1px dashed ${brand.ink}; padding:25px 15px; text-align:center; vertical-align:middle;">
						${logoHtml}
					</td>
					<td class="hsig-td" valign="middle" align="left" style="padding:25px 25px 25px 20px; text-align:left; vertical-align:middle;">
						<h2 style="margin:0 0 4px 0; font-family:${emailFontStack}; font-size:18px; line-height:1.2; text-align:left; font-weight:normal; font-synthesis:none;">
							<span class="hsig-name-first" style="color:${brand.accent};"><strong style="font-weight:700; font-family:inherit;">${esc(fields.firstName)}</strong></span> <span class="hsig-name-last" style="color:${brand.ink};"><strong style="font-weight:700; font-family:inherit;">${esc(fields.lastName)}</strong></span>
						</h2>
						<p class="hsig-txt" style="margin:0 0 8px 0; font-family:${emailFontStack}; font-size:14px; font-weight:400; text-align:left; color:${brand.ink};">${esc(fields.jobTitle)}</p>
						<p class="hsig-txt" style="margin:0 0 10px 0; font-family:${emailFontStack}; font-size:13px; line-height:1.4; text-align:left;">
							<a class="hsig-link" href="mailto:${esc(email)}" style="color:${brand.ink}; text-decoration:none;">${esc(email)}</a>${phoneParts}
						</p>
						<div style="display:block; text-align:left;">${iconsHtml}</div>
					</td>
				</tr>
			</table>
		</td>
	</tr>${ctaRow}
	<tr>
		<td class="hsig-td hsig-disc" align="left" style="border-top:1px dashed ${brand.ink}; padding:20px 25px; background-color:${brand.surface}; text-align:left;">
			<p style="font-family:Arial, Helvetica, sans-serif; font-size:10px; line-height:1.5; color:${brand.muted}; margin:0;">${disclaimerHtml}</p>
		</td>
	</tr>
</table>`;
}
