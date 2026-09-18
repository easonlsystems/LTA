CREATE TABLE IF NOT EXISTS provider_health_hourly (
  bucket_start timestamptz NOT NULL,
  platform text NOT NULL,
  operation text NOT NULL,
  provider text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  successes integer NOT NULL DEFAULT 0 CHECK (successes >= 0),
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  retryable_failures integer NOT NULL DEFAULT 0 CHECK (retryable_failures >= 0),
  total_duration_ms bigint NOT NULL DEFAULT 0 CHECK (total_duration_ms >= 0),
  last_error_code text,
  last_cause_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(bucket_start,platform,operation,provider)
);

CREATE INDEX IF NOT EXISTS provider_health_hourly_bucket_idx
  ON provider_health_hourly(bucket_start DESC);
CREATE INDEX IF NOT EXISTS provider_health_hourly_provider_idx
  ON provider_health_hourly(provider,platform,operation,bucket_start DESC);
