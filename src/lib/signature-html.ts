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
 * Turn addresses and URLs in the disclaimer into real links, in brand colours.
 *
 * Gmail auto-links anything that looks like an address or a URL and styles it
 * with its own blue — the only off-brand colour left in the signature. It only
 * does that to text which is not already a link, so linking them first, in
 * `#021300`, keeps them ours. Clients that impose a dark mode then recolour
 * these along with the surrounding text instead of singling them out.
 *
 * Runs on already-escaped text, so the `[^\s<]` guards cannot run into markup.
 * One combined pattern rather than separate passes, so each match is consumed
 * once: matching emails and URLs separately would let the URL pass rewrite the
 * domain inside an href the email pass had just produced.
 *
 * The bare-domain arm requires a known TLD deliberately. A looser rule turns
 * ordinary prose into links — "e.g." and a sentence-ending "advice." both match
 * a naive `word.word` pattern.
 */
const LINKABLE = new RegExp(
	[
		'(https?:\\/\\/[^\\s<]+)', // explicit URL
		'([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,})', // email address
		'((?:www\\.)?[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.(?:com|co\\.uk|org|net|io|uk)\\b(?:\\/[^\\s<]*)?)', // bare domain
	].join('|'),
	'g',
);

function linkify(escaped: string): string {
	return escaped.replace(LINKABLE, (match, url, email) => {
		const href = url ? match : email ? `mailto:${match}` : `https://${match}`;
		return `<a class="hsig-link" href="${href}" style="color:${brand.ink}; text-decoration:underline;">${match}</a>`;
	});
}

/**
 * Icon pill geometry.
 *
 * Chosen so the icon pill comes out exactly as wide as the logo pill (148px):
 * four 20px icons with three 12px gaps is 116px, and 15px of padding either
 * side plus the 1px borders makes 148. Adjust the icon count or spacing and
 * this padding is what has to change to keep the two pills aligned.
 */
export const ICON_SIZE = 20;
export const ICON_GAP = 12;
export const ICON_COUNT = 4;
export const ICON_PILL_PADDING_X = 15;

/**
 * Logo pill geometry. The wordmark is 5:1, so 110px wide is 22px tall.
 *
 * These now describe how `build-assets.mjs` composites the pill image rather
 * than how the markup styles a cell — keep the two in step if either changes.
 */
export const LOGO_WIDTH = 110;
export const LOGO_PILL_PADDING_X = 18;

/** 1px border on each side, common to both pills. */
const PILL_BORDERS = 2;

/**
 * The two-band rhythm of the header.
 *
 * The left column is a 44px pill, a 10px gap, then another 44px pill. The right
 * column mirrors those exact bands — name and title in the first, contact
 * details in the second — with the content vertically centred inside each.
 *
 * Mirroring the structure rather than nudging margins is what makes the
 * alignment hold when fields are missing: with no job title the name simply
 * centres in its 44px band instead of drifting upward, which is what happened
 * when the spacing was tuned by hand for the everything-present case.
 */
export const PILL_HEIGHT = 44;
export const PILL_GAP = 10;

/** Rendered width of each pill. Equal by construction — asserted in tests. */
export const ICON_PILL_WIDTH =
	ICON_COUNT * ICON_SIZE + (ICON_COUNT - 1) * ICON_GAP + ICON_PILL_PADDING_X * 2 + PILL_BORDERS;
export const LOGO_PILL_WIDTH = LOGO_WIDTH + LOGO_PILL_PADDING_X * 2 + PILL_BORDERS;

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
	// Only the icon pill is still CSS-drawn; the logo pill carries its own baked
	// background and needs no rule.
	[
		'.hsig-icon-pill',
		`background-color: ${darkModePillSurface} !important; border-color: ${darkModeDivider} !important;`,
	],
	['.hsig-icon', 'filter: brightness(0) invert(1) !important;'],
	['.hsig-logo-light', 'display: none !important;'],
	['.hsig-logo-dark', 'display: block !important;'],
	// The CTA is a PNG and cannot answer a media query, so two renders ship and
	// the query picks one — exactly as with the logo.
	['.hsig-cta-light', 'display: none !important;'],
	['.hsig-cta-dark', 'display: block !important;'],
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
	const ctaImage = (section: string, theme: 'light' | 'dark') =>
		`${baseUrl}/api/cta?user=${q}&section=${section}&theme=${theme}&v=${v}`;
	const track = (asset: string) => `${baseUrl}/api/track/${asset}?user=${q}`;
	const vcardUrl = `${baseUrl}/api/vcard?user=${q}`;
	const ctaLink = `${baseUrl}/api/track/cta?user=${q}`;

	const icons = [
		{ url: settings.icon_web || `${baseUrl}/icons/web.png`, href: track('website'), title: 'Website' },
		{ url: settings.icon_mail || `${baseUrl}/icons/mail.png`, href: track('mail'), title: 'Email us' },
		{ url: settings.icon_li || `${baseUrl}/icons/linkedin.png`, href: track('linkedin'), title: 'LinkedIn' },
		{ url: settings.icon_vcard || `${baseUrl}/icons/vcard.png`, href: vcardUrl, title: 'Save contact' },
	];

	/**
	 * Phone numbers sit on their own line beneath the email address.
	 *
	 * The pipe is a separator *between* numbers, not a prefix on each — so a
	 * single number appears with no leading pipe, and the line reads
	 * "mobile | office" rather than "| mobile | office".
	 *
	 * Each number is a nowrap span so it never breaks mid-number across a line.
	 */
	const phones = [fields.mobile, fields.office].filter(Boolean);

	const pipe = `<span class="hsig-pipe" style="color:${brand.ink};">&nbsp;|&nbsp;</span>`;

	const phonesHtml = phones
		.map(
			(phone) =>
				`<span style="display:inline-block; white-space:nowrap;"><a class="hsig-link" href="tel:${esc(telHref(phone))}" style="color:${brand.ink}; text-decoration:none;">${esc(phone)}</a></span>`,
		)
		.join(pipe);

	const iconsHtml = icons
		.map(
			(icon, i) =>
				`<a href="${esc(icon.href)}" style="text-decoration:none;" title="${esc(icon.title)}"><img class="hsig-icon" src="${esc(icon.url)}?v=${v}" width="${ICON_SIZE}" height="${ICON_SIZE}" alt="${esc(icon.title)}" style="display:inline-block; ${i < icons.length - 1 ? `margin-right:${ICON_GAP}px;` : ''} vertical-align:middle; border:none; outline:none;"></a>`,
		)
		.join('');

	// Escape, then linkify, then break lines — in that order. Linkifying before
	// the <br> substitution keeps the pattern's whitespace boundaries meaningful,
	// and escaping first means no user text can inject markup through a link.
	const disclaimerHtml = linkify(esc(settings.disclaimer_text)).replace(/\n/g, '<br>');

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
	const logoLight = settings.logo_url || `${baseUrl}/logo/logo-pill-light.png`;
	const logoDark = settings.logo_url_dark || `${baseUrl}/logo/logo-pill-dark.png`;

	/**
	 * The logo pill is a single image with its background **baked in**, not a
	 * styled table cell.
	 *
	 * This is the important difference. Clients that impose their own dark mode
	 * — Gmail and Outlook both do — invert CSS backgrounds but never touch
	 * images. A CSS pill therefore flips dark in Gmail's dark theme while the
	 * ink wordmark inside it stays dark: illegible. Verified in Gmail, where the
	 * stylesheet and every class attribute are stripped outright, so there is no
	 * CSS-based fix available.
	 *
	 * Baking the pill into the PNG makes it one uninvertible unit, so the mark
	 * always sits on its own correct background whatever a client does around
	 * it. It also fixes Outlook, whose Word engine ignores `border-radius` and
	 * was rendering a square-cornered box.
	 *
	 * Two pills ship. Clients honouring `prefers-color-scheme` swap to the dark
	 * one; clients that strip the stylesheet keep the light one, which is now
	 * correct on any background rather than merely tolerable.
	 */
	/** Shared pill styling — now only the icon pill, which is still CSS-drawn. */
	const pillStyle = `background-color:${brand.surface}; border:1px solid ${brand.borderLight}; border-radius:${radius.pill}px; text-align:center; vertical-align:middle;`;

	/**
	 * Logo pill above, icon pill below — both 148×44.
	 *
	 * The widths agree by construction rather than by coincidence: the icon row
	 * is four 20px icons with three 12px gaps (116px), and 15px of padding
	 * either side brings it to the logo pill's 148px. Change the icon count or
	 * spacing and `ICON_PILL_PADDING_X` below is what needs recomputing.
	 *
	 * The spacer row is an empty cell rather than padding or a margin, because
	 * Outlook's Word renderer honours neither reliably between table rows.
	 */
	const logoHtml = `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
							<tr>
								<td align="left" valign="middle" style="padding:0; font-size:0; line-height:0;">
									<img src="${esc(logoLight)}?v=${v}" width="${LOGO_PILL_WIDTH}" height="${PILL_HEIGHT}" alt="Haveaspot" class="hsig-logo-light" style="display:block; border:none; outline:none;">
									<!--[if !mso]><!-->
									<img src="${esc(logoDark)}?v=${v}" width="${LOGO_PILL_WIDTH}" height="${PILL_HEIGHT}" alt="Haveaspot" class="hsig-logo-dark" style="display:none; border:none; outline:none; mso-hide:all;">
									<!--<![endif]-->
								</td>
							</tr>
							<tr>
								<td style="height:${PILL_GAP}px; font-size:0; line-height:0;">&nbsp;</td>
							</tr>
							<tr>
								<td class="hsig-icon-pill" align="center" valign="middle" bgcolor="${brand.surface}" style="${pillStyle} padding:11px ${ICON_PILL_PADDING_X}px; font-size:0; line-height:0;">
									${iconsHtml}
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
	const ctaAlt = esc(config.headingText.replace(/\s*\|\s*/g, ' '));

	const ctaRow = config.disableCta
		? ''
		: `
		<tr>
			<td align="left" style="padding:0 0 28px 0; font-size:0; line-height:0; text-align:left;">
				<a href="${esc(ctaLink)}" target="_blank" style="display:block; border:none; text-decoration:none; font-size:0; line-height:0;">
					<img src="${ctaImage('card', 'light')}" width="600" alt="${ctaAlt}" class="hsig-cta-light" style="display:block; border:none; outline:none; margin:0; padding:0; width:100%; max-width:600px; height:auto;">
					<!--[if !mso]><!-->
					<img src="${ctaImage('card', 'dark')}" width="600" alt="${ctaAlt}" class="hsig-cta-dark" style="display:none; border:none; outline:none; margin:0; padding:0; width:100%; max-width:600px; height:auto; mso-hide:all;">
					<!--<![endif]-->
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
	 *
	 * The outer table has `max-width` but deliberately **no `min-width`**, and
	 * that omission is load-bearing. Mobile clients scale a message to fit its
	 * widest element, so a signature that refuses to go below 600px drags the
	 * whole email down with it — the sender's own body copy included, rendering
	 * at roughly 62% on a 375px screen. Without a floor the signature yields and
	 * everything above it keeps its natural size. Do not add one back.
	 */
	return `<style type="text/css">
	:root { color-scheme: light dark; supported-color-schemes: light dark; }
	@media (prefers-color-scheme: dark) {
		${darkRulesCss()}
	}
</style>
<table class="hsig-tbl" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px; background-color:${brand.white}; color:${brand.ink}; border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; font-family:${emailFontStack}; line-height:normal;">
	<tr>
		<td class="hsig-td" style="padding:0 0 28px 0; background-color:${brand.white}; border-collapse:collapse; text-align:left;">
			<table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
				<tr>
					<td class="hsig-td" width="${LOGO_PILL_WIDTH}" valign="top" align="left" style="width:${LOGO_PILL_WIDTH}px; min-width:${LOGO_PILL_WIDTH}px; padding:0 24px 0 0; text-align:left; vertical-align:top;">
						${logoHtml}
					</td>
					<td class="hsig-td" valign="top" align="left" style="padding:0; text-align:left; vertical-align:top;">
						<table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
							<tr>
								<td class="hsig-td" height="${PILL_HEIGHT}" valign="middle" align="left" style="height:${PILL_HEIGHT}px; text-align:left; vertical-align:middle;">
									<p class="hsig-name" style="margin:0 0 2px 0; font-family:${emailFontStack}; font-size:18px; line-height:1.25; text-align:left; font-weight:700; color:${brand.ink}; font-synthesis:none;">${esc(`${fields.firstName} ${fields.lastName}`.trim())}</p>
									${
										fields.jobTitle
											? `<p class="hsig-txt" style="margin:0; font-family:${emailFontStack}; font-size:14px; font-weight:300; line-height:1.4; text-align:left; color:${brand.ink};">${esc(fields.jobTitle)}</p>`
											: ''
									}
								</td>
							</tr>
							<tr>
								<td style="height:${PILL_GAP}px; font-size:0; line-height:0;">&nbsp;</td>
							</tr>
							<tr>
								<td class="hsig-td" height="${PILL_HEIGHT}" valign="middle" align="left" style="height:${PILL_HEIGHT}px; text-align:left; vertical-align:middle;">
									<p class="hsig-txt" style="margin:0; font-family:${emailFontStack}; font-size:13px; font-weight:300; line-height:1.5; text-align:left; color:${brand.ink};">
										<a class="hsig-link" href="mailto:${esc(email)}" style="color:${brand.ink}; text-decoration:none;">${esc(email)}</a>${phonesHtml ? `<br>${phonesHtml}` : ''}
									</p>
								</td>
							</tr>
						</table>
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
