ALTER TABLE transcript_jobs ADD COLUMN IF NOT EXISTS worker_region text;
ALTER TABLE transcript_jobs ADD COLUMN IF NOT EXISTS worker_release text;
ALTER TABLE transcript_jobs ADD COLUMN IF NOT EXISTS worker_deployment_id text;

CREATE INDEX IF NOT EXISTS transcript_jobs_worker_release_idx
  ON transcript_jobs(worker_release, created_at DESC)
  WHERE worker_release IS NOT NULL;
