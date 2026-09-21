ALTER TABLE transcript_cache
  ADD COLUMN IF NOT EXISTS visual_assets jsonb NOT NULL DEFAULT '[]'::jsonb;
