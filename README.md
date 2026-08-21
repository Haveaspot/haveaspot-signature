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

`public/fonts/` holds Poppins Regular, Medium, Bold and ExtraBold. `@vercel/og`
needs real font binaries — unlike PHP's GD it cannot fall back to system fonts —
so these are committed rather than fetched. Replacements come from
[Google Fonts](https://fonts.google.com/specimen/Poppins).

**Adding a weight means adding a file.** Satori does no synthetic bolding: a
weight with no font loaded silently falls back to the nearest one that is, so
setting `fontWeight: 800` without shipping ExtraBold renders at 700 and looks
like the change simply did nothing. Register new weights in `loadFonts()`.

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
`public/logo/` as **148×44 pills with the background composited in** — drawn at
296×88 for retina. Two variants ship, `logo-pill-light.png` and
`logo-pill-dark.png`, both keeping the green "a".

**The pill is baked into the image on purpose.** Clients that impose their own
dark mode — Gmail and Outlook both do — invert CSS backgrounds but never touch
images. A CSS pill therefore flips dark in Gmail's dark theme while the ink
wordmark inside it does not, leaving dark on dark. There is no CSS fix: Gmail
strips the stylesheet and every class attribute outright (verified by inspecting
a real message). Baking the pill in makes it one uninvertible unit.

It also fixes Outlook, whose Word engine ignores `border-radius` and was
rendering the pill as a square-cornered box.

The wordmark is **swapped** for dark mode, not filtered like the icons: the
icons are single-colour silhouettes that `brightness(0) invert(1)` recolours
cleanly, but the same filter would flatten the logo's green "a" to plain white.
The dark variant sits behind an `<!--[if !mso]>` conditional so Outlook, which
ignores media queries, renders one logo rather than two stacked.

**The icon pill is still CSS-drawn** and therefore still has this problem — it
inverts in Gmail's dark theme while its ink icons do not. Fixing it means
splitting the pill across the four icon images so each keeps its own link,
which is fiddlier than the logo case and has not been done yet.

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
by side, across eight variants — typical, minimal, long values, one phone, CTA
disabled, and three exercising promo banners. The awkward ones matter most: a
long name or a wrapping heading is what breaks a fixed-width table layout, and
nobody thinks to type those into the form by hand.

It renders from `SETTING_DEFAULTS` and hand-built configs, so it needs no
database — `/dev/cta` draws the same artwork as `/api/cta` without one, and
`/dev/sample-banner` generates placeholder banners at any dimensions.
`?images=prod` points everything at the live site instead, for comparison.

One of the promo variants is deliberately 16:9 to show the cover-crop: the
renderer composites promo art at 3:1 and crops rather than letterboxing, so
banners want producing at **3:1** (1080×360 works well).

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

### Working on the admin locally

The admin screens need a database. Create a **Neon branch** of the production
database, put its connection string in `.env` as `POSTGRES_URL`, and work
against that — building CRUD means deliberately creating and deleting records,
which is not something to do against live staff data.

`npm run seed:clicks -- --yes-i-am-on-a-dev-branch` fills the clicks table with
90 days of plausible sample data for working on analytics. It refuses to run
without that argument and prints the host first, because the rows it writes
would corrupt real reporting. Remove them with
`DELETE FROM clicks WHERE visitor_hash LIKE 'seed-%';`.

### Banner uploads

Campaign artwork is uploaded through `/admin/media` and stored in **Vercel
Blob**. The WordPress original took a URL and expected the image to be hosted
elsewhere — usually the WP media library — and removing that indirection is the
point.

Set up: Vercel → Storage → Create → **Blob**, connect it to the project, then
redeploy. That sets `BLOB_READ_WRITE_TOKEN`.

Blob rather than the filesystem because serverless functions have no persistent
disk, and rather than Postgres because a database is the wrong place for binary
image data.

**Uploads are additive, not required.** Every banner field still accepts a
pasted URL, and the field falls back to a plain URL box when no store is
connected or the library cannot be read — so a blob problem can never block
editing a campaign.

The URLs are public, though not for the obvious reason: mail clients never fetch
them. Promo art is composited *into* the CTA PNG server-side, so it is this app
that reads the blob and the recipient only ever sees the rendered card.

Dimensions are read from the file header on upload to warn about the 3:1 crop
before someone finds out from a rendered signature. SVG is rejected — Satori
cannot rasterise it.

### Per-person LinkedIn

The generator takes an optional LinkedIn profile. Blank falls back to the
company page in `link_li`, which is all the WordPress original supported.

Resolved in `/api/track/linkedin` at click time rather than baked into the
signature markup, for the same reason the banner is a live image: someone who
adds their profile months later gets it working in the signature they pasted on
day one, without regenerating.

The URL is validated as a LinkedIn address and forced to https. A wrong link
here is expensive — it sits in an outbox for months and nobody proof-reads their
own icon row.

### Previewing a staff member's signature

The staff editor renders that person's complete signature, light and dark, as
their recipients see it right now — built from `resolveCtaConfig`, not from the
stored record, so it reflects the resolved chain rather than what is saved.

A badge names which layer is actually winning: the global default, their own
override, or a live campaign. That answers the question the chain makes easy to
get wrong — someone sets a personal override, sees it saved, and is puzzled that
a campaign is overriding it.

Links in the preview are inert. The markup is real, tracking links included, and
following one from an admin page would log a click against that person and skew
their own analytics.

### Previewing a campaign

The campaign editor and the settings page both render the banner live, light
and dark, as you type. `/admin/preview-cta` draws it from the current form
values with unset fields falling back to the saved settings, so what is shown is
what recipients get rather than a blank-field approximation.

It exists because a campaign otherwise goes from a form straight into everyone's
outgoing email, and a wrapped heading or a cropped banner is cheap to fix before
sending and expensive after.

### Throttling

`/api/sync` is public and writes to the CRM, so it is capped at 40 requests per
address per hour. Deliberately generous: on rollout day an entire office may
generate signatures from behind one NAT address, and blocking that would be a
worse failure than the abuse this guards against. It exists to stop a script
doing thousands.

Both throttle tables are pruned by the daily cron, which until then only
reported and did nothing — they look back an hour and a day respectively, so
without a prune they would grow forever.

## Still to build
- Promo images assume a 3:1 aspect ratio; the upload UI should enforce it, or
  the renderer should read real dimensions.
- The heading height estimate in `src/lib/og.ts` is arithmetic, not real text
  measurement — check long, wrapping headings look right and tune if needed.
