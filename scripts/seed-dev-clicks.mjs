/**
 * Fill the clicks table with plausible sample data, for working on analytics.
 *
 * DEVELOPMENT ONLY. This writes junk rows that would corrupt real reporting, so
 * it refuses to run without an explicit confirmation argument and prints the
 * host it is about to write to first. Point it at a Neon dev branch, never at
 * the branch production uses.
 *
 *   node scripts/seed-dev-clicks.mjs --yes-i-am-on-a-dev-branch
 *
 * Remove the rows again with:
 *   DELETE FROM clicks WHERE visitor_hash LIKE 'seed-%';
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const CONFIRM = '--yes-i-am-on-a-dev-branch';

function connectionString() {
	if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;
	const line = readFileSync('.env', 'utf8')
		.split('\n')
		.find((l) => l.startsWith('POSTGRES_URL='));
	if (!line) throw new Error('No POSTGRES_URL in .env');
	return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}

const url = connectionString();
const host = /@([^/?]+)/.exec(url)?.[1] ?? 'unknown';

if (!process.argv.includes(CONFIRM)) {
	console.error(`Refusing to run without ${CONFIRM}.`);
	console.error(`Would have written sample clicks to: ${host}`);
	console.error('Check that host is a dev branch before re-running.');
	process.exit(1);
}

console.log(`Seeding sample clicks into: ${host}`);

const sql = postgres(url, { max: 1, prepare: false });

// Weighted so the mix looks like real usage rather than a uniform spread —
// a flat distribution would make every breakdown chart look identical and
// hide whether the ordering actually works.
const pick = (weighted) => {
	const total = weighted.reduce((n, [, w]) => n + w, 0);
	let r = Math.random() * total;
	for (const [value, w] of weighted) {
		if ((r -= w) < 0) return value;
	}
	return weighted[0][0];
};

const ASSETS = [
	['cta_default', 30],
	['cta_campaign', 22],
	['website', 18],
	['vcard', 12],
	['linkedin', 10],
	['mail', 8],
];
const CLIENTS = [
	['Gmail (Proxy)', 34],
	['Apple Mail', 26],
	['Outlook', 20],
	['Chrome (Web)', 10],
	['Safari (Web)', 6],
	['Unknown', 4],
];
const DEVICES = [
	['Mobile', 58],
	['Desktop', 42],
];
const OS = [
	['iOS', 34],
	['Windows', 26],
	['MacOS', 22],
	['Android', 14],
	['Linux', 4],
];
const COUNTRIES = [
	['GB', 72],
	['IE', 8],
	['US', 8],
	['FR', 4],
	['DE', 4],
	['??', 4],
];

try {
	const staff = await sql`SELECT id, email FROM signatures`;
	const campaigns = await sql`SELECT id FROM campaigns`;

	if (staff.length === 0) {
		console.error('No signatures exist — generate one first, or there is nothing to attribute to.');
		process.exit(1);
	}

	const rows = [];
	const DAYS = 90;
	const VISITORS = 40;

	for (let d = 0; d < DAYS; d++) {
		// A weekday-ish rhythm with a gentle upward trend, so the chart has shape
		// to read rather than being uniform noise.
		const date = new Date();
		date.setDate(date.getDate() - d);
		const weekend = [0, 6].includes(date.getDay());
		const trend = 1 + (DAYS - d) / DAYS;
		const n = Math.round((weekend ? 1 : 5) * trend * (0.5 + Math.random()));

		for (let i = 0; i < n; i++) {
			const person = staff[Math.floor(Math.random() * staff.length)];
			const asset = pick(ASSETS);
			const at = new Date(date);
			at.setHours(8 + Math.floor(Math.random() * 11), Math.floor(Math.random() * 60), 0, 0);

			rows.push({
				clicked_at: at,
				sender_email: person.email,
				signature_id: person.id,
				department_id: null,
				campaign_id:
					asset === 'cta_campaign' && campaigns.length
						? campaigns[Math.floor(Math.random() * campaigns.length)].id
						: null,
				asset_type: asset,
				device_type: pick(DEVICES),
				os_platform: pick(OS),
				email_client: pick(CLIENTS),
				country_code: pick(COUNTRIES),
				// Prefixed so the seed rows can be deleted again without touching
				// anything real that might be in the same table.
				visitor_hash: `seed-${Math.floor(Math.random() * VISITORS)}`,
			});
		}
	}

	await sql`INSERT INTO clicks ${sql(rows)}`;
	console.log(`Inserted ${rows.length} sample clicks across ${DAYS} days.`);

	/**
	 * Impressions to divide those clicks by.
	 *
	 * Seeded from the click rows rather than independently, so the click-through
	 * rate lands somewhere believable. Without this the dashboard shows clicks
	 * over almost no views and reports a rate in the thousands — technically
	 * correct, and useless for judging whether the panel reads well.
	 *
	 * Roughly 3-6% of views turn into a click, which is the range a real banner
	 * tends to sit in.
	 */
	const impressions = new Map();
	for (const row of rows) {
		if (!row.asset_type.startsWith('cta_')) continue;
		const day = row.clicked_at.toISOString().slice(0, 10);
		const key = `${day}|${row.sender_email}|${row.campaign_id ?? ''}`;
		const views = 20 + Math.floor(Math.random() * 15);
		const existing = impressions.get(key);
		if (existing) existing.views += views;
		else
			impressions.set(key, {
				day,
				sender_email: row.sender_email,
				campaign_id: row.campaign_id,
				views,
			});
	}

	if (impressions.size) {
		await sql`INSERT INTO impressions ${sql([...impressions.values()])}`;
		const total = [...impressions.values()].reduce((n, r) => n + r.views, 0);
		console.log(`Inserted ${total} sample banner views across ${impressions.size} rows.`);
	}

	console.log("Remove later with: DELETE FROM clicks WHERE visitor_hash LIKE 'seed-%';");
	console.log('                   DELETE FROM impressions;  -- dev branch only');
} catch (error) {
	console.error('Failed:', error.message);
	process.exitCode = 1;
} finally {
	await sql.end();
}
