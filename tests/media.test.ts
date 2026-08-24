import { logoRatioNote, ratioNote, deleteMedia, LOGO_RATIO } from '../src/lib/media.ts';
import { LOGO_PILL_WIDTH, PILL_HEIGHT } from '../src/lib/signature-html.ts';

/**
 * The pure parts of the media library.
 *
 * Uploading and listing need a blob store and are exercised against the real
 * one; what is worth pinning here is the guidance and the delete guard, both of
 * which are easy to get subtly wrong and impossible to notice afterwards.
 */
const checks: [string, boolean][] = [];

// --- Shape guidance ---------------------------------------------------------

checks.push([
	`logo ratio follows the pill geometry (${LOGO_PILL_WIDTH}/${PILL_HEIGHT})`,
	Math.abs(LOGO_RATIO - LOGO_PILL_WIDTH / PILL_HEIGHT) < 1e-9,
]);

checks.push([
	'a correctly sized logo gets no warning',
	logoRatioNote(LOGO_PILL_WIDTH, PILL_HEIGHT) === null,
]);

checks.push([
	'a retina logo gets no warning either',
	logoRatioNote(LOGO_PILL_WIDTH * 2, PILL_HEIGHT * 2) === null,
]);

/**
 * The logo is given both a width and a height in the signature, so a mismatched
 * file is distorted rather than trimmed. Someone told their logo will be
 * "cropped" would go looking for missing edges instead of a squashed wordmark.
 */
{
	const wide = logoRatioNote(600, 44) ?? '';
	const tall = logoRatioNote(148, 300) ?? '';
	checks.push(['a wide logo is warned about', wide.length > 0]);
	checks.push(['a tall logo is warned about', tall.length > 0]);
	checks.push([
		'logo warnings name distortion, not cropping',
		/squashed|stretched/.test(wide) &&
			/squashed|stretched/.test(tall) &&
			// "not cropped" is allowed and wanted — the contrast is the point.
			// What must never appear is a claim that it *will* be cropped.
			!/will be cropped/.test(wide) &&
			!/will be cropped/.test(tall),
	]);
}

// A banner, by contrast, really is cropped.
checks.push(['a 3:1 banner gets no warning', ratioNote(1080, 360) === null]);
checks.push(['a square banner is warned about cropping', /crop/i.test(ratioNote(600, 600) ?? '')]);

// --- Delete guard -----------------------------------------------------------

/**
 * The guard must reject before the store is ever called, so it is testable
 * without a token — and so a crafted URL cannot reach another blob, including
 * one of the other kind.
 */
async function refuses(url: string, kind: 'banner' | 'logo'): Promise<boolean> {
	try {
		await deleteMedia(url, kind);
		return false;
	} catch (err) {
		// A missing token would be MediaNotConfigured; we want the prefix refusal.
		return err instanceof Error && /not a (banner|logo) in this library/.test(err.message);
	}
}

checks.push([
	'deleting outside the prefix is refused',
	await refuses('https://blob.example.com/private/secret.png', 'banner'),
]);

checks.push([
	'a logo cannot be deleted through the banner library',
	await refuses('https://blob.example.com/logos/mark.png', 'banner'),
]);

checks.push([
	'a banner cannot be deleted through the logo library',
	await refuses('https://blob.example.com/banners/art.png', 'logo'),
]);

let failed = 0;
for (const [name, pass] of checks) {
	console.log(`${pass ? '  ok' : 'FAIL'}  ${name}`);
	if (!pass) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
