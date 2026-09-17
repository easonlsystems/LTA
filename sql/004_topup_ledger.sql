CREATE TABLE IF NOT EXISTS paid_unit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('subscription_grant','topup_purchase','topup_refund','admin_adjustment')),
  units_delta integer NOT NULL,
  source_key text NOT NULL UNIQUE,
  provider text,
  provider_reference_id text,
  provider_total_cents integer NOT NULL DEFAULT 0 CHECK (provider_total_cents >= 0),
  provider_refunded_cents integer NOT NULL DEFAULT 0 CHECK (provider_refunded_cents >= 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paid_unit_transactions_user_created_idx ON paid_unit_transactions(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS paid_unit_transactions_provider_ref_idx ON paid_unit_transactions(provider,provider_reference_id);
