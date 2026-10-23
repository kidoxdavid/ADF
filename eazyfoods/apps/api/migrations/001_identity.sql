CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  phone         text,
  email_verified_at timestamptz,
  disabled_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- A user may hold several roles. Vendor roles are scoped to one vendor.
CREATE TABLE user_roles (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      text NOT NULL CHECK (role IN ('customer','vendor_owner','vendor_staff','driver','admin','support','finance')),
  vendor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role IN ('vendor_owner','vendor_staff')) = (vendor_id IS NOT NULL))
);
CREATE UNIQUE INDEX user_roles_unique ON user_roles (user_id, role, COALESCE(vendor_id, '00000000-0000-0000-0000-000000000000'));

CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Append-only record of consequential actions.
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id),
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity ON audit_log(entity_type, entity_id);

-- Configurable commercial rules (currency, tax, fees...). Values are JSON; every change is audited by the API.
CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
