CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  plan text NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial','basic','pro')),
  account_status text NOT NULL DEFAULT 'active' CHECK (account_status IN ('active','past_due','canceled','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_eligible boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_salt text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_set_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_bonus_seconds integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_bonus_videos integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS password_auth_attempts (
  id bigserial PRIMARY KEY,
  email_hash text NOT NULL,
  success boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_auth_attempts_recent_idx ON password_auth_attempts(email_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS password_auth_attempts_created_idx ON password_auth_attempts(created_at);

CREATE TABLE IF NOT EXISTS trial_device_claims (
  device_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trial_device_claims_user_idx ON trial_device_claims(user_id);

CREATE TABLE IF NOT EXISTS login_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code_hash text NOT NULL,
  flow_hash text,
  return_to text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE login_codes ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE login_codes ADD COLUMN IF NOT EXISTS flow_hash text;
CREATE INDEX IF NOT EXISTS login_codes_email_idx ON login_codes(email, created_at DESC);

CREATE TABLE IF NOT EXISTS web_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS founder_admin_events (
  id bigserial PRIMARY KEY,
  founder_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS founder_admin_events_target_idx ON founder_admin_events(target_user_id, created_at DESC);


CREATE TABLE IF NOT EXISTS website_visitors (
  visitor_id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  first_path text NOT NULL,
  last_path text NOT NULL,
  page_views integer NOT NULL DEFAULT 0 CHECK (page_views >= 0),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  signed_up_at timestamptz
);
CREATE INDEX IF NOT EXISTS website_visitors_user_idx ON website_visitors(user_id);
CREATE INDEX IF NOT EXISTS website_visitors_last_seen_idx ON website_visitors(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS website_visitors_signed_up_idx ON website_visitors(signed_up_at) WHERE signed_up_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS website_pageviews (
  id bigserial PRIMARY KEY,
  visitor_id uuid NOT NULL REFERENCES website_visitors(visitor_id) ON DELETE CASCADE,
  path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS website_pageviews_created_idx ON website_pageviews(created_at DESC);
CREATE INDEX IF NOT EXISTS website_pageviews_visitor_idx ON website_pageviews(visitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS website_pageviews_path_idx ON website_pageviews(path, created_at DESC);

CREATE TABLE IF NOT EXISTS oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL UNIQUE,
  client_name text NOT NULL,
  redirect_uris jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  resource text NOT NULL,
  scope text NOT NULL DEFAULT 'link2ai:read',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  resource text NOT NULL,
  scope text NOT NULL DEFAULT 'link2ai:read',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  resource text NOT NULL,
  scope text NOT NULL DEFAULT 'link2ai:read',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE oauth_codes ADD COLUMN IF NOT EXISTS resource text;
ALTER TABLE oauth_access_tokens ADD COLUMN IF NOT EXISTS resource text;
ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS resource text;

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'lemonsqueezy',
  provider_subscription_id text NOT NULL UNIQUE,
  plan text NOT NULL CHECK (plan IN ('basic','pro')),
  status text NOT NULL,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_event_at timestamptz;

CREATE TABLE IF NOT EXISTS transcript_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  canonical_media_id text NOT NULL,
  language text NOT NULL DEFAULT 'und',
  title text,
  creator text,
  caption text,
  duration_seconds integer NOT NULL,
  transcript text NOT NULL,
  segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL CHECK (source IN ('caption','asr')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE(platform, canonical_media_id, language)
);
CREATE INDEX IF NOT EXISTS transcript_cache_exp_idx ON transcript_cache(expires_at);

CREATE TABLE IF NOT EXISTS transcript_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform text NOT NULL,
  source_url text NOT NULL,
  normalized_url text NOT NULL,
  canonical_media_id text NOT NULL,
  language text NOT NULL DEFAULT 'auto',
  status text NOT NULL CHECK (status IN ('queued','processing','awaiting_payment','completed','failed')),
  priority integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  duration_seconds integer,
  transcript_cache_id uuid REFERENCES transcript_cache(id) ON DELETE SET NULL,
  error_code text,
  error_message text,
  retryable boolean NOT NULL DEFAULT false,
  checkout_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS transcript_jobs_queue_idx ON transcript_jobs(status, next_attempt_at, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS transcript_jobs_user_idx ON transcript_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transcript_jobs_media_idx ON transcript_jobs(platform, canonical_media_id, status);
-- Prevent duplicate in-flight MCP calls for the exact same normalized URL from charging twice.
CREATE UNIQUE INDEX IF NOT EXISTS transcript_jobs_active_url_unique
  ON transcript_jobs(user_id, platform, normalized_url)
  WHERE status IN ('queued','processing','awaiting_payment');
-- Keep job/account history while allowing the actual transcript cache to be physically deleted after its TTL.
ALTER TABLE transcript_jobs DROP CONSTRAINT IF EXISTS transcript_jobs_transcript_cache_id_fkey;
ALTER TABLE transcript_jobs ADD CONSTRAINT transcript_jobs_transcript_cache_id_fkey
  FOREIGN KEY (transcript_cache_id) REFERENCES transcript_cache(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS usage_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL UNIQUE REFERENCES transcript_jobs(id) ON DELETE CASCADE,
  seconds integer NOT NULL CHECK (seconds >= 0),
  videos integer NOT NULL DEFAULT 1 CHECK (videos >= 0),
  billing_period_start date,
  billing_period_end date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_ledger_user_idx ON usage_ledger(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS quota_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL UNIQUE REFERENCES transcript_jobs(id) ON DELETE CASCADE,
  seconds integer NOT NULL CHECK (seconds >= 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quota_reservations_user_idx ON quota_reservations(user_id, expires_at);

CREATE TABLE IF NOT EXISTS billing_resume_intents (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES transcript_jobs(id) ON DELETE CASCADE,
  target_plan text NOT NULL CHECK (target_plan IN ('basic','pro')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media_processing_claims (
  platform text NOT NULL,
  canonical_media_id text NOT NULL,
  language text NOT NULL DEFAULT 'auto',
  job_id uuid NOT NULL REFERENCES transcript_jobs(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(platform, canonical_media_id, language)
);
CREATE INDEX IF NOT EXISTS media_processing_claims_exp_idx ON media_processing_claims(expires_at);
