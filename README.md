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

**The icon row is a table, one cell per icon, and its gaps are cell padding.**
This looks like a needlessly heavy way to space four images and it is not. The
pill is 148px because the logo pill is, so the icons get exactly the interior
that is left and not a pixel more. Mobile clients rescale a message to fit the
screen, and they do not round images and CSS lengths identically — so as inline
images spaced with `margin-right`, the row overflowed by a pixel on a phone and
the fourth icon wrapped onto a second line, stretching the pill into a lozenge.
Cells in a row cannot wrap. The padding is also deliberately wider than the gaps
(18 vs 10, same 148 total), reserving slack the padding can give back under
rescaling. Putting that width back into the gaps would look identical on desktop
and wrap again on a phone.

**The icon pill is still CSS-drawn** and therefore still has this problem — it
inverts in Gmail's dark theme while its ink icons do not. Fixing it means
splitting the pill across the four icon images so each keeps its own link,
which is fiddlier than the logo case and has not been done yet — though the
per-icon cells above are now the structure that would carry those slices.

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

### The generator's dark preview

The **Preview dark mode** button on the public generator re-emits the
signature's own dark rules under `.preview-stage--dark`, via `darkRulesCss()`.

It has to. Those rules live inside `@media (prefers-color-scheme: dark)`, which
answers the reader's operating system and not a button on a page — so toggling
the class alone darkened the stage *behind* the signature and left the signature
in light mode. That reads as dark mode being broken when it is only the preview
that is.

The bug is invisible on a machine set to dark mode, where the rules apply
regardless, so there is a test asserting the source emits them.

Same mechanism as the dev preview below, and for the same reason: re-emitted
rather than copied, so a preview cannot drift from what lands in an inbox.

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

**The banner is served uncacheable**, so a change reaches inboxes as soon as the
mail client next fetches the image. There is no CDN TTL to wait out.

That is deliberate, and it cost two wrong attempts to get right. The headers are
the WordPress plugin's, kept verbatim because they are the reason it behaved
correctly:

```
Cache-Control: no-store, no-cache, must-revalidate, max-age=0
Pragma: no-cache
Expires: Wed, 11 Jan 1984 05:00:00 GMT
```

Two traps, both of which this got wrong before:

**`ImageResponse` overrides your header if you let it.** It sets
`cache-control: public, immutable, no-transform, max-age=31536000`, and passing
`headers` appends rather than replaces — caches take the first `max-age` and
`immutable` means never revalidate, so banners were cached for a *year*.
`withCacheHeaders()` copies the body into a plain Response so the header is ours
outright; `headers.set()` on the original leaves the concatenation in place.

**`public, max-age=0, must-revalidate` is not strict.** It reads that way and is
not: `public` explicitly authorises a shared cache — and Gmail proxies every
image through one — to store the response, while `must-revalidate` without an
ETag or Last-Modified gives that cache nothing to revalidate against. Only
`no-store` says do not keep a copy.

**Vercel's edge caches it for 60 seconds; the reader never does.** This is the
other half of the plugin's design, which paired `no-store` to the client with a
five-minute transient on its own server. Without it every open paid for a cold
render — about 1.2s before the first byte, since the promo art is fetched from
Blob storage and the card rasterised from scratch.

`Vercel-CDN-Cache-Control: max-age=60` is read by Vercel's edge and **stripped
before the response reaches the reader**, so it cannot bring the stale banner
back: the mail client still sees `no-store` and still asks every time, it just
gets an answer from the edge. Do **not** use plain `s-maxage` for this — the
client sees that too.

Sixty seconds rather than five minutes: long enough that repeat opens are free,
short enough that a settings change still lands almost at once.

The cost is impression precision. When the edge answers, the function does not
run and the open is not counted; views are already documented as a floor and
this lowers it a little further. Speed in an inbox was judged worth more than
exactness in a dashboard.

If you add another image route, wrap it the same way, and check the header on
the deployed URL rather than trusting the code.

### Why the banner is a JPEG

`ImageResponse` only emits PNG, which stores every pixel exactly. Right for a
logo, wrong for a photograph: a banner carrying promo artwork came out at
**953 KB**, and since the image is deliberately uncacheable, every recipient
downloaded that on every open. Mail clients paint an image as it arrives, so on
a phone you saw the top of the card with no bottom edge until the rest landed —
which looked like a rendering bug and was a download in progress.

`toJpeg()` re-encodes it: **953 KB → 159 KB**, same dimensions, same 2x retina
sharpness.

Three things about it are load-bearing:

**The corners have to be painted.** The card has rounded corners, and the pixels
outside that radius are transparent so the email shows through. JPEG has no
transparency, so they are flattened onto the colour *behind* the card in the
signature — white in light mode, `darkModeSurface` in dark. Not the card's own
fill. It is exact because light and dark render as separate images.

**Chroma subsampling is off** (`4:4:4`). JPEG's default halves colour
resolution, which is fine for a photograph and poor for a hard 2px border with
text on it — the corners came out `#f9fff8` instead of white, a faint halo where
the card meets the email. 4:4:4 costs about 38 KB and lands them exactly.

**A failed encode falls back to the PNG**, and `sharp` is imported *dynamically*
so that even a module that fails to load is caught. These URLs sit in signatures
that are already sent: a route that throws replaces every banner in every inbox
with a broken-image icon. A heavy banner is a far better failure than no banner.

The transparent spacer served when there is no banner stays PNG. Flattening a
1196x1 transparent image to JPEG would paint a visible bar across the signature.

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

### Logo overrides

Settings → Logo swaps the bundled Haveaspot pill for something else — a
sub-brand, or a seasonal mark. Both light and dark can be set, and a logo is
picked from an uploaded library or pasted as a URL, the same as a banner.

**Two rules make or break a replacement, and both are easy to get wrong:**

**Bake the background into the image.** The bundled pill does this for a reason
— Gmail and Outlook impose their own dark mode by inverting CSS backgrounds,
and never touch images. A logo on a transparent background therefore goes
dark-on-dark in their dark themes. This is the same constraint documented under
Icons and logo above, and it applies to anything that replaces the pill.

**Produce it at 148×44 (296×88 for retina).** The signature sets both `width`
and `height` on the logo image, so a mismatched file is **squashed, not
cropped** — a distorted wordmark rather than trimmed edges, which is much
easier to miss. The upload warns about this using the real pill geometry, which
is imported from `signature-html.ts` rather than written down again.

Setting only the light override leaves dark-theme readers on the bundled pill,
which is usually not what anyone intends.

Banners and logos are stored under separate blob prefixes, listed separately,
and the delete guard is per-prefix — so a logo cannot be deleted through the
banner library or vice versa.

### Banner impressions and click-through rate

Every banner render is an image request to `/api/cta`, so the server sees it.
Impressions are counted there and the dashboard divides banner clicks by them.

**Only `theme=light` is counted.** Every signature carries one light banner and,
for everything except Outlook, a hidden dark one beside it that most clients
fetch too. Counting both would double the figure for some clients and not
others; counting light gives one impression per open everywhere.

**The count is aggregated on the way in** — one row per person per campaign per
day, incremented in place. A click is rare and worth keeping in full; a banner
render happens every time anyone opens any email from anyone. Storing that raw
would put a growing insert on the hot path of an image route that has to stay
fast, at a grain nobody would query.

**It is a floor, not a true count of opens.** The image is CDN-cached for five
minutes, and Gmail serves it through its own cache keyed on the URL — which is
identical for every recipient of a given sender. Clients that block images
produce nothing at all. So impressions under-report and any rate derived from
them over-reports.

This is why **a rate over 100% is possible and is not a bug**: one cached view
can stand for many readers, any number of whom can click. The dashboard shows
the real number, flags it, and explains it on hover rather than capping it —
capping would turn a signal about caching into a plausible-looking figure.

Fixing it properly would mean making the banner uncacheable, putting every open
on the render path and losing the property that makes campaigns cheap. Not
worth it. Read the rate against itself over time, not against a published
industry benchmark.

### Campaign performance

A campaign's own page carries its banner views, clicks, click-through rate and
distinct visitors, **over its whole run rather than a rolling window**. The
analytics dashboard is a window onto recent activity; a campaign has its own
start and end, and applying 30 days there would under-report one that ran in the
spring and show nothing at all for one that has finished.

The panel appears only once there is something to show — a campaign that has not
run yet would otherwise open on a row of zeroes, which reads as failure rather
than as "not started".

The rate helper lives in `src/lib/rate.ts` and is shared with the dashboard,
because the caveat matters as much as the arithmetic and two copies of the
explanation would drift.

**Deleting a campaign silently reattributes its history.** The click rows survive
— `ON DELETE SET NULL` — but lose their campaign id, so they fold into the
default banner and the campaign disappears from the performance table. Its
numbers are not lost so much as quietly reassigned. Deactivating rather than
deleting keeps the record intact.

### Deleting analytics history

The analytics dashboard has a danger zone at the bottom with two deletes:
history older than 90 days, and everything. Both are irreversible — there is no
soft delete and no archive.

**Clicks and impressions are deleted together.** Removing one without the other
would leave a click-through rate whose numerator and denominator cover different
spans of time — a number that looks fine and is wrong, which is worse than no
number at all.

Clearing everything requires typing DELETE, and that is **checked on the server
as well as in the browser**, so it is not something a resubmitted form can skip.

The retention cutoff is fixed at 90 days rather than following the 7/30/90
period switch above it. The switch changes what you are looking at; a delete
that followed it would mean the same button removed a different span depending
on a control nobody associates with deleting.

No other table is touched. Every click figure elsewhere in the admin — a staff
member's count, a campaign's performance — is a `count(*)` over these rather
than a stored total, so they all follow automatically and there is no counter
left to drift. Deleting the history does not stop tracking: signatures already
in inboxes keep recording.

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
