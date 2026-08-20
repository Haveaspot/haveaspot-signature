# HAS-Signature

Haveaspot email signature generator, CRM and campaign engine.

A port of the WordPress plugin `MECH-SIGNATURE: CRM & Generator` (v13.4) to
Astro + Vercel. Staff fill in a short form, get a branded signature to paste into
their mail client, and marketing can push a scheduled banner into everyone's
signature without anyone regenerating anything.

Local dev port: **4326** (About 4321, Blog 4322, KB 4323, Brand 4324; 4325 is
already taken by the IMP Blog Filter preview).

## How it works

The signature is HTML, but the promotional block underneath it is a **PNG
rendered on demand** by this app. That indirection is the whole point: because
the mail client requests the image fresh each time the email is opened, the
banner can be changed centrally after the signature has already been pasted into
a thousand outboxes.

```
signature HTML (pasted once, never changes)
   └── <img src="/api/cta?user=…&section=content">  ← re-rendered per open
   └── <a href="/api/track/cta?user=…">              ← logs the click, redirects
```

## Setup

```bash
npm install
cp .env.example .env      # then fill in POSTGRES_URL and CRON_SECRET
npm run db:push           # create the tables
npm run dev
```

### Fonts

`public/fonts/` holds Poppins Regular/Medium/Bold. `@vercel/og` needs real font
binaries — unlike PHP's GD it cannot fall back to system fonts, so these are
committed rather than fetched. Replacements come from
[Google Fonts](https://fonts.google.com/specimen/Poppins).

Poppins is licensed under the SIL Open Font License 1.1. The OFL requires the
licence and copyright notice to be distributed **with** the font files, which is
why `OFL.txt` sits in the same directory — keep it there when changing weights.
Unlike CC BY it does not require a visible credit, but the site footer names it
anyway, alongside the Font Awesome attribution that is mandatory.

### Icons and logo

`npm run build:assets` rasterises both. Re-run it after changing any source art.

Icons: source SVGs in `assets/icons/` → 40×40 PNGs in `public/icons/`
(displayed at 20px, doubled for retina).

PNG rather than SVG because Outlook renders through Word and shows nothing for
inline SVG. Flat `#021300` on transparent, because the signature's dark-mode
rule recolours them with `filter: brightness(0) invert(1)`, which only produces
a clean white icon from a single solid source colour.

Icons are Font Awesome Free v7.3.1, which is CC BY 4.0 — **attribution is
required**. The licence comment is preserved in each source SVG, but that
comment does not survive rasterisation, so satisfy it somewhere visible (an
About/credits page on one of the sites is the usual approach).

Logo: built from the brand masters in `HAS-Brand/public/downloads/` into
`public/logo/` at 260px wide (displayed at 130px). Two variants ship —
`logo-light.png` (ink wordmark) and `logo-dark.png` (white wordmark), both
keeping the green "a".

The wordmark is **swapped** for dark mode, not filtered like the icons: the
icons are single-colour silhouettes that `brightness(0) invert(1)` recolours
cleanly, but the same filter would flatten the logo's green "a" to plain white.
The dark variant sits behind an `<!--[if !mso]>` conditional so Outlook, which
ignores media queries, renders one logo rather than two stacked.

Note the brand naming convention is inverted from what it looks like:
`logo-primary-dark.png` means *for dark backgrounds* (a white wordmark).

The `logo_url` / `logo_url_dark` settings override these, but are blank by
default — the bundled copies are served from this same domain, so nothing
depends on another site's asset paths staying put.

## Architecture

| Concern | WordPress original | Here |
|---|---|---|
| Employee records | `settlin_signature` CPT + postmeta | `signatures` table |
| Departments | `settlin_department` taxonomy | `departments` + join table |
| Campaigns | `settlin_campaigns` CPT + postmeta | `campaigns` + `campaign_targets` |
| Settings | `wp_options` (`mech_sig_*`) | `settings` table |
| Click log | `wp_mech_sig_clicks` | `clicks` table |
| Image rendering | PHP GD, 4 near-identical routers | `@vercel/og`, one route |
| Image cache | `set_transient` + manual busting | CDN `s-maxage` headers |
| Scheduled sweep | WP-Cron every 5 min | Vercel Cron, daily (not load-bearing) |

### Key files

- `src/lib/campaigns.ts` — **the important one.** Resolves the
  global → per-user → campaign precedence chain. The plugin duplicated this
  logic in five places; consolidating it is the main structural change.
- `src/lib/signature-html.ts` — the email markup. Table layout and inline
  styles, because Outlook renders through Word.
- `src/pages/api/cta.ts` — image renderer (`section=content|button|promo`).
- `src/pages/api/track/[asset].ts` — click logging and redirects.
- `db/schema.sql` — annotated schema, applied by `npm run db:push`.
- `db/schema-single-statement.sql` — the same schema wrapped in a DO block, for
  Neon's Query console, which rejects multiple semicolon-separated commands.
  Regenerate it if the schema changes.

### Design preview (dev only)

`/dev/preview` renders the real `renderSignature` output in light and dark, side
by side, across five variants — typical, minimal, long values, one phone, and
CTA disabled. The awkward ones matter most: a long name or a wrapping heading is
what breaks a fixed-width table layout, and nobody thinks to type those into the
form by hand.

It renders from `SETTING_DEFAULTS` and hand-built configs, so it needs no
database. Three of the variants exercise promo banners, drawn by
`/dev/sample-banner` — including one supplied at 16:9 to show the cover-crop:
the renderer composites promo art at 3:1 and crops rather than letterboxing, so
banners want producing at 3:1 (1080x360 works well). Images and links point at production by default, because the CTA
banner comes from `/api/cta` and would otherwise be a hole in the layout;
`?images=local` switches back when the assets or the image renderer are what you
are changing.

The dark panes re-emit the signature's own rules via `darkRulesCss('.force-dark ')`
rather than keeping a copy, so the preview cannot drift from what really lands in
an inbox.

Guarded twice — in the page and in middleware — and Vite strips the body at build
time, so it is absent from the production bundle rather than merely unreachable.

### Timing: what is live vs cached

Campaign windows are evaluated in SQL on **every** image render, so a campaign
goes live and expires on time regardless of the cron schedule. The cron job is a
daily health report and mutates nothing.

The real delay before a change reaches inboxes is the CDN cache on the image
routes — `s-maxage=300`, so up to **5 minutes**. Lower that TTL if campaigns ever
need to turn over faster; changing the cron frequency would achieve nothing.

## Admin area

`/admin` is behind a single shared password in `ADMIN_PASSWORD`. Generate one
with `openssl rand -base64 24` — it is the only thing protecting staff contact
details and analytics, so it needs to be long and random.

How it is put together, and why:

- **Deny by default.** `src/middleware.ts` gates everything under `/admin`, with
  the login page as the one explicit exception. New admin pages are protected
  the moment they are created — no per-page guard to forget.
- **Sessions are signed cookies**, HttpOnly, `SameSite=Lax`, scoped to `/admin`,
  8 hour expiry. No session table.
- **The signing key is derived from the password.** Rotating `ADMIN_PASSWORD`
  therefore signs everyone out immediately, which is what you want when someone
  leaves or the password leaks. It also keeps setup to one variable.
- **Login attempts are throttled** per address (10 failures, 15 minute lockout),
  counted in Postgres because serverless invocations share no memory.
- **The throttle fails open** if the database is unreachable. That is deliberate:
  the password is the actual gate and needs no database, whereas failing closed
  would lock you out of the dashboard whose job is to report that the database
  is down.
- **Logout is POST only**, so another site cannot sign you out with an image tag.

Astro's built-in origin check rejects cross-site form posts, so the login form
is CSRF-protected without extra work. (If you ever test it with `curl`, pass
`-H "Origin: <site url>"` or you will get a confusing 403.)

Swapping the shared password for emailed one-time codes later means replacing
`verifyPassword` and the login form only — the session layer is deliberately
independent of how someone proves who they are.

## Deployment

Push to `main`; Vercel builds and deploys. Before the first deploy set these
environment variables in the Vercel project:

- `POSTGRES_URL` — set automatically when a Vercel Postgres store is linked
- `CRON_SECRET` — `openssl rand -hex 32`
- `PUBLIC_SITE_URL` — `https://sig.haveaspot.com`
- `ALLOWED_EMAIL_DOMAIN` — `haveaspot.com`
- `ADMIN_PASSWORD` — `openssl rand -base64 24`

`PUBLIC_SITE_URL` must be the live domain. Every image and link is baked into
the signature as an absolute URL, and a `localhost` URL in a colleague's Gmail
resolves to nothing.

## Still to build

- `/admin` — the CRUD screens for signatures, departments, campaigns and
  settings, plus the analytics dashboard (the plugin had a Chart.js timeline and
  asset breakdowns). Authentication and the dashboard shell are in place; the
  screens themselves are not built yet.
- Rate limiting on `/api/sync`.
- Promo images assume a 3:1 aspect ratio; the upload UI should enforce it, or
  the renderer should read real dimensions.
- The heading height estimate in `src/lib/og.ts` is arithmetic, not real text
  measurement — check long, wrapping headings look right and tune if needed.
