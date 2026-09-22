-- Lemon may deliver a refund before its paid-order webhook. Keep the cumulative
-- refund independently of the purchase ledger so the later credit is net of it.
CREATE TABLE IF NOT EXISTS topup_refund_observations (
  order_id text PRIMARY KEY,
  pack text NOT NULL CHECK (pack IN ('500', '1500')),
  user_id text,
  refunded_cents bigint NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
