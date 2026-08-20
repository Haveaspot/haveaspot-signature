/**
 * Apply db/schema.sql to the database in POSTGRES_URL.
 *
 * The schema is written with IF NOT EXISTS throughout, so this is safe to run
 * repeatedly. Run with: npm run db:push
 */
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
	console.error('POSTGRES_URL is not set. Copy .env.example to .env first.');
	process.exit(1);
}

const sql = postgres(connectionString, { max: 1, prepare: false });

try {
	const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
	await sql.unsafe(schema);
	console.log('✓ Schema applied.');
} catch (error) {
	console.error('✗ Failed to apply schema:', error.message);
	process.exitCode = 1;
} finally {
	await sql.end();
}
