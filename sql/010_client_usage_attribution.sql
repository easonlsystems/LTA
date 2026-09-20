ALTER TABLE transcript_jobs
  ADD COLUMN IF NOT EXISTS client_source text NOT NULL DEFAULT 'legacy';

CREATE INDEX IF NOT EXISTS transcript_jobs_client_source_idx
  ON transcript_jobs(client_source, created_at DESC);

CREATE TABLE IF NOT EXISTS source_access_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES transcript_jobs(id) ON DELETE SET NULL,
  platform text NOT NULL,
  client_source text NOT NULL,
  reused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS source_access_events_user_idx
  ON source_access_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS source_access_events_client_idx
  ON source_access_events(client_source, created_at DESC);
