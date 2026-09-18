CREATE TABLE IF NOT EXISTS product_activation_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  platform text,
  distribution_profile text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_activation_events_event_idx
  ON product_activation_events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS product_activation_events_user_idx
  ON product_activation_events(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS product_activation_events_user_milestone_once_idx
  ON product_activation_events(user_id,event_name)
  WHERE event_name IN (
    'connect_cta_click',
    'connection_started',
    'connection_success',
    'connector_enabled',
    'first_link_attempt',
    'first_successful_read'
  );
