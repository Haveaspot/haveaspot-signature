import { sql } from './db';

/**
 * Global settings — the replacement for the plugin's `get_option('mech_sig_*')`.
 *
 * Keys and defaults map 1:1 onto the WordPress options so behaviour is
 * unchanged; the Settlin-specific values have been swapped for Haveaspot ones.
 */
export const SETTING_DEFAULTS = {
	// Creative
	global_cta_text: 'Find and book the space you need.',
	btn_text: 'Find Out More',
	promo_image_url: '',

	// Master switches
	disable_global_cta: '0',
	promo_only_mode: '0',

	// Destinations
	cta_url: 'https://haveaspot.com',
	link_web: 'https://haveaspot.com',
	link_mail: 'https://haveaspot.com/contact/',
	link_li: 'https://www.linkedin.com/company/haveaspot',

	// Assets.
	// Blank means "use the copies bundled in public/logo/", which is the normal
	// case — they are served from this same domain, so nothing depends on
	// another site's asset paths staying put. Set these only to point at a
	// different logo entirely.
	logo_url: '',
	logo_url_dark: '',
	icon_web: '',
	icon_mail: '',
	icon_li: '',
	icon_vcard: '',

	disclaimer_text: [
		'Haveaspot',
		'',
		'support@haveaspot.com',
		'The Cleve, Wellington, Somerset TA21 8SN',
		'haveaspot.com',
		'',
		'This message and any attachments are confidential and intended solely for the addressee(s). If you are not the intended recipient, please contact the sender and delete the message. The information contained in this email is for informational purposes only and does not constitute legal or other professional advice.',
	].join('\n'),
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = Record<SettingKey, string>;

/**
 * Load every setting in one query, falling back to the defaults above for any
 * key that has never been saved. One round trip beats the plugin's habit of
 * calling get_option a dozen times per render.
 */
export async function getSettings(): Promise<Settings> {
	const rows = await sql<{ key: string; value: string }[]>`
		SELECT key, value FROM settings
	`;

	const stored = new Map(rows.map((r) => [r.key, r.value]));
	const result = { ...SETTING_DEFAULTS } as Settings;

	for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
		const value = stored.get(key);
		// An explicitly-saved empty string is meaningful (e.g. "no promo image"),
		// so only fall back when the key is genuinely absent.
		if (value !== undefined) result[key] = value;
	}

	return result;
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
	await sql`
		INSERT INTO settings (key, value) VALUES (${key}, ${value})
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
	`;
}
