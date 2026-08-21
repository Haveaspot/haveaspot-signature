-- =============================================================================
-- HAS-Signature schema
--
-- Replaces the WordPress side of the original plugin:
--   settlin_signature  (CPT + postmeta) -> signatures
--   settlin_department (taxonomy)       -> departments + signature_departments
--   settlin_campaigns  (CPT + postmeta) -> campaigns + campaign_targets
--   wp_mech_sig_clicks (custom table)   -> clicks
--   wp_options (mech_sig_*)             -> settings
--
-- Everything postmeta stored as loose key/value strings is a real typed column
-- here, which is the main win of moving off WordPress.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Global settings — the old `get_option('mech_sig_*')` calls.
-- Single-row-per-key so the admin UI can edit them without a migration.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key         text PRIMARY KEY,
  value       text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Departments (was the settlin_department taxonomy)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
  id    serial PRIMARY KEY,
  name  text NOT NULL,
  slug  text NOT NULL UNIQUE
);

-- -----------------------------------------------------------------------------
-- Signatures — one row per employee. `email` is the natural key: the PHP looked
-- users up by the sig_email meta value everywhere, so it gets a UNIQUE index
-- rather than the "newest post wins" ordering hack the plugin relied on.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS signatures (
  id                serial PRIMARY KEY,
  email             text NOT NULL UNIQUE,
  first_name        text NOT NULL DEFAULT '',
  last_name         text NOT NULL DEFAULT '',
  job_title         text NOT NULL DEFAULT '',
  mobile            text NOT NULL DEFAULT '',
  office            text NOT NULL DEFAULT '',

  -- Per-user overrides (was sig_* postmeta)
  disable_cta       boolean NOT NULL DEFAULT false,
  disable_promo     boolean NOT NULL DEFAULT false,
  promo_only_mode   boolean NOT NULL DEFAULT false,
  cta_heading       text NOT NULL DEFAULT '',
  cta_link          text NOT NULL DEFAULT '',
  btn_text          text NOT NULL DEFAULT '',
  promo_image_url   text NOT NULL DEFAULT '',

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signature_departments (
  signature_id   integer NOT NULL REFERENCES signatures(id) ON DELETE CASCADE,
  department_id  integer NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (signature_id, department_id)
);

-- -----------------------------------------------------------------------------
-- Campaigns — time-windowed overrides of the CTA block.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
  id               serial PRIMARY KEY,
  name             text NOT NULL,

  starts_at        timestamptz,
  ends_at          timestamptz,
  is_deactivated   boolean NOT NULL DEFAULT false,

  -- Creative (was camp_* postmeta)
  cta_heading      text NOT NULL DEFAULT '',
  cta_link         text NOT NULL DEFAULT '',
  btn_text         text NOT NULL DEFAULT '',
  promo_image_url  text NOT NULL DEFAULT '',
  promo_only_mode  boolean NOT NULL DEFAULT false,

  -- Targeting: when true, every signature matches and the target rows below
  -- are ignored (was camp_target_all).
  target_all       boolean NOT NULL DEFAULT false,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Targets are a single polymorphic table rather than the plugin's two separate
-- serialised meta arrays (camp_target_individuals / camp_target_departments).
CREATE TABLE IF NOT EXISTS campaign_targets (
  campaign_id    integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  signature_id   integer REFERENCES signatures(id) ON DELETE CASCADE,
  department_id  integer REFERENCES departments(id) ON DELETE CASCADE,

  -- Exactly one of the two must be set.
  CONSTRAINT campaign_target_one_of CHECK (
    (signature_id IS NOT NULL AND department_id IS NULL) OR
    (signature_id IS NULL AND department_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS campaign_targets_campaign_idx
  ON campaign_targets (campaign_id);

-- Hot path: "which campaigns are live right now?" runs on every image render.
CREATE INDEX IF NOT EXISTS campaigns_window_idx
  ON campaigns (starts_at, ends_at)
  WHERE is_deactivated = false;

-- -----------------------------------------------------------------------------
-- Click analytics (was wp_mech_sig_clicks)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clicks (
  id             bigserial PRIMARY KEY,
  clicked_at     timestamptz NOT NULL DEFAULT now(),

  sender_email   text NOT NULL,
  signature_id   integer REFERENCES signatures(id) ON DELETE SET NULL,
  department_id  integer REFERENCES departments(id) ON DELETE SET NULL,
  campaign_id    integer REFERENCES campaigns(id) ON DELETE SET NULL,

  -- 'cta_default' | 'cta_campaign' | 'vcard' | 'website' | 'mail' | 'linkedin'
  asset_type     text NOT NULL,

  device_type    text NOT NULL DEFAULT 'Desktop',
  os_platform    text NOT NULL DEFAULT 'Unknown',
  email_client   text NOT NULL DEFAULT 'Unknown',
  country_code   text NOT NULL DEFAULT '??',

  -- Salted SHA-256 of the IP. Never store the raw address.
  visitor_hash   text NOT NULL DEFAULT ''
);

-- -----------------------------------------------------------------------------
-- Admin login throttling
--
-- The admin area is behind a single shared password, which is guessable given
-- unlimited attempts. Failures are counted per address here rather than in
-- memory because serverless invocations share no state — an in-process counter
-- would reset on every cold start and protect nothing.
--
-- Only a salted hash of the address is stored, never the address itself.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id            bigserial PRIMARY KEY,
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  ip_hash       text NOT NULL,
  succeeded     boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS admin_login_attempts_lookup_idx
  ON admin_login_attempts (ip_hash, attempted_at DESC)
  WHERE succeeded = false;

-- -----------------------------------------------------------------------------
-- Generator throttling
--
-- /api/sync is public and writes to the CRM. The honeypot and the domain guard
-- stop casual abuse, but neither limits volume, so a script that knows the
-- domain could fill the staff table with junk records.
--
-- Counted per address, as a salted hash — the raw IP is never stored, matching
-- how clicks are recorded.
--
-- The limit has to survive a whole office generating signatures on rollout day
-- from behind one NAT address, so it is deliberately generous: this exists to
-- stop automated abuse, not to ration ordinary use.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_attempts (
  id            bigserial PRIMARY KEY,
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  ip_hash       text NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_attempts_lookup_idx
  ON sync_attempts (ip_hash, attempted_at DESC);

CREATE INDEX IF NOT EXISTS clicks_time_idx ON clicks (clicked_at DESC);
CREATE INDEX IF NOT EXISTS clicks_sender_idx ON clicks (sender_email);
CREATE INDEX IF NOT EXISTS clicks_campaign_idx ON clicks (campaign_id);
