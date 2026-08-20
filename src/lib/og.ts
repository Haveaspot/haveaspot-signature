import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Minimal element factory for Satori (`@vercel/og`).
 *
 * Satori consumes React-shaped element trees but never actually calls React, so
 * building the tree by hand keeps React out of the dependency list for what is
 * a server-only image route.
 */
export function h(
	type: string,
	props: Record<string, unknown> = {},
	...children: unknown[]
) {
	return {
		type,
		key: null,
		props: { ...props, children: children.length === 1 ? children[0] : children },
	};
}

/** Cached across warm invocations — reading fonts per request is wasteful. */
let fontCache: { name: string; data: ArrayBuffer; weight: 400 | 500 | 700 }[] | null = null;

/**
 * Load the Poppins weights used in the CTA artwork.
 *
 * Satori needs real font binaries; it cannot fall back to system fonts the way
 * GD did. Files live in `public/fonts/` — see README for where to get them.
 */
export async function loadFonts() {
	if (fontCache) return fontCache;

	const dir = path.join(process.cwd(), 'public', 'fonts');
	const files: { file: string; weight: 400 | 500 | 700 }[] = [
		{ file: 'Poppins-Regular.ttf', weight: 400 },
		{ file: 'Poppins-Medium.ttf', weight: 500 },
		{ file: 'Poppins-Bold.ttf', weight: 700 },
	];

	fontCache = await Promise.all(
		files.map(async ({ file, weight }) => ({
			name: 'Poppins',
			data: (await readFile(path.join(dir, file))).buffer as ArrayBuffer,
			weight,
		})),
	);

	return fontCache;
}

/**
 * Estimate how many lines a heading wraps to at a given width.
 *
 * Satori lays text out internally but `ImageResponse` still needs an explicit
 * height up front, so the height has to be predicted before rendering — the
 * same problem the PHP solved with imagettfbbox. Poppins averages ~0.55em per
 * character at these sizes; the estimate is intentionally slightly generous,
 * since a few extra pixels of matching background are invisible while a
 * clipped descender is not.
 *
 * `|` is honoured as an explicit line break, matching the plugin.
 */
export function estimateLines(
	text: string,
	fontSize: number,
	maxWidth: number,
): number {
	const avgCharWidth = fontSize * 0.55;
	const charsPerLine = Math.max(1, Math.floor(maxWidth / avgCharWidth));

	return text
		.split(/[|\n]/)
		.map((segment) => segment.trim())
		.filter(Boolean)
		.reduce((total, segment) => {
			const words = segment.split(/\s+/);
			let lines = 1;
			let current = 0;

			for (const word of words) {
				const wordLength = word.length + (current === 0 ? 0 : 1);
				if (current + wordLength > charsPerLine && current > 0) {
					lines++;
					current = word.length;
				} else {
					current += wordLength;
				}
			}
			return total + lines;
		}, 0);
}

/** Split on `|` / newlines the way the plugin did, for rendering. */
export function headingLines(text: string): string[] {
	return text
		.split(/[|\n]/)
		.map((s) => s.trim())
		.filter(Boolean);
}
