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
 * The aspect ratio the CTA renderer composites promo artwork at.
 *
 * Was 3:1, which made the photo 180px tall in a 356px banner — half the block,
 * and nearly twice the height of the header identifying the sender. Feedback
 * before rollout was that the promo ran too long, so it is 4:1.
 *
 * Lives here rather than in the renderer because the upload guidance, the
 * preview thumbnails and the docs all quote it, and ten hand-written "3:1"s
 * would drift apart the first time one changed.
 */
export const PROMO_RATIO = 4;

/** How the ratio is written in the interface, derived so it cannot disagree. */
export const PROMO_RATIO_LABEL = `${PROMO_RATIO}:1`;

/** The size to produce artwork at: full banner width at 2x, for retina. */
export const PROMO_ARTWORK_SIZE = `1080×${Math.round(1080 / PROMO_RATIO)}`;

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
 * Dark-mode surfaces and lines, as solid colours rather than translucent white.
 *
 * They were `rgba(255,255,255,0.06)` and `0.16` over `#111111`, which is the
 * same idea but only works when composited over a known backdrop. The CTA block
 * is a PNG whose background has to *match* the pill exactly, and an image
 * cannot composite against the reader's backdrop — so both are pinned to the
 * colours those washes resolve to. Solid values are also safer in email, where
 * rgba support is uneven.
 */
export const darkModePillSurface = '#1F1F1F'; // rgba(255,255,255,0.06) over #111
export const darkModeDivider = '#373737'; // rgba(255,255,255,0.16) over #111

/**
 * The CTA button in dark mode.
 *
 * Inverted from light mode, where the button is ink on white: against a dark
 * card, ink would disappear, so the brand green carries it instead. This is the
 * one place green appears in the signature, and it matches the brand's own
 * primary-button hover treatment (green fill, white label).
 */
export const darkModeButtonSurface = brand.accent;
export const darkModeButtonLabel = '#FFFFFF';
