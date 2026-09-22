-- Completed jobs reference cache rows by id. A refresh must create a new version;
-- updating the old row changes the result of already completed jobs.
ALTER TABLE transcript_cache
  DROP CONSTRAINT IF EXISTS transcript_cache_platform_canonical_media_id_language_key;

CREATE INDEX IF NOT EXISTS transcript_cache_lookup_idx
  ON transcript_cache(platform,canonical_media_id,language,created_at DESC)
  INCLUDE (expires_at);
