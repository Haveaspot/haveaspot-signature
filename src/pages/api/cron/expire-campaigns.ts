import type { APIRoute } from 'astro';
import { sql } from '../../../lib/db';

export const prerender = false;

/**
 * Campaign housekeeping — replaces the plugin's five-minute WP-Cron sweep.
 *
 * Serverless functions only exist while handling a request, so there is no
 * background loop to hook; Vercel Cron calls this route on a schedule instead
 * (see vercel.json).
 *
 * Note this is now only bookkeeping, not correctness: `getActiveCampaign`
 * evaluates the date window in SQL on every render, so an expired campaign
 * stops appearing the moment it ends whether or not this job has run. The
 * plugin genuinely needed its sweep because it cached rendered images for five
 * minutes and had to bust that cache by hand.
 */
export const GET: APIRoute = async ({ request }) => {
	// Vercel Cron sends the deployment's CRON_SECRET as a bearer token; without
	// this check the endpoint would be publicly callable.
	const secret = process.env.CRON_SECRET;
	const auth = request.headers.get('authorization');

	if (!secret || auth !== `Bearer ${secret}`) {
		return new Response('Unauthorized', { status: 401 });
	}

	const expired = await sql<{ id: number; name: string }[]>`
		SELECT id, name FROM campaigns
		WHERE is_deactivated = false
		  AND ends_at IS NOT NULL
		  AND ends_at < now()
	`;

	return Response.json({
		ok: true,
		checkedAt: new Date().toISOString(),
		expiredCount: expired.length,
		expired: expired.map((c) => c.name),
	});
};
