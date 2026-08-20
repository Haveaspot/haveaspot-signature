// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
	site: 'https://sig.haveaspot.com',
	// SSR: the CRM sync, image routers, tracking redirects and vCard endpoints
	// all need to run per-request (this is what the PHP `template_redirect`
	// hooks were doing on WordPress).
	output: 'server',
	adapter: vercel(),
});
