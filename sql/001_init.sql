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


-- 2026-09-15: one-time historical website analytics backfill from Railway HTTP logs.
-- Raw IP addresses and user-agent strings are NOT stored in this database.
-- Historical unique visitors were estimated offline and imported only as anonymous synthetic UUIDs.
ALTER TABLE website_visitors
  ADD COLUMN IF NOT EXISTS analytics_source text NOT NULL DEFAULT 'live';

ALTER TABLE website_pageviews
  ADD COLUMN IF NOT EXISTS source_key text;

CREATE UNIQUE INDEX IF NOT EXISTS website_pageviews_source_key_idx
  ON website_pageviews(source_key)
  WHERE source_key IS NOT NULL;

WITH historical_visitors(
  visitor_id,user_id,first_path,last_path,page_views,first_seen_at,last_seen_at,analytics_source
) AS (
VALUES
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, (SELECT id FROM users WHERE lower(email)=lower('easonlsy1019@gmail.com') LIMIT 1), '/connect', '/', 25, '2026-09-14T01:17:54.310270689Z'::timestamptz, '2026-09-15T02:03:20.780646534Z'::timestamptz, 'historical_backfill'),
  ('37f9202a-d1ee-53e5-9052-cf16e2d69440'::uuid, NULL, '/', '/', 2, '2026-09-14T03:39:49.526071768Z'::timestamptz, '2026-09-14T03:39:49.819130638Z'::timestamptz, 'historical_backfill'),
  ('d6932752-41d4-5b5e-a909-96a885ddc61b'::uuid, NULL, '/signup', '/signup', 1, '2026-09-14T19:22:07.401300272Z'::timestamptz, '2026-09-14T19:22:07.401300272Z'::timestamptz, 'historical_backfill'),
  ('a423a640-b984-595f-a3a8-afbd247e4230'::uuid, NULL, '/signup', '/signup', 1, '2026-09-14T19:22:28.085734603Z'::timestamptz, '2026-09-14T19:22:28.085734603Z'::timestamptz, 'historical_backfill'),
  ('571ba86e-c781-5139-a941-9f6bd534868c'::uuid, NULL, '/', '/', 1, '2026-09-14T20:02:28.621171719Z'::timestamptz, '2026-09-14T20:02:28.621171719Z'::timestamptz, 'historical_backfill'),
  ('c7226601-ad0d-5408-b168-49c615acf423'::uuid, NULL, '/', '/', 1, '2026-09-15T00:11:12.230202328Z'::timestamptz, '2026-09-15T00:11:12.230202328Z'::timestamptz, 'historical_backfill'),
  ('00708e4e-4a82-5a65-ac38-0cb875336595'::uuid, NULL, '/', '/', 1, '2026-09-15T00:11:43.490754516Z'::timestamptz, '2026-09-15T00:11:43.490754516Z'::timestamptz, 'historical_backfill'),
  ('9ccff801-d85b-5d54-a5c1-b32c8909416f'::uuid, NULL, '/connect', '/connect', 1, '2026-09-15T00:32:32.263038131Z'::timestamptz, '2026-09-15T00:32:32.263038131Z'::timestamptz, 'historical_backfill')
)
INSERT INTO website_visitors(
  visitor_id,user_id,first_path,last_path,page_views,first_seen_at,last_seen_at,analytics_source
)
SELECT visitor_id,user_id,first_path,last_path,page_views,first_seen_at,last_seen_at,analytics_source
FROM historical_visitors
ON CONFLICT(visitor_id) DO UPDATE SET
  user_id=COALESCE(website_visitors.user_id,EXCLUDED.user_id),
  first_path=CASE WHEN EXCLUDED.first_seen_at < website_visitors.first_seen_at THEN EXCLUDED.first_path ELSE website_visitors.first_path END,
  last_path=CASE WHEN EXCLUDED.last_seen_at > website_visitors.last_seen_at THEN EXCLUDED.last_path ELSE website_visitors.last_path END,
  page_views=GREATEST(website_visitors.page_views,EXCLUDED.page_views),
  first_seen_at=LEAST(website_visitors.first_seen_at,EXCLUDED.first_seen_at),
  last_seen_at=GREATEST(website_visitors.last_seen_at,EXCLUDED.last_seen_at),
  analytics_source=CASE
    WHEN website_visitors.analytics_source='live' THEN 'live'
    ELSE EXCLUDED.analytics_source
  END;

WITH historical_pageviews(visitor_id,path,created_at,source_key) AS (
VALUES
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/connect', '2026-09-14T01:17:54.310270689Z'::timestamptz, 'railway-historical:05310e1b9a5d066baede9509d3ef2ed1'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/login', '2026-09-14T01:18:05.773531715Z'::timestamptz, 'railway-historical:2bba6265176fcd79f7919bef5451f299'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/connect', '2026-09-14T01:18:36.274716253Z'::timestamptz, 'railway-historical:be403bf7823c04028453a66d2ec83e43'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/login', '2026-09-14T01:18:43.775250724Z'::timestamptz, 'railway-historical:2048ca05d1eaf91f1ed81ccea6375c38'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/connect', '2026-09-14T01:19:06.234053592Z'::timestamptz, 'railway-historical:431e46656b2d7cc190e7722ce1fc6a80'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/pricing', '2026-09-14T17:41:02.872132565Z'::timestamptz, 'railway-historical:6f0dbd54e24ce5fe7bb306151f7c53a1'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/', '2026-09-14T18:33:08.140143593Z'::timestamptz, 'railway-historical:1be25a2e5e947e74e1937cfb392d1ea4'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/connect', '2026-09-14T18:33:26.009676873Z'::timestamptz, 'railway-historical:c339d76c7041f22709eb6f900792b21b'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/connect', '2026-09-14T18:41:39.895698991Z'::timestamptz, 'railway-historical:c320895331e913231e7e96491fd75fae'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/connect', '2026-09-14T18:49:05.976171415Z'::timestamptz, 'railway-historical:737c7e7b6bd3f7801fce84aa20a82b6b'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/', '2026-09-14T19:13:19.841501296Z'::timestamptz, 'railway-historical:5d6c41046959934408d7415588120b63'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/connect', '2026-09-14T19:13:24.707723818Z'::timestamptz, 'railway-historical:8c87a79bfcebab973648ac612b6f2b0f'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/login', '2026-09-14T19:14:07.863608781Z'::timestamptz, 'railway-historical:0e3a8ec3ec4c97c22264fae7618890a3'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/login', '2026-09-14T19:14:36.306351351Z'::timestamptz, 'railway-historical:d7fe1520dc7976fcda2fc721047d1702'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/signup', '2026-09-14T19:22:03.206378154Z'::timestamptz, 'railway-historical:c3d0422fca2959b2913acbf71b359dce'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/', '2026-09-14T19:41:27.633340549Z'::timestamptz, 'railway-historical:15de41d82a41d76e992afe4d02d68ec8'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/', '2026-09-14T20:01:04.617149707Z'::timestamptz, 'railway-historical:4aaecbfdc9beaa481c53ce0aeaa3900e'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/connect', '2026-09-14T20:01:13.112967382Z'::timestamptz, 'railway-historical:4639f74ec2b93efbdfc960fc9b1b6d5c'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/', '2026-09-15T00:11:05.773674742Z'::timestamptz, 'railway-historical:14f0151e1f64b7b9dfdf9af8e5c1d56f'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/', '2026-09-15T00:11:14.615016298Z'::timestamptz, 'railway-historical:c9bd93b3b6e4b7d977c09adfee6e05ca'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/', '2026-09-15T00:11:18.084896709Z'::timestamptz, 'railway-historical:b12a93f481c09ff6257defd6ac85600e'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/', '2026-09-15T00:32:06.039368002Z'::timestamptz, 'railway-historical:860c3187fa6e8e59842ae26fe1a21b7b'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/', '2026-09-15T00:32:13.268646327Z'::timestamptz, 'railway-historical:c0d32fb380463da4baf464f7408ec169'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/connect', '2026-09-15T00:32:15.560718097Z'::timestamptz, 'railway-historical:82dd501a4919394c2e70a01e9f51202c'),
  ('b9d87030-b434-5777-88cc-9ceeffd59d92'::uuid, '/', '2026-09-15T02:03:20.780646534Z'::timestamptz, 'railway-historical:734971fa6ff96fa50cba9a17a7787b03'),
  ('37f9202a-d1ee-53e5-9052-cf16e2d69440'::uuid, '/', '2026-09-14T03:39:49.526071768Z'::timestamptz, 'railway-historical:48b88a98259c23fe5d7290226a500fea'),
  ('37f9202a-d1ee-53e5-9052-cf16e2d69440'::uuid, '/', '2026-09-14T03:39:49.819130638Z'::timestamptz, 'railway-historical:05dcc501fc851aaffad13ff996593b50'),
  ('d6932752-41d4-5b5e-a909-96a885ddc61b'::uuid, '/signup', '2026-09-14T19:22:07.401300272Z'::timestamptz, 'railway-historical:d4f27839cea8e18b91152f7f10ccb265'),
  ('a423a640-b984-595f-a3a8-afbd247e4230'::uuid, '/signup', '2026-09-14T19:22:28.085734603Z'::timestamptz, 'railway-historical:829272d776a02018b0b719f0f898b4f2'),
  ('571ba86e-c781-5139-a941-9f6bd534868c'::uuid, '/', '2026-09-14T20:02:28.621171719Z'::timestamptz, 'railway-historical:1e5f37423d28718f78813bc8202d8dbc'),
  ('c7226601-ad0d-5408-b168-49c615acf423'::uuid, '/', '2026-09-15T00:11:12.230202328Z'::timestamptz, 'railway-historical:3c270ce24c86f174beaf9abe5db3a78a'),
  ('00708e4e-4a82-5a65-ac38-0cb875336595'::uuid, '/', '2026-09-15T00:11:43.490754516Z'::timestamptz, 'railway-historical:d0be479c6f714310d33e9d4a36e6ff14'),
  ('9ccff801-d85b-5d54-a5c1-b32c8909416f'::uuid, '/connect', '2026-09-15T00:32:32.263038131Z'::timestamptz, 'railway-historical:4c649f1f37edb528c45b34cb31c3de2a')
)
INSERT INTO website_pageviews(visitor_id,path,created_at,source_key)
SELECT visitor_id,path,created_at,source_key
FROM historical_pageviews
ON CONFLICT DO NOTHING;
