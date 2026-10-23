-- ===== Drivers & deliveries =====
CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','approved','suspended','rejected')),
  phone text NOT NULL,
  vehicle text,
  licence_verified boolean NOT NULL DEFAULT false,
  background_check_verified boolean NOT NULL DEFAULT false,
  is_available boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_driver_fk FOREIGN KEY (driver_id) REFERENCES drivers(id);
ALTER TABLE payouts ADD CONSTRAINT payouts_driver_fk FOREIGN KEY (driver_id) REFERENCES drivers(id);

CREATE TABLE deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suborder_id uuid NOT NULL UNIQUE REFERENCES suborders(id),
  driver_id uuid REFERENCES drivers(id),
  status text NOT NULL DEFAULT 'unassigned' CHECK (status IN ('unassigned','assigned','picked_up','delivered','failed')),
  handover_code text NOT NULL,
  pickup jsonb NOT NULL, dropoff jsonb NOT NULL,
  instructions text,
  earning_cents int NOT NULL DEFAULT 0,
  assigned_at timestamptz, picked_up_at timestamptz, delivered_at timestamptz,
  completion_note text,
  code_bypassed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deliveries_driver ON deliveries(driver_id, status);
CREATE TABLE delivery_events (
  id bigserial PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES deliveries(id),
  type text NOT NULL CHECK (type IN ('created','assigned','unassigned','picked_up','delivered','failed','issue')),
  actor_user_id uuid REFERENCES users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE driver_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id),
  delivery_id uuid NOT NULL UNIQUE REFERENCES deliveries(id),
  amount_cents int NOT NULL CHECK (amount_cents >= 0),
  payout_id uuid REFERENCES payouts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== Support =====
CREATE TABLE support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  vendor_id uuid REFERENCES vendors(id),
  suborder_id uuid REFERENCES suborders(id),
  kind text NOT NULL CHECK (kind IN ('customer','vendor','driver')),
  category text NOT NULL CHECK (category IN ('missing_item','incorrect_item','damaged_item','substituted_item','late_order','payment','other')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved','closed')),
  subject text NOT NULL,
  affected_lines jsonb NOT NULL DEFAULT '[]',
  assigned_to uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ticket_messages (
  id bigserial PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES users(id),
  body text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE refunds ADD COLUMN ticket_id uuid REFERENCES support_tickets(id);

-- ===== Reviews (verified purchases only) & favourites =====
CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  suborder_id uuid NOT NULL REFERENCES suborders(id),
  store_id uuid NOT NULL REFERENCES stores(id),
  product_id uuid REFERENCES products(id),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text,
  is_hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX reviews_once ON reviews(suborder_id, COALESCE(product_id, '00000000-0000-0000-0000-000000000000'));
CREATE TABLE favourites (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

-- ===== Notifications outbox =====
CREATE TABLE notification_templates (
  key text PRIMARY KEY,
  subject text NOT NULL,
  body text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notifications (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  to_email text NOT NULL,
  template text NOT NULL,
  vars jsonb NOT NULL DEFAULT '{}',
  subject text NOT NULL, body text NOT NULL,
  transactional boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempts int NOT NULL DEFAULT 0, error text,
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);
CREATE INDEX notifications_pending ON notifications(id) WHERE status = 'pending';

-- ===== Vendor tooling =====
CREATE TABLE import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  created_by uuid REFERENCES users(id),
  total_rows int NOT NULL, succeeded int NOT NULL, failed int NOT NULL,
  errors jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE product_images ADD COLUMN uploaded_by uuid REFERENCES users(id);

-- ===== Content =====
CREATE TABLE pages (
  slug text PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published')),
  needs_legal_review boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE content_blocks (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ===== Analytics (first-party, no third-party trackers) =====
CREATE TABLE analytics_events (
  id bigserial PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('product_view','add_to_cart','checkout_started','order_paid')),
  user_id uuid, session_id text,
  product_id uuid, store_id uuid, order_id uuid,
  utm_source text, utm_campaign text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_type_time ON analytics_events(type, created_at);

-- ===== Advertising =====
CREATE TABLE ad_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  store_id uuid REFERENCES stores(id),
  product_id uuid REFERENCES products(id),
  placement text NOT NULL CHECK (placement IN ('home_banner','region_banner','search_sponsored','sponsored_store')),
  region_id uuid REFERENCES regions(id),
  title text NOT NULL, body text, image_url text,
  cpc_cents int NOT NULL CHECK (cpc_cents > 0),
  budget_cents int NOT NULL CHECK (budget_cents > 0),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paused')),
  reviewed_by uuid REFERENCES users(id), review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE TABLE ad_events (
  id bigserial PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES ad_campaigns(id),
  type text NOT NULL CHECK (type IN ('impression','click')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ad_events_campaign ON ad_events(campaign_id, type);

-- ===== Recipes =====
CREATE TABLE recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE, title text NOT NULL, summary text,
  region_id uuid REFERENCES regions(id), country_id uuid REFERENCES countries(id),
  servings int NOT NULL CHECK (servings > 0), prep_minutes int, cook_minutes int,
  steps jsonb NOT NULL DEFAULT '[]',
  food_safety_note text,
  ai_generated boolean NOT NULL DEFAULT false,
  reviewed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE recipe_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  label text NOT NULL, quantity_text text,
  product_id uuid REFERENCES products(id),
  optional boolean NOT NULL DEFAULT false
);
-- Curated alternatives only; we never infer substitutions.
CREATE TABLE recipe_ingredient_alternatives (
  recipe_ingredient_id uuid NOT NULL REFERENCES recipe_ingredients(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  note text,
  PRIMARY KEY (recipe_ingredient_id, product_id)
);

-- ===== Vendor sales CRM (internal) =====
CREATE TABLE vendor_prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL, contact_name text, phone text, email text, address text,
  regions text[] NOT NULL DEFAULT '{}',
  source text,
  stage text NOT NULL DEFAULT 'identified' CHECK (stage IN ('identified','contacted','demo','onboarding','launched','lost')),
  next_action text, next_action_at timestamptz, last_contact_at timestamptz,
  vendor_id uuid REFERENCES vendors(id),
  owner_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), launched_at timestamptz
);
CREATE TABLE prospect_activities (
  id bigserial PRIMARY KEY,
  prospect_id uuid NOT NULL REFERENCES vendor_prospects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('call','visit','email','demo','note','stage_change')),
  note text NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings(key, value) VALUES ('driver.handover_code_length', '4');
