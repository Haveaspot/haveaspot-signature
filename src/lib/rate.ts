/**
 * Click-through rate, shared by the analytics dashboard and the campaign page.
 *
 * One copy because the caveat matters as much as the arithmetic: a rate shown
 * without its explanation invites the wrong conclusion, and two copies of that
 * explanation would drift apart.
 */

/**
 * Returns null rather than 0% when there are no views to divide by: a banner
 * nobody has been shown has no rate, and printing 0% would read as "shown and
 * ignored", which is a different and much worse story.
 *
 * A rate over 100% is possible and is not a bug. Views only count readers whose
 * mail client loaded the image, and many never do, so one recorded view can
 * stand for several people — any of whom can click. Rather than capping the
 * number, which would quietly turn a real signal into a plausible-looking
 * figure, it is returned as it is and flagged for the caller to explain.
 */
export function ctr(clicks: number, views: number): { label: string; overflowed: boolean } | null {
	if (views === 0) return null;
	const rate = (clicks / views) * 100;
	return { label: `${rate.toFixed(1)}%`, overflowed: rate > 100 };
}

export const OVERFLOW_HINT =
	'More clicks than recorded views. Views only count readers whose mail client loaded the image, and many never do — so one recorded view can stand for several people, any of whom can click.';

/** The standing caveat on any view count, shown wherever one is. */
export const VIEWS_CAVEAT =
	'Banner views are a floor, not a true count of opens: they only count readers whose mail client loaded the image, and many never do.';
