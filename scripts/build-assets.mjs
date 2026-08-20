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
const LOGO_WIDTH = 260; // displayed at 130px

// Brand logo masters. Note the naming: "-dark" means *for dark backgrounds*.
const BRAND_DOWNLOADS = '/Volumes/My Book/haveaspot/HAS-Brand/public/downloads';
const LOGOS = [
	{ from: 'logo-primary-light.png', to: 'logo-light.png' }, // ink + green a
	{ from: 'logo-primary-dark.png', to: 'logo-dark.png' }, // white + green a
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

// --- Logos -------------------------------------------------------------------
for (const { from, to } of LOGOS) {
	const source = path.join(BRAND_DOWNLOADS, from);

	try {
		await access(source);
	} catch {
		console.warn(`! skipped ${to} — brand master not found at ${source}`);
		continue;
	}

	const info = await sharp(source)
		.resize({ width: LOGO_WIDTH, withoutEnlargement: true })
		.png({ compressionLevel: 9 })
		.toFile(path.join(logoOut, to));

	console.log(`✓ logo/${to} (${info.width}×${info.height})`);
}

console.log('\nDone.');
