ALTER TABLE users ADD COLUMN IF NOT EXISTS paid_rollover_seconds bigint NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS paid_rollover_settled_period_start timestamptz;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_paid_rollover_seconds_check;
ALTER TABLE users ADD CONSTRAINT users_paid_rollover_seconds_check CHECK (paid_rollover_seconds >= 0);
