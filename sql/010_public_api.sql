CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL UNIQUE,
  key_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS api_keys_user_created_idx ON api_keys(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_keys_active_hash_idx ON api_keys(key_hash) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS api_request_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  job_id uuid REFERENCES transcript_jobs(id) ON DELETE SET NULL,
  route text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_request_events_user_created_idx ON api_request_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_request_events_job_idx ON api_request_events(job_id) WHERE job_id IS NOT NULL;
