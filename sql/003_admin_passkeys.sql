CREATE TABLE IF NOT EXISTS founder_passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports text[] NOT NULL DEFAULT ARRAY[]::text[],
  device_name text NOT NULL DEFAULT 'Trusted device',
  device_type text,
  backed_up boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS founder_passkeys_founder_idx ON founder_passkeys(founder_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS founder_passkeys_active_idx ON founder_passkeys(founder_user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS founder_webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  browser_session_hash text NOT NULL,
  ceremony text NOT NULL CHECK (ceremony IN ('registration','authentication')),
  challenge text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS founder_webauthn_challenge_lookup_idx ON founder_webauthn_challenges(founder_user_id,browser_session_hash,ceremony,created_at DESC);
CREATE INDEX IF NOT EXISTS founder_webauthn_challenge_expiry_idx ON founder_webauthn_challenges(expires_at);

CREATE TABLE IF NOT EXISTS founder_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id text NOT NULL,
  code_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS founder_recovery_codes_founder_idx ON founder_recovery_codes(founder_user_id,created_at DESC);

-- Once a Founder passkey exists, email OTP can no longer unlock the admin surface.
-- The first passkey is bootstrapped with the existing email step-up; after that,
-- passkeys or one-time recovery codes are the only Founder unlock methods.
CREATE OR REPLACE FUNCTION block_founder_email_stepup_after_passkey()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM founder_passkeys
    WHERE founder_user_id=NEW.founder_user_id AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Founder email step-up disabled after passkey enrollment' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS founder_stepup_block_email_after_passkey ON founder_stepup_codes;
CREATE TRIGGER founder_stepup_block_email_after_passkey
BEFORE INSERT ON founder_stepup_codes
FOR EACH ROW EXECUTE FUNCTION block_founder_email_stepup_after_passkey();

-- Add a SHA-256 hash chain to Founder account-change events. The migration runner
-- deliberately replays ordered SQL files on every deploy, so temporarily remove the
-- append-only guards inside this transaction before any one-time backfill. They are
-- recreated below before commit; a failed migration rolls this DDL back atomically.
ALTER TABLE founder_admin_events ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE founder_admin_events ADD COLUMN IF NOT EXISTS event_hash text;
DROP TRIGGER IF EXISTS founder_admin_events_append_only ON founder_admin_events;
DROP TRIGGER IF EXISTS founder_security_events_append_only ON founder_security_events;

DO $$
DECLARE
  r record;
  prior text := repeat('0',64);
  h text;
BEGIN
  FOR r IN
    SELECT id,founder_user_id,target_user_id,action,before_state,after_state,created_at,event_hash
    FROM founder_admin_events ORDER BY id
  LOOP
    IF r.event_hash IS NOT NULL THEN
      prior := r.event_hash;
    ELSE
      h := encode(digest(
        concat_ws('|',prior,r.id::text,r.founder_user_id::text,r.target_user_id::text,r.action,coalesce(r.before_state::text,''),coalesce(r.after_state::text,''),r.created_at::text),
        'sha256'
      ),'hex');
      UPDATE founder_admin_events SET prev_hash=prior,event_hash=h WHERE id=r.id;
      prior := h;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION chain_founder_admin_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prior text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('link2ai:founder-admin-event-chain'));
  SELECT event_hash INTO prior FROM founder_admin_events WHERE event_hash IS NOT NULL ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := COALESCE(prior,repeat('0',64));
  NEW.event_hash := encode(digest(
    concat_ws('|',NEW.prev_hash,NEW.id::text,NEW.founder_user_id::text,NEW.target_user_id::text,NEW.action,coalesce(NEW.before_state::text,''),coalesce(NEW.after_state::text,''),NEW.created_at::text),
    'sha256'
  ),'hex');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS founder_admin_events_hash_chain ON founder_admin_events;
CREATE TRIGGER founder_admin_events_hash_chain
BEFORE INSERT ON founder_admin_events
FOR EACH ROW EXECUTE FUNCTION chain_founder_admin_event();

-- Make Founder audit history append-only at the application database layer.
-- This does not replace an independent immutable backup, but it prevents ordinary
-- UPDATE/DELETE paths from silently rewriting security-sensitive history.
CREATE OR REPLACE FUNCTION reject_founder_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Founder audit history is append-only' USING ERRCODE='42501';
END;
$$;
CREATE TRIGGER founder_admin_events_append_only
BEFORE UPDATE OR DELETE ON founder_admin_events
FOR EACH ROW EXECUTE FUNCTION reject_founder_audit_mutation();
CREATE TRIGGER founder_security_events_append_only
BEFORE UPDATE OR DELETE ON founder_security_events
FOR EACH ROW EXECUTE FUNCTION reject_founder_audit_mutation();
