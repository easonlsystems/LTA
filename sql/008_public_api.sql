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

CREATE INDEX IF NOT EXISTS api_keys_user_created_idx
  ON api_keys(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS api_keys_active_hash_idx
  ON api_keys(key_hash)
  WHERE revoked_at IS NULL;
