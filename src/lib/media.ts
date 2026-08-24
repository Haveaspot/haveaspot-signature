import { put, del, list } from '@vercel/blob';
import { env } from './env';
import { LOGO_PILL_WIDTH, PILL_HEIGHT } from './signature-html';

/**
 * Uploaded artwork — campaign banners and logo overrides.
 *
 * The WordPress original took a URL and expected you to have put the image
 * somewhere else first — usually the WP media library. That indirection is the
 * thing being removed: assets are uploaded here and referenced by the URL the
 * store hands back.
 *
 * Vercel Blob rather than the filesystem because serverless functions have no
 * persistent disk, and rather than Postgres because a database is the wrong
 * place for binary image data.
 *
 * The URLs need to be publicly readable, but not for the reason it first
 * appears: mail clients never fetch them. The promo image is composited *into*
 * the CTA PNG server-side, so it is this app that reads the blob, and the
 * recipient only ever sees the rendered card.
 */

/**
 * Banners and logos are kept apart.
 *
 * Not tidiness: they are different shapes with different rules, and a picker
 * that offered both would invite putting a 1080×360 banner where a 148×44 pill
 * belongs. Separate prefixes also mean the delete guard stays exact.
 */
export type MediaKind = 'banner' | 'logo';

const PREFIXES: Record<MediaKind, string> = {
	banner: 'banners/',
	logo: 'logos/',
};

/** Formats Satori can composite. SVG is excluded — it cannot rasterise it. */
const ALLOWED = new Map<string, string>([
	['image/png', 'png'],
	['image/jpeg', 'jpg'],
	['image/webp', 'webp'],
	['image/gif', 'gif'],
]);

/**
 * 4MB. Generous for a 1080×360 banner and small enough that a stray
 * multi-megapixel photo is rejected before it is stored — the renderer would
 * have to download it on every cache miss.
 */
export const MAX_BYTES = 4 * 1024 * 1024;

export interface MediaItem {
	url: string;
	pathname: string;
	filename: string;
	size: number;
	uploadedAt: Date;
}

export function isConfigured(): boolean {
	return Boolean(env('BLOB_READ_WRITE_TOKEN'));
}

/** Thrown when uploads are attempted before the store exists, with the fix. */
export class MediaNotConfigured extends Error {
	constructor() {
		super(
			'No blob store connected. Create one in Vercel → Storage → Blob and connect ' +
				'it to this project, then redeploy. Locally, add BLOB_READ_WRITE_TOKEN to .env.',
		);
	}
}

function token(): string {
	const value = env('BLOB_READ_WRITE_TOKEN');
	if (!value) throw new MediaNotConfigured();
	return value;
}

export async function listMedia(kind: MediaKind = 'banner'): Promise<MediaItem[]> {
	const prefix = PREFIXES[kind];
	const { blobs } = await list({ prefix, token: token() });

	return blobs
		.map((b) => ({
			url: b.url,
			pathname: b.pathname,
			filename: b.pathname.slice(prefix.length),
			size: b.size,
			uploadedAt: new Date(b.uploadedAt),
		}))
		.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
}

export interface UploadResult {
	url: string;
	filename: string;
}

export async function uploadMedia(file: File, kind: MediaKind = 'banner'): Promise<UploadResult> {
	const prefix = PREFIXES[kind];
	const extension = ALLOWED.get(file.type);
	if (!extension) {
		throw new Error(
			`${file.type || 'That file type'} is not supported. Use PNG, JPEG, WebP or GIF.`,
		);
	}

	if (file.size > MAX_BYTES) {
		throw new Error(
			`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_BYTES / 1024 / 1024}MB.`,
		);
	}

	// Strip the extension and anything path-like from the supplied name, then
	// let the store add a random suffix. Two people uploading "banner.png" must
	// not overwrite each other, and the name must not be able to escape PREFIX.
	const base =
		file.name
			.replace(/\.[^.]+$/, '')
			.replace(/[^a-zA-Z0-9-_ ]/g, '')
			.trim()
			.slice(0, 60) || kind;

	const blob = await put(`${prefix}${base}.${extension}`, file, {
		access: 'public',
		addRandomSuffix: true,
		token: token(),
	});

	return { url: blob.url, filename: blob.pathname.slice(prefix.length) };
}

export async function deleteMedia(url: string, kind: MediaKind = 'banner'): Promise<void> {
	// Only ever delete within the prefix being managed, so a crafted URL cannot
	// reach another blob in the same store — including one of the other kind.
	if (!new URL(url).pathname.includes(`/${PREFIXES[kind]}`)) {
		throw new Error(`That URL is not a ${kind} in this library.`);
	}
	await del(url, { token: token() });
}

/**
 * Read PNG/JPEG/WebP/GIF dimensions from the file header.
 *
 * Enough to tell someone their banner will be cropped before they discover it
 * in a rendered signature, without pulling an image library into the request
 * path. Returns null when the header is not recognised, and callers treat that
 * as "unknown" rather than as an error.
 */
export function readDimensions(buf: Uint8Array): { width: number; height: number } | null {
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

	// PNG: IHDR width/height at bytes 16..24.
	if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
		return { width: view.getUint32(16), height: view.getUint32(20) };
	}

	// GIF: little-endian width/height at bytes 6..10.
	if (buf.length > 10 && buf[0] === 0x47 && buf[1] === 0x49) {
		return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
	}

	// WebP (VP8X/VP8 /VP8L all sit inside a RIFF container).
	if (buf.length > 30 && buf[0] === 0x52 && buf[8] === 0x57) {
		const fourcc = String.fromCharCode(buf[12]!, buf[13]!, buf[14]!, buf[15]!);
		if (fourcc === 'VP8X') {
			const w = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16));
			const h = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16));
			return { width: w, height: h };
		}
	}

	// JPEG: walk the segment markers to the start-of-frame.
	if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
		let i = 2;
		while (i < buf.length - 9) {
			if (buf[i] !== 0xff) {
				i++;
				continue;
			}
			const marker = buf[i + 1]!;
			// SOF0–SOF3 and SOF5–SOF15 carry the dimensions; skip everything else.
			if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
				return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
			}
			i += 2 + view.getUint16(i + 2);
		}
	}

	return null;
}

/** The ratio the CTA renderer composites promo art at. */
export const TARGET_RATIO = 3;

/**
 * The logo's ratio, taken from the pill geometry rather than written down
 * again, so the guidance cannot drift from what the signature actually renders.
 */
export const LOGO_RATIO = LOGO_PILL_WIDTH / PILL_HEIGHT;

/** Native size of the pill, and the 2x size worth producing for retina. */
export const LOGO_SIZE = `${LOGO_PILL_WIDTH}×${PILL_HEIGHT}`;
export const LOGO_SIZE_2X = `${LOGO_PILL_WIDTH * 2}×${PILL_HEIGHT * 2}`;

export function ratioNote(width: number, height: number): string | null {
	const ratio = width / height;
	if (Math.abs(ratio - TARGET_RATIO) < 0.08) return null;
	return ratio > TARGET_RATIO
		? 'Wider than 3:1 — the left and right edges will be cropped.'
		: 'Taller than 3:1 — the top and bottom will be cropped.';
}

/**
 * The logo warning is about stretching, not cropping — a genuinely different
 * failure from the banner's.
 *
 * The signature sets both `width` and `height` on the logo image, so a
 * mismatched file is squashed to fit rather than trimmed. Someone told their
 * logo will be "cropped" would look for missing edges; the actual symptom is a
 * distorted wordmark, which is easy to miss and worth naming precisely.
 */
export function logoRatioNote(width: number, height: number): string | null {
	const ratio = width / height;
	if (Math.abs(ratio - LOGO_RATIO) < 0.08) return null;
	return ratio > LOGO_RATIO
		? `Wider than the ${LOGO_SIZE} pill — it will be squashed horizontally, not cropped.`
		: `Taller than the ${LOGO_SIZE} pill — it will be stretched horizontally, not cropped.`;
}
