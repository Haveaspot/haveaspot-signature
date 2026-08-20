/**
 * Haveaspot brand tokens.
 *
 * These are the single source of truth for both the generator UI and the
 * rendered email signature. The original plugin was hardcoded to Settlin's
 * navy (#010334) and blue (#105ED5) — everything here is the Haveaspot
 * equivalent.
 */

export const brand = {
	/**
	 * ALL text — headings, body, subtext, metadata and fine print alike.
	 *
	 * The brand guide is explicit that grey text is never correct: lightness
	 * comes from dropping the font weight to 300, not from fading the colour.
	 * There is deliberately no `muted` token here, so there is nothing to reach
	 * for by accident.
	 */
	ink: '#021300',
	/**
	 * Action and hover only — never a default text or background colour.
	 *
	 * Email has no hover state, so in the signature this is used for nothing at
	 * all: the only green that appears is inside the logo artwork itself. Kept
	 * here because the generator UI does have hover states.
	 */
	accent: '#0AAD0A',
	/** Deep hover, used sparingly. */
	accentDeep: '#0E491F',
	/** Page background. */
	white: '#FFFFFF',
	/** Subtle surface — cards, dropdowns. Not a page or signature background. */
	surface: '#F9FAFB',
	/** Dividers and non-featured borders. Thin structural lines only. */
	borderLight: '#E5E7EB',
} as const;

/** Radii, per the brand token set. */
export const radius = {
	card: 12,
	button: 6,
	/**
	 * The brand's `--radius-pill: 20px` is specified against 32px filter chips,
	 * where a browser clamps it to half the height and the result is a perfect
	 * pill. The token expresses "fully rounded", not a literal 20px corner.
	 *
	 * Anything taller needs a value past half its height to keep that intent —
	 * the logo pill is 56px, where a literal 20px would read as a rounded
	 * rectangle instead. Browsers clamp the excess, so an over-large value is
	 * simply "however round it needs to be".
	 */
	pill: 100,
} as const;

/** Brand button height, in CSS pixels. */
export const BUTTON_HEIGHT = 44;

/**
 * Poppins is not available in email clients, so the signature always ships a
 * fallback stack. Arial is the safest universal metric-compatible fallback.
 */
export const emailFontStack = "'Poppins', Arial, Helvetica, sans-serif";

/** Poppins weight scale — see the brand site's typography page. */
export const weights = {
	extraBold: 800, // H1, H2
	bold: 700, // H3, H4, card titles
	semiBold: 600, // Nav active, footer headings
	medium: 500, // Nav links, buttons, labels
	regular: 400, // Body copy
	light: 300, // Subtext, metadata, captions
} as const;

/**
 * Dark-mode overrides injected into the signature markup. Email clients that
 * honour `prefers-color-scheme` (Apple Mail, Outlook for Mac) will pick these
 * up; everything else ignores the media query and keeps the light design.
 */
export const darkModeInk = '#FFFFFF';
export const darkModeSurface = '#111111';
/**
 * Divider in dark mode. `#E5E7EB` would glare against a near-black background,
 * so the same hairline is expressed as a low-opacity white instead.
 */
export const darkModeDivider = 'rgba(255,255,255,0.16)';

/**
 * The logo pill in dark mode.
 *
 * It cannot simply keep its `#F9FAFB` fill: the logo swaps to the white
 * wordmark in dark mode, and a white mark on a near-white pill is invisible.
 * The same "subtle raised surface" idea is expressed as a faint light wash on
 * the dark background instead.
 */
export const darkModePillSurface = 'rgba(255,255,255,0.06)';
