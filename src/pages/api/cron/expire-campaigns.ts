import type { APIRoute } from 'astro';
import { sql } from '../../../lib/db';

export const prerender = false;

/**
 * Campaign reporting — the vestigial descendant of the plugin's five-minute
 * WP-Cron sweep. Runs daily (see vercel.json).
 *
 * This job is deliberately not load-bearing, and the schedule does not matter:
 * `getActiveCampaign` evaluates the date window in SQL on every render, so
 * campaigns start and expire exactly on time whether this has run recently or
 * never. The plugin needed a frequent sweep because it cached rendered images
 * in transients and had to bust that cache by hand; here the CDN expires them
 * on a short TTL instead.
 *
 * What remains is a health signal — a cheap daily answer to "is the database
 * reachable, and what has lapsed?" — which is why a once-a-day schedule (all
 * the Vercel Hobby plan allows) costs nothing functionally.
 *
 * If this ever grows side effects, revisit that reasoning: anything that must
 * happen promptly cannot live here.
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
