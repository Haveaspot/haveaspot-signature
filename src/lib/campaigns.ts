import { sql, getSignatureByEmail, getDepartmentIds } from './db';
import type { CampaignRow, SignatureRow } from './db';
import { getSettings } from './settings';

/**
 * Find the campaign currently overriding this employee's signature, if any.
 *
 * Targeting precedence matches the plugin: a campaign matches when it is live
 * (not deactivated, and now() falls inside its window) AND either it targets
 * everyone, or it explicitly targets this person, or it targets one of their
 * departments.
 *
 * Where this deliberately differs from the PHP: the plugin returned whichever
 * campaign `get_posts` happened to hand back first, so overlapping campaigns
 * resolved unpredictably. Here the most recently started campaign wins, which
 * is both deterministic and the intuitive reading of "the latest campaign".
 */
export async function getActiveCampaign(
	signature: SignatureRow | null,
): Promise<CampaignRow | null> {
	if (!signature) return null;

	const departmentIds = await getDepartmentIds(signature.id);

	const rows = await sql<CampaignRow[]>`
		SELECT c.* FROM campaigns c
		WHERE c.is_deactivated = false
		  AND c.starts_at IS NOT NULL
		  AND c.ends_at   IS NOT NULL
		  AND now() >= c.starts_at
		  AND now() <= c.ends_at
		  AND (
		    c.target_all = true
		    OR EXISTS (
		      SELECT 1 FROM campaign_targets t
		      WHERE t.campaign_id = c.id
		        AND (
		          t.signature_id = ${signature.id}
		          OR t.department_id = ANY(${departmentIds}::int[])
		        )
		    )
		  )
		ORDER BY c.starts_at DESC, c.id DESC
		LIMIT 1
	`;

	return rows[0] ?? null;
}

/**
 * The fully-resolved CTA block for one employee.
 * This is what every image router and tracking redirect reads from.
 */
export interface CtaConfig {
	headingText: string;
	buttonText: string;
	buttonUrl: string;
	promoImageUrl: string;
	/** Whole CTA block is suppressed. */
	disableCta: boolean;
	/** Promo image suppressed, heading + button still shown. */
	disablePromo: boolean;
	/** Only the promo image shows — heading and button suppressed. */
	promoOnly: boolean;
	/** Non-null when a campaign is overriding; used for click attribution. */
	campaign: CampaignRow | null;
	signature: SignatureRow | null;
}

/**
 * Resolve the precedence chain: global settings -> per-user overrides ->
 * active campaign.
 *
 * The plugin repeated this chain inline in all four image routers plus the
 * link router, which is exactly how those five copies drifted apart. Having it
 * in one place is the main structural fix in this port.
 */
export async function resolveCtaConfig(email: string): Promise<CtaConfig> {
	const settings = await getSettings();
	const signature = await getSignatureByEmail(email);

	// --- Layer 1: global defaults -------------------------------------------
	const config: CtaConfig = {
		headingText: settings.global_cta_text,
		buttonText: settings.btn_text,
		buttonUrl: settings.cta_url,
		promoImageUrl: settings.promo_image_url,
		disableCta: settings.disable_global_cta === '1',
		disablePromo: false,
		promoOnly: settings.promo_only_mode === '1',
		campaign: null,
		signature,
	};

	// --- Layer 2: per-employee overrides ------------------------------------
	// Note these only ever tighten: a user can switch their CTA off, but the
	// empty-string check means a blank override never blanks the global text.
	if (signature) {
		if (signature.disable_cta) config.disableCta = true;
		if (signature.disable_promo) config.disablePromo = true;
		if (signature.promo_only_mode) config.promoOnly = true;

		if (signature.cta_heading) config.headingText = signature.cta_heading;
		if (signature.btn_text) config.buttonText = signature.btn_text;
		if (signature.cta_link) config.buttonUrl = signature.cta_link;
		if (!config.disablePromo && signature.promo_image_url) {
			config.promoImageUrl = signature.promo_image_url;
		}
	}

	// --- Layer 3: active campaign (highest precedence) -----------------------
	// A live campaign force-enables the block: it overrides both the global
	// kill switch and any per-user opt-out, on the reasoning that a scheduled
	// marketing push should not be silently dropped by a stale user setting.
	const campaign = await getActiveCampaign(signature);
	if (campaign) {
		config.campaign = campaign;
		config.disableCta = false;
		config.disablePromo = false;
		config.promoOnly = campaign.promo_only_mode;

		if (campaign.cta_heading) config.headingText = campaign.cta_heading;
		if (campaign.btn_text) config.buttonText = campaign.btn_text;
		if (campaign.cta_link) config.buttonUrl = campaign.cta_link;
		if (campaign.promo_image_url) config.promoImageUrl = campaign.promo_image_url;
	}

	return config;
}
