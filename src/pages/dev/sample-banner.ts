import type { APIRoute } from 'astro';
import { ImageResponse } from '@vercel/og';
import { brand } from '../../lib/brand';
import { h, loadFonts } from '../../lib/og';

export const prerender = false;

/**
 * A placeholder promo banner — development only.
 *
 * Exists so the preview can show how a campaign banner sits inside the CTA
 * card without anyone having to produce real artwork first. It draws its own
 * dimensions onto itself, which makes the cropping behaviour visible: the
 * renderer composites promo art at PROMO_RATIO, so a banner supplied at another ratio
 * is cover-cropped rather than letterboxed.
 *
 * `?w=` and `?h=` set the source dimensions, so the preview can show both a
 * correctly-proportioned banner and a mis-proportioned one being cropped.
 */
export const GET: APIRoute = async ({ url }) => {
	if (!import.meta.env.DEV) {
		return new Response('Not found', { status: 404 });
	}

	const width = Math.min(2000, Math.max(100, Number(url.searchParams.get('w')) || 1080));
	const height = Math.min(2000, Math.max(100, Number(url.searchParams.get('h')) || 360));
	const ratio = (width / height).toFixed(2);

	const fonts = await loadFonts();

	return new ImageResponse(
		h(
			'div',
			{
				style: {
					width: '100%',
					height: '100%',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					backgroundColor: brand.ink,
					color: brand.white,
					fontFamily: 'Poppins',
					// Diagonal wash so cropping is obvious at a glance.
					backgroundImage: `linear-gradient(135deg, ${brand.ink} 0%, ${brand.accentDeep} 60%, ${brand.accent} 100%)`,
				},
			},
			h('div', { style: { fontSize: Math.round(height / 6), fontWeight: 700 } }, 'SAMPLE BANNER'),
			h(
				'div',
				{ style: { fontSize: Math.round(height / 11), fontWeight: 400, marginTop: 8 } },
				`${width} × ${height}  ·  ${ratio}:1`,
			),
		),
		{ width, height, fonts, headers: { 'Cache-Control': 'no-store' } },
	);
};
