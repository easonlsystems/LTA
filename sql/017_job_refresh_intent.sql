-- Preserve a caller's explicit refresh request across API/worker process boundaries.
ALTER TABLE transcript_jobs ADD COLUMN IF NOT EXISTS force_refresh boolean NOT NULL DEFAULT false;
