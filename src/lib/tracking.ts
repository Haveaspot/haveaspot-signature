import { createHash } from 'node:crypto';
import { sql, getSignatureByEmail, getDepartmentIds } from './db';
import { env } from './env';

export type AssetType =
	| 'cta_default'
	| 'cta_campaign'
	| 'vcard'
	| 'website'
	| 'mail'
	| 'linkedin';

interface ClientInfo {
	device: string;
	os: string;
	client: string;
}

/**
 * Best-effort user-agent classification, ported from the plugin's string
 * matching. Order matters: the Gmail image proxy and Apple Mail both masquerade
 * closely enough as browsers that the specific checks have to come first.
 */
export function parseUserAgent(userAgent: string): ClientInfo {
	const ua = userAgent.toLowerCase();

	const device =
		ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')
			? 'Mobile'
			: 'Desktop';

	let os = 'Unknown';
	if (ua.includes('windows')) os = 'Windows';
	else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';
	else if (ua.includes('android')) os = 'Android';
	else if (ua.includes('mac')) os = 'MacOS';
	else if (ua.includes('linux')) os = 'Linux';

	let client = 'Unknown';
	if (ua.includes('googleimageproxy') || ua.includes('google')) {
		client = 'Gmail (Proxy)';
	} else if (ua.includes('outlook') || ua.includes('ms-office')) {
		client = 'Outlook';
	} else if (
		ua.includes('applewebkit') &&
		(ua.includes('macintosh') || ua.includes('iphone')) &&
		!ua.includes('chrome')
	) {
		client = 'Apple Mail';
	} else if (ua.includes('chrome')) client = 'Chrome (Web)';
	else if (ua.includes('firefox')) client = 'Firefox (Web)';
	else if (ua.includes('safari')) client = 'Safari (Web)';

	return { device, os, client };
}

/**
 * Country from the edge. Vercel sets `x-vercel-ip-country` on every request,
 * which replaces the plugin's scan through Cloudflare/CloudFront headers.
 */
export function getCountry(headers: Headers): string {
	return (headers.get('x-vercel-ip-country') ?? '??').toUpperCase();
}

/**
 * Pseudonymous visitor id. The raw IP is never stored — only a salted hash, so
 * repeat opens can be counted without holding personal data.
 */
export function hashVisitor(headers: Headers): string {
	const ip =
		headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		headers.get('x-real-ip') ??
		'0.0.0.0';
	const salt = env('CRON_SECRET') ?? 'has-signature';
	return createHash('sha256').update(`${ip}${salt}`).digest('hex');
}

/**
 * Record a click. Deliberately never throws: analytics must not be able to
 * break a redirect the user is waiting on, so a failed insert is swallowed and
 * logged rather than surfaced.
 */
export async function logClick(opts: {
	email: string;
	assetType: AssetType;
	campaignId?: number | null;
	headers: Headers;
}): Promise<void> {
	try {
		const email = opts.email.toLowerCase();
		const signature = await getSignatureByEmail(email);
		const departmentIds = signature ? await getDepartmentIds(signature.id) : [];
		const { device, os, client } = parseUserAgent(
			opts.headers.get('user-agent') ?? '',
		);

		await sql`
			INSERT INTO clicks (
				sender_email, signature_id, department_id, campaign_id, asset_type,
				device_type, os_platform, email_client, country_code, visitor_hash
			) VALUES (
				${email}, ${signature?.id ?? null}, ${departmentIds[0] ?? null},
				${opts.campaignId ?? null}, ${opts.assetType},
				${device}, ${os}, ${client},
				${getCountry(opts.headers)}, ${hashVisitor(opts.headers)}
			)
		`;
	} catch (error) {
		console.error('[tracking] failed to log click', error);
	}
}
