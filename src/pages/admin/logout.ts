import type { APIRoute } from 'astro';
import { COOKIE_NAME, sessionCookieOptions } from '../../lib/auth';

export const prerender = false;

/**
 * Sign out.
 *
 * POST only. A GET logout can be triggered by any image tag or prefetch on
 * another site, which turns signing out into something a third party can do to
 * you unprompted.
 */
export const POST: APIRoute = async ({ cookies, redirect }) => {
	// Deleting must use the same path the cookie was set with, or the browser
	// keeps the original and the session survives the logout.
	cookies.delete(COOKIE_NAME, { path: sessionCookieOptions().path });
	return redirect('/admin/login', 302);
};
