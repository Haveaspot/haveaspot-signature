/**
 * Campaign scheduling times must survive a round trip unchanged.
 *
 * Requires a database — skipped with a clear note when POSTGRES_URL is absent,
 * so `npm test` still passes on a machine with no Postgres.
 *
 * Both a winter and a summer date are checked deliberately. The bug this covers
 * only appeared under BST: the driver inferred the parameter as a timestamptz
 * and Postgres applied the session timezone before the explicit cast, landing
 * the offset twice. GMT dates round-tripped perfectly throughout, so a
 * winter-only test would have passed against the broken code.
 */
import postgres from 'postgres';
import { readFileSync, existsSync } from 'node:fs';

function connectionString(): string | null {
	if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;
	if (!existsSync('.env')) return null;
	const line = readFileSync('.env', 'utf8')
		.split('\n')
		.find((l) => l.startsWith('POSTGRES_URL='));
	if (!line) return null;
	const value = line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
	return value.startsWith('postgres') ? value : null;
}

const url = connectionString();

if (!url) {
	console.log('  skipped — no POSTGRES_URL (campaign time round-trip needs a database)');
	process.exit(0);
}

const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 15 });
const TZ = 'Europe/London';

const cases = [
	{ input: '2026-12-15T09:00', season: 'GMT', expectUtc: '2026-12-15T09:00:00.000Z' },
	{ input: '2026-07-15T09:00', season: 'BST', expectUtc: '2026-07-15T08:00:00.000Z' },
];

let failed = 0;

for (const { input, season, expectUtc } of cases) {
	// Exactly the expressions saveCampaign and the list queries use.
	const rows = await sql<{ stored: Date; round_trip: string }[]>`
		SELECT (${input}::text::timestamp AT TIME ZONE ${TZ}) AS stored,
		       to_char(
		         (${input}::text::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ},
		         'YYYY-MM-DD"T"HH24:MI'
		       ) AS round_trip
	`;

	const stored = rows[0]!.stored.toISOString();
	const back = rows[0]!.round_trip;

	const storedOk = stored === expectUtc;
	const tripOk = back === input;

	console.log(`${storedOk ? '  ok' : 'FAIL'}  ${season}: stored as ${stored}`);
	console.log(`${tripOk ? '  ok' : 'FAIL'}  ${season}: round-trips to ${back}`);
	if (!storedOk || !tripOk) failed++;
}

await sql.end();

console.log(`\n${cases.length * 2 - failed * 2}/${cases.length * 2} passed`);
process.exit(failed ? 1 : 0);
