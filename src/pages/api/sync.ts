import type { APIRoute } from 'astro';
import { upsertSignature } from '../../lib/db';
import { resolveCtaConfig } from '../../lib/campaigns';
import { getSettings } from '../../lib/settings';
import { renderSignature } from '../../lib/signature-html';
import { env } from '../../lib/env';
import { isSyncThrottled, THROTTLE_MESSAGE } from '../../lib/throttle';

export const prerender = false;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a LinkedIn profile URL, or return an error to show the person.
 *
 * Checked rather than accepted as-is because a wrong link here is expensive:
 * it goes into a signature that gets pasted once and then sits in an outbox
 * for months, and nobody proof-reads their own icon row.
 */
function cleanLinkedIn(raw: string): { url: string } | { error: string } {
	if (!raw) return { url: '' };

	const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

	let parsed: URL;
	try {
		parsed = new URL(withScheme);
	} catch {
		return { error: 'That LinkedIn link does not look like a web address.' };
	}

	const host = parsed.hostname.toLowerCase();
	if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) {
		return { error: 'That is not a LinkedIn address. It should start linkedin.com/in/…' };
	}

	// Force https: a signature is read in mail clients that will warn on, or
	// refuse, an insecure link.
	parsed.protocol = 'https:';
	return { url: parsed.toString() };
}

/** Trim and cap free-text input before it reaches the database or the markup. */
function clean(value: unknown, maxLength = 120): string {
	return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

/**
 * Generator submit — replaces `mech_ajax_sync_signature`.
 *
 * Does two things at once, as the original did: records the employee in the CRM
 * and returns their rendered signature markup. Rendering server-side (rather
 * than the plugin's approach of shipping the disclaimer to the browser and
 * assembling there) means the copy button and any future email send are
 * guaranteed to produce byte-identical output.
 */
export const POST: APIRoute = async ({ request, url }) => {
	let payload: Record<string, unknown>;
	try {
		payload = await request.json();
	} catch {
		return Response.json({ ok: false, error: 'Invalid request' }, { status: 400 });
	}

	// Honeypot: a hidden field real users never see, so anything filling it in is
	// a bot. Returns 200 so the bot cannot distinguish rejection from success.
	if (clean(payload.middle_name)) {
		return Response.json({ ok: true, html: '' });
	}

	// Volume limit. Checked after the honeypot so obvious bots do not consume a
	// legitimate network's allowance, and before any database write so a flood
	// cannot create records.
	if (await isSyncThrottled(request.headers)) {
		return Response.json({ ok: false, error: THROTTLE_MESSAGE }, { status: 429 });
	}

	const email = clean(payload.email, 160).toLowerCase();
	if (!EMAIL_PATTERN.test(email)) {
		return Response.json(
			{ ok: false, error: 'Please enter a valid email address.' },
			{ status: 400 },
		);
	}

	// Domain guard — this tool writes to the company CRM, so only staff
	// addresses may create records (mirrors the plugin's @settlin.io check).
	const allowedDomain = env('ALLOWED_EMAIL_DOMAIN') ?? 'haveaspot.com';
	if (!email.endsWith(`@${allowedDomain}`)) {
		return Response.json(
			{ ok: false, error: `Please use your @${allowedDomain} email address.` },
			{ status: 403 },
		);
	}

	const linkedin = cleanLinkedIn(clean(payload.linkedin_url, 300));
	if ('error' in linkedin) {
		return Response.json({ ok: false, error: linkedin.error }, { status: 400 });
	}

	const fields = {
		firstName: clean(payload.first_name, 60),
		lastName: clean(payload.last_name, 60),
		jobTitle: clean(payload.job_title, 100),
		email,
		mobile: clean(payload.mobile, 40),
		office: clean(payload.office, 40),
		linkedinUrl: linkedin.url,
	};

	if (!fields.firstName || !fields.lastName) {
		return Response.json(
			{ ok: false, error: 'First and last name are required.' },
			{ status: 400 },
		);
	}

	await upsertSignature({
		email,
		first_name: fields.firstName,
		last_name: fields.lastName,
		job_title: fields.jobTitle,
		mobile: fields.mobile,
		office: fields.office,
		linkedin_url: fields.linkedinUrl,
	});

	const [settings, config] = await Promise.all([
		getSettings(),
		resolveCtaConfig(email),
	]);

	// Absolute URLs are required: these end up in an email read elsewhere.
	const baseUrl = (env('PUBLIC_SITE_URL') ?? url.origin).replace(/\/$/, '');

	const html = renderSignature({ fields, config, settings, baseUrl });

	return Response.json({ ok: true, html });
};
