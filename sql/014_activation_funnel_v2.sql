ALTER TABLE website_visitors
  ADD COLUMN IF NOT EXISTS utm_content text;

ALTER TABLE website_events
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content text;

CREATE INDEX IF NOT EXISTS website_events_campaign_idx
  ON website_events(utm_source,utm_campaign,utm_content,created_at DESC);

ALTER TABLE product_activation_events
  ADD COLUMN IF NOT EXISTS visitor_id uuid,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content text;

CREATE INDEX IF NOT EXISTS product_activation_events_campaign_idx
  ON product_activation_events(utm_source, utm_campaign, utm_content, created_at DESC);

ALTER TABLE source_access_events
  ALTER COLUMN platform DROP NOT NULL;

ALTER TABLE source_access_events
  ADD COLUMN IF NOT EXISTS source_domain text,
  ADD COLUMN IF NOT EXISTS source_key text,
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'requested',
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS processing_time_ms bigint,
  ADD COLUMN IF NOT EXISTS cache_hit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS units_charged integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS units_refunded integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz;

CREATE INDEX IF NOT EXISTS source_access_events_job_outcome_idx
  ON source_access_events(job_id, outcome, created_at DESC);

CREATE INDEX IF NOT EXISTS source_access_events_source_key_idx
  ON source_access_events(user_id, source_key, created_at DESC)
  WHERE source_key IS NOT NULL;

ALTER TABLE transcript_jobs
  ADD COLUMN IF NOT EXISTS analytics_cache_hit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS analytics_reserved_usage_units integer NOT NULL DEFAULT 0;

ALTER TABLE transcript_jobs
  DROP CONSTRAINT IF EXISTS transcript_jobs_analytics_reserved_usage_units_check;

ALTER TABLE transcript_jobs
  ADD CONSTRAINT transcript_jobs_analytics_reserved_usage_units_check
  CHECK (analytics_reserved_usage_units >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS product_activation_events_user_activation_v2_once_idx
  ON product_activation_events(user_id,event_name)
  WHERE event_name IN (
    'add_lta_click',
    'oauth_start',
    'oauth_success',
    'connector_connected',
    'first_read_success',
    'second_read_success'
  );

CREATE UNIQUE INDEX IF NOT EXISTS website_events_visitor_activation_v2_once_idx
  ON website_events(visitor_id,event_name)
  WHERE event_name IN ('oauth_success','connector_connected');
