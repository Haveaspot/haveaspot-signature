/**
 * Haveaspot brand tokens.
 *
 * These are the single source of truth for both the generator UI and the
 * rendered email signature. The original plugin was hardcoded to Settlin's
 * navy (#010334) and blue (#105ED5) — everything here is the Haveaspot
 * equivalent.
 */

export const brand = {
	/** ALL body text, borders, headings. Never plain black. */
	ink: '#021300',
	/** Hover states, active indicators, accent only — never body text. */
	accent: '#0AAD0A',
	/** Deep hover (button hover-over-hover). */
	accentDeep: '#0E491F',
	/** Surface / card background. */
	surface: '#F9FAFB',
	/** Light border. */
	borderLight: '#E5E7EB',
	white: '#FFFFFF',
	/** Disclaimer / fine print. */
	muted: '#6B7280',
} as const;

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
export const darkModeAccent = '#5BE85B';
export const darkModeSurface = '#111111';
