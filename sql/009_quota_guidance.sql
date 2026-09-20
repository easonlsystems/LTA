ALTER TABLE transcript_jobs
  ADD COLUMN IF NOT EXISTS required_usage_units integer;

ALTER TABLE transcript_jobs
  DROP CONSTRAINT IF EXISTS transcript_jobs_required_usage_units_check;

ALTER TABLE transcript_jobs
  ADD CONSTRAINT transcript_jobs_required_usage_units_check
  CHECK (required_usage_units IS NULL OR required_usage_units >= 0);
