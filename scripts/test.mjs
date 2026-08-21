/**
 * Test runner.
 *
 * The tests import `.ts` modules that use extensionless relative imports, which
 * Vite resolves but bare Node does not — so they are bundled with the esbuild
 * that already ships inside Astro rather than pulling in a test framework.
 *
 * The bundle is written inside the project so Node can resolve node_modules
 * from it, and removed afterwards.
 *
 * Run with: npm test
 */
import { spawnSync } from 'node:child_process';
import { rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild');

const tests = readdirSync(path.join(root, 'tests')).filter(
	(f) => f.endsWith('.test.ts') && !f.startsWith('._'),
);

let failed = 0;

for (const test of tests) {
	const bundle = path.join(root, `.test-${path.basename(test, '.ts')}.mjs`);

	const built = spawnSync(
		esbuild,
		[
			path.join(root, 'tests', test),
			'--bundle',
			'--platform=node',
			'--format=esm',
			`--outfile=${bundle}`,
			'--log-level=error',
			'--external:@vercel/og',
		],
		{ stdio: 'inherit' },
	);

	if (built.status !== 0) {
		failed++;
		continue;
	}

	console.log(`\n── ${test} ──`);
	const run = spawnSync('node', [bundle], { stdio: 'inherit', cwd: root });
	if (run.status !== 0) failed++;

	rmSync(bundle, { force: true });
}

process.exit(failed ? 1 : 0);
