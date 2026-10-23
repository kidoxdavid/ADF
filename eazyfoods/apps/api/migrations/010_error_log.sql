-- First-party error log so unexpected failures are visible in the admin console even without an external monitor.
CREATE TABLE error_events (
  id bigserial PRIMARY KEY,
  message text NOT NULL,
  stack text,
  method text, url text, request_id text, user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX error_events_time ON error_events(created_at DESC);
