/**
 * Rasterise the signature's icons and logos into public/.
 *
 * Everything here targets email clients, which constrains the output:
 *  - PNG only. Outlook renders through Word and shows nothing for inline SVG,
 *    and WebP is unsupported across most of the desktop clients.
 *  - Drawn at 2x the display size, so the assets stay sharp on retina screens.
 *  - Icons are flat brand ink on transparent, because the signature recolours
 *    them for dark mode with `filter: brightness(0) invert(1)`, which only
 *    yields a clean white icon from a single solid source colour.
 *
 * The logos are the exception to that filter: they carry the green "a", which
 * the filter would flatten to white, so the signature swaps between a light and
 * a dark variant instead. Both are produced here.
 *
 * Icons are Font Awesome Free v7.3.1 (CC BY 4.0), attributed in the site footer.
 *
 * Run with: npm run build:assets
 */
import { readdir, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const iconSrc = path.join(root, 'assets', 'icons');
const iconOut = path.join(root, 'public', 'icons');
const logoOut = path.join(root, 'public', 'logo');

const ICON_SIZE = 40; // displayed at 20px

/**
 * The logo pill is composited here rather than built from CSS in the signature.
 *
 * Mail clients that apply their own dark mode invert CSS backgrounds but never
 * touch images. A CSS pill therefore flips to dark in Gmail's dark theme while
 * the ink wordmark inside it does not — dark on dark, illegible. Baking the
 * pill into the PNG makes the whole thing one uninvertible unit, so the mark
 * always sits on its own correct background.
 *
 * It also fixes Outlook, whose Word engine ignores border-radius: the rounded
 * shape is now pixels rather than a CSS property, so Outlook stops rendering a
 * square-cornered box.
 *
 * Everything is 2x: a 148x44 pill displayed at 74x22 CSS pixels... no — drawn
 * at 296x88 and displayed at 148x44.
 */
const SCALE = 2;
const PILL_W = 148 * SCALE;
const PILL_H = 44 * SCALE;
const PILL_RADIUS = PILL_H / 2; // fully rounded
const PILL_BORDER = 1 * SCALE;
const LOGO_W = 110 * SCALE; // 5:1 wordmark, so 22px tall displayed

// Brand logo masters. Note the naming: "-dark" means *for dark backgrounds*.
const BRAND_DOWNLOADS = '/Volumes/My Book/haveaspot/HAS-Brand/public/downloads';

/**
 * Two pills ship. Clients that honour `prefers-color-scheme` (Apple Mail, iOS
 * Mail) swap to the dark one; those that strip the stylesheet keep the light
 * one, which is correct rather than merely tolerable because it carries its own
 * background.
 *
 * The dark fills match the signature's dark tokens exactly — see brand.ts.
 */
const LOGO_PILLS = [
	{
		from: 'logo-primary-light.png', // ink wordmark + green a
		to: 'logo-pill-light.png',
		fill: '#F9FAFB',
		stroke: '#E5E7EB',
	},
	{
		from: 'logo-primary-dark.png', // white wordmark + green a
		to: 'logo-pill-dark.png',
		fill: '#1F1F1F',
		stroke: '#373737',
	},
];

await mkdir(iconOut, { recursive: true });
await mkdir(logoOut, { recursive: true });

// --- Icons -------------------------------------------------------------------
// The `._*` filter matters: this repo lives on an external drive, where macOS
// scatters AppleDouble sidecar files alongside the real ones. They end in .svg
// but are not images, and sharp rejects them with an opaque format error.
const icons = (await readdir(iconSrc)).filter(
	(f) => f.endsWith('.svg') && !f.startsWith('._'),
);

for (const file of icons) {
	const name = path.basename(file, '.svg');
	await sharp(path.join(iconSrc, file), { density: 384 })
		.resize(ICON_SIZE, ICON_SIZE, {
			fit: 'contain',
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png({ compressionLevel: 9 })
		.toFile(path.join(iconOut, `${name}.png`));

	console.log(`✓ icons/${name}.png (${ICON_SIZE}×${ICON_SIZE})`);
}

// --- Logo pills --------------------------------------------------------------
for (const { from, to, fill, stroke } of LOGO_PILLS) {
	const source = path.join(BRAND_DOWNLOADS, from);

	try {
		await access(source);
	} catch {
		console.warn(`! skipped ${to} — brand master not found at ${source}`);
		continue;
	}

	// The pill itself, drawn as SVG so the rounded corners and hairline border
	// are resolution-independent before rasterising. Inset by half the stroke
	// width so the border sits inside the bounds rather than being clipped.
	const inset = PILL_BORDER / 2;
	const pill = Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${PILL_W}" height="${PILL_H}">
			<rect x="${inset}" y="${inset}"
			      width="${PILL_W - PILL_BORDER}" height="${PILL_H - PILL_BORDER}"
			      rx="${PILL_RADIUS}" ry="${PILL_RADIUS}"
			      fill="${fill}" stroke="${stroke}" stroke-width="${PILL_BORDER}"/>
		</svg>`,
	);

	const wordmark = await sharp(source)
		.resize({ width: LOGO_W, withoutEnlargement: true })
		.toBuffer();

	const info = await sharp(pill)
		.composite([{ input: wordmark, gravity: 'centre' }])
		.png({ compressionLevel: 9 })
		.toFile(path.join(logoOut, to));

	console.log(`✓ logo/${to} (${info.width}×${info.height}, pill baked in)`);
}

console.log('\nDone.');
