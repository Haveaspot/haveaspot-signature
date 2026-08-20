import type { APIRoute } from 'astro';
import { getSignatureByEmail } from '../../lib/db';
import { getSettings } from '../../lib/settings';
import { logClick } from '../../lib/tracking';

export const prerender = false;

/** vCard values are line-based; these characters have to be escaped. */
function escapeVCard(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r?\n/g, '\\n');
}

/** Keep the download filename to safe characters. */
function safeFilename(value: string): string {
	return value.replace(/[^a-zA-Z0-9-_]/g, '') || 'contact';
}

/**
 * Downloadable contact card — replaces the `settlin_vcard` router.
 * vCard 3.0 is used deliberately: it is the version iOS, Android and Outlook
 * all import without complaint.
 */
export const GET: APIRoute = async ({ url, request }) => {
	const email = (url.searchParams.get('user') ?? '').toLowerCase().trim();
	if (!email) return new Response('Missing user', { status: 400 });

	const signature = await getSignatureByEmail(email);
	if (!signature) return new Response('Not found', { status: 404 });

	const settings = await getSettings();
	await logClick({ email, assetType: 'vcard', headers: request.headers });

	const lines = [
		'BEGIN:VCARD',
		'VERSION:3.0',
		`N:${escapeVCard(signature.last_name)};${escapeVCard(signature.first_name)};;;`,
		`FN:${escapeVCard(`${signature.first_name} ${signature.last_name}`.trim())}`,
		'ORG:Haveaspot',
	];

	if (signature.job_title) lines.push(`TITLE:${escapeVCard(signature.job_title)}`);
	if (signature.mobile) lines.push(`TEL;TYPE=CELL:${escapeVCard(signature.mobile)}`);
	if (signature.office) lines.push(`TEL;TYPE=WORK,VOICE:${escapeVCard(signature.office)}`);

	lines.push(
		`EMAIL;TYPE=WORK,INTERNET:${escapeVCard(email)}`,
		`URL:${escapeVCard(settings.link_web)}`,
		'END:VCARD',
	);

	const filename = safeFilename(`${signature.first_name}-${signature.last_name}`);

	return new Response(lines.join('\r\n') + '\r\n', {
		headers: {
			'Content-Type': 'text/vcard; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}.vcf"`,
			'Cache-Control': 'no-store',
		},
	});
};
