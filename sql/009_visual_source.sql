ALTER TABLE transcript_cache DROP CONSTRAINT IF EXISTS transcript_cache_source_check;
ALTER TABLE transcript_cache
  ADD CONSTRAINT transcript_cache_source_check
  CHECK (source IN ('caption','asr','visual','hybrid','post','page'));
