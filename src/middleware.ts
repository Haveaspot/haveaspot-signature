import { defineMiddleware } from 'astro:middleware';
import { COOKIE_NAME, verifySessionToken } from './lib/auth';

/**
 * Gate for the admin area.
 *
 * Deny-by-default: everything under /admin requires a valid session, and the
 * login page is the single explicit exception. New admin pages are therefore
 * protected the moment they are created — nobody has to remember to add a
 * guard, which is the usual way an admin route ends up public by accident.
 */
export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname } = context.url;

	if (!pathname.startsWith('/admin')) return next();

	// The login page and its form handler must stay reachable, or there would be
	// no way to obtain a session.
	if (pathname === '/admin/login') return next();

	const token = context.cookies.get(COOKIE_NAME)?.value;

	let valid = false;
	try {
		valid = verifySessionToken(token);
	} catch (error) {
		// verifySessionToken throws when ADMIN_PASSWORD is unset. Failing closed
		// matters here: a misconfigured deployment must lock the admin area, never
		// open it.
		console.error('[auth] session check failed', error);
		valid = false;
	}

	if (!valid) {
		// Preserve where they were heading so login can send them back.
		const next_ = encodeURIComponent(pathname + context.url.search);
		return context.redirect(`/admin/login?next=${next_}`, 302);
	}

	return next();
});
