ALTER TABLE transcript_jobs ADD COLUMN IF NOT EXISTS error_cause_code text;
ALTER TABLE transcript_cache ADD COLUMN IF NOT EXISTS media_validated boolean NOT NULL DEFAULT false;
