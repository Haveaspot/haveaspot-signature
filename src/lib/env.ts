/**
 * Environment variable access that works in both places this app runs.
 *
 * The two runtimes disagree about where variables live:
 *
 *  - **Local dev**: Vite loads `.env` into `import.meta.env`. It does *not*
 *    copy the values into `process.env`.
 *  - **Vercel**: real environment variables arrive in `process.env`.
 *
 * Reading only `process.env` silently yields undefined for every value in a
 * local `.env` file — which looks exactly like "the database is down" rather
 * than "the config was never read". Checking both is the only way to get one
 * behaviour across both runtimes.
 */
export function env(key: string): string | undefined {
	const fromVite = (import.meta.env as Record<string, string | undefined>)[key];
	if (fromVite !== undefined && fromVite !== '') return fromVite;

	const fromNode = process.env[key];
	if (fromNode !== undefined && fromNode !== '') return fromNode;

	return undefined;
}

/** Same, but throws a clear error rather than failing mysteriously later. */
export function requireEnv(key: string, hint = ''): string {
	const value = env(key);
	if (!value) {
		throw new Error(`${key} is not set.${hint ? ` ${hint}` : ''}`);
	}
	return value;
}
