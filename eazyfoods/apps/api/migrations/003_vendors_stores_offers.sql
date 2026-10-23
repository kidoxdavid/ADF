CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','suspended')),
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_roles ADD CONSTRAINT user_roles_vendor_fk FOREIGN KEY (vendor_id) REFERENCES vendors(id);

CREATE TABLE stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  address_line text,
  city text NOT NULL DEFAULT 'Calgary',
  province text NOT NULL DEFAULT 'AB',
  postal_code text,
  lat numeric(9,6),
  lng numeric(9,6),
  phone text,
  timezone text NOT NULL DEFAULT 'America/Edmonton',
  min_order_cents int CHECK (min_order_cents >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','published','suspended')),
  is_test_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stores_vendor ON stores(vendor_id);

CREATE TABLE store_regions (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  region_id uuid NOT NULL REFERENCES regions(id),
  PRIMARY KEY (store_id, region_id)
);

CREATE TABLE store_hours (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  dow smallint NOT NULL CHECK (dow BETWEEN 0 AND 6), -- 0 = Sunday
  opens time NOT NULL,
  closes time NOT NULL,
  CHECK (closes > opens)
);
CREATE INDEX store_hours_store ON store_hours(store_id, dow);

-- A store's own price + stock for a shared catalogue product.
-- available = stock_on_hand - stock_reserved (reservations are introduced in the checkout milestone).
CREATE TABLE store_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  product_id uuid NOT NULL REFERENCES products(id),
  price_cents int NOT NULL CHECK (price_cents > 0),
  compare_at_cents int CHECK (compare_at_cents IS NULL OR compare_at_cents > price_cents),
  is_active boolean NOT NULL DEFAULT true,
  stock_on_hand int NOT NULL DEFAULT 0 CHECK (stock_on_hand >= 0),
  stock_reserved int NOT NULL DEFAULT 0 CHECK (stock_reserved >= 0),
  low_stock_threshold int NOT NULL DEFAULT 3,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, product_id),
  CHECK (stock_reserved <= stock_on_hand)
);
CREATE INDEX offers_product ON store_offers(product_id) WHERE is_active;

-- Append-only stock history.
CREATE TABLE inventory_adjustments (
  id bigserial PRIMARY KEY,
  offer_id uuid NOT NULL REFERENCES store_offers(id),
  delta int NOT NULL,
  reason text NOT NULL CHECK (reason IN ('receive','sale','correction','damage','expired','return','initial')),
  note text,
  actor_user_id uuid REFERENCES users(id),
  resulting_on_hand int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX adjustments_offer ON inventory_adjustments(offer_id, created_at);
CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$ LANGUAGE plpgsql;
CREATE TRIGGER adjustments_append_only BEFORE UPDATE OR DELETE ON inventory_adjustments FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
