-- Google OpenID Connect account identity and short-lived login flow state.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub text;

CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique_idx
  ON users(google_sub)
  WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS google_oauth_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  code_verifier text NOT NULL,
  return_to text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS google_oauth_flows_expiry_idx
  ON google_oauth_flows(expires_at);
