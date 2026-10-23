-- ===== Roles & users =====
ALTER TABLE user_roles DROP CONSTRAINT user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check CHECK (role IN
  ('customer','vendor_owner','vendor_staff','driver','owner','admin','support','finance','dispatcher','catalog'));
ALTER TABLE users ADD COLUMN marketing_opt_in_at timestamptz, ADD COLUMN deleted_at timestamptz,
  ADD COLUMN notify_email boolean NOT NULL DEFAULT true;

CREATE TABLE auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('password_reset','email_verify')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== Vendors (onboarding, commercial overrides) =====
ALTER TABLE vendors ADD COLUMN commission_bps int CHECK (commission_bps BETWEEN 0 AND 5000),
  ADD COLUMN stripe_account_id text, ADD COLUMN business_number text, ADD COLUMN phone text, ADD COLUMN contact_email text,
  ADD COLUMN agreement_version text, ADD COLUMN agreement_accepted_at timestamptz, ADD COLUMN submitted_at timestamptz;
CREATE TABLE vendor_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  kind text NOT NULL CHECK (kind IN ('business_licence','gst_registration','food_premises_permit','id','other')),
  url text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  reviewed_by uuid REFERENCES users(id), review_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== Stores / fulfilment config =====
ALTER TABLE stores ADD COLUMN offers_delivery boolean NOT NULL DEFAULT true, ADD COLUMN offers_pickup boolean NOT NULL DEFAULT false,
  ADD COLUMN logo_url text, ADD COLUMN cover_url text, ADD COLUMN ordering_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN policies text;
ALTER TABLE products ADD COLUMN tax_class text NOT NULL DEFAULT 'zero_rated' CHECK (tax_class IN ('zero_rated','standard')),
  ADD COLUMN suggested_by_vendor_id uuid REFERENCES vendors(id), ADD COLUMN reviewed_by uuid REFERENCES users(id);

-- Delivery zones are data: postal-code FSAs (first three characters) map to a zone with a fee and ETA.
CREATE TABLE delivery_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  fee_cents int NOT NULL CHECK (fee_cents >= 0),
  free_over_cents int CHECK (free_over_cents IS NULL OR free_over_cents > 0),
  eta_minutes int NOT NULL DEFAULT 90 CHECK (eta_minutes > 0),
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE delivery_zone_fsas (
  fsa char(3) PRIMARY KEY,
  zone_id uuid NOT NULL REFERENCES delivery_zones(id) ON DELETE CASCADE
);
CREATE TABLE store_delivery_zones (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES delivery_zones(id) ON DELETE CASCADE,
  PRIMARY KEY (store_id, zone_id)
);

CREATE TABLE addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text,
  recipient_name text NOT NULL,
  phone text NOT NULL,
  line1 text NOT NULL,
  line2 text,
  city text NOT NULL,
  province text NOT NULL DEFAULT 'AB',
  postal_code text NOT NULL CHECK (postal_code ~ '^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$'),
  instructions text,
  is_default boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX addresses_user ON addresses(user_id) WHERE deleted_at IS NULL;

-- ===== Cart =====
CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cart_items (
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  offer_id uuid NOT NULL REFERENCES store_offers(id),
  quantity int NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  added_price_cents int NOT NULL,
  PRIMARY KEY (cart_id, offer_id)
);

-- ===== Promotions =====
CREATE TABLE offer_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES store_offers(id) ON DELETE CASCADE,
  sale_price_cents int NOT NULL CHECK (sale_price_cents > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_by uuid REFERENCES users(id),
  cancelled_at timestamptz,
  CHECK (ends_at > starts_at)
);
CREATE INDEX offer_promotions_offer ON offer_promotions(offer_id);

-- The price a customer sees and pays: an active promotion overrides the base price.
CREATE VIEW offers_live AS
SELECT o.id, o.store_id, o.product_id, o.is_active, o.stock_on_hand, o.stock_reserved, o.low_stock_threshold,
       COALESCE(pr.sale_price_cents, o.price_cents) AS price_cents,
       CASE WHEN pr.id IS NOT NULL THEN o.price_cents ELSE o.compare_at_cents END AS compare_at_cents,
       o.price_cents AS base_price_cents,
       (pr.id IS NOT NULL) AS on_promotion
  FROM store_offers o
  LEFT JOIN LATERAL (
    SELECT p.id, p.sale_price_cents FROM offer_promotions p
     WHERE p.offer_id = o.id AND p.cancelled_at IS NULL AND now() >= p.starts_at AND now() < p.ends_at AND p.sale_price_cents < o.price_cents
     ORDER BY p.sale_price_cents LIMIT 1) pr ON true;

CREATE TABLE coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  description text,
  kind text NOT NULL CHECK (kind IN ('percent','fixed')),
  value int NOT NULL CHECK (value > 0),
  min_subtotal_cents int NOT NULL DEFAULT 0,
  max_discount_cents int,
  first_order_only boolean NOT NULL DEFAULT false,
  starts_at timestamptz, ends_at timestamptz,
  max_redemptions int, per_user_limit int NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'percent' OR value <= 100)
);

-- ===== Orders =====
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','placed','completed','cancelled','payment_failed','expired')),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','partially_refunded','refunded')),
  fulfilment_method text NOT NULL CHECK (fulfilment_method IN ('delivery','pickup')),
  address jsonb,
  customer_name text NOT NULL, customer_phone text, customer_email text NOT NULL,
  delivery_instructions text,
  subtotal_cents int NOT NULL, discount_cents int NOT NULL DEFAULT 0, delivery_cents int NOT NULL DEFAULT 0,
  tax_cents int NOT NULL DEFAULT 0, total_cents int NOT NULL CHECK (total_cents >= 0),
  coupon_id uuid REFERENCES coupons(id),
  idempotency_key text NOT NULL,
  placed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX orders_user ON orders(user_id, created_at DESC);

CREATE TABLE suborders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  store_id uuid NOT NULL REFERENCES stores(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  status text NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN
    ('awaiting_payment','placed','accepted','preparing','ready','out_for_delivery','delivered','collected','rejected','cancelled','expired')),
  fulfilment_method text NOT NULL CHECK (fulfilment_method IN ('delivery','pickup')),
  subtotal_cents int NOT NULL, discount_cents int NOT NULL DEFAULT 0,
  delivery_cents int NOT NULL DEFAULT 0, delivery_tax_cents int NOT NULL DEFAULT 0, tax_cents int NOT NULL DEFAULT 0,
  total_cents int NOT NULL,
  commission_bps int NOT NULL, commission_cents int NOT NULL,
  eta_minutes int,
  promised_at timestamptz,
  accepted_at timestamptz, ready_at timestamptz, completed_at timestamptz,
  reject_reason text,
  payout_id uuid,
  delivery_refunded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX suborders_order ON suborders(order_id);
CREATE INDEX suborders_store ON suborders(store_id, status);

CREATE TABLE order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suborder_id uuid NOT NULL REFERENCES suborders(id),
  offer_id uuid NOT NULL REFERENCES store_offers(id),
  product_id uuid NOT NULL REFERENCES products(id),
  product_name text NOT NULL, brand text, pack_label text, sold_by text NOT NULL DEFAULT 'unit',
  unit_price_cents int NOT NULL, quantity int NOT NULL CHECK (quantity > 0),
  line_total_cents int NOT NULL, discount_cents int NOT NULL DEFAULT 0,
  tax_rate_bps int NOT NULL DEFAULT 0, tax_cents int NOT NULL DEFAULT 0, commission_cents int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','unavailable','cancelled')),
  refunded_quantity int NOT NULL DEFAULT 0 CHECK (refunded_quantity >= 0),
  substitution_status text NOT NULL DEFAULT 'none' CHECK (substitution_status IN ('none','proposed','approved','declined')),
  substitute_offer_id uuid REFERENCES store_offers(id),
  substitute_name text, substitute_unit_price_cents int,
  CHECK (refunded_quantity <= quantity)
);
CREATE INDEX order_lines_suborder ON order_lines(suborder_id);

CREATE TABLE order_status_history (
  id bigserial PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  suborder_id uuid REFERENCES suborders(id),
  from_status text, to_status text NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX osh_order ON order_status_history(order_id);

CREATE TABLE inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_line_id uuid NOT NULL REFERENCES order_lines(id),
  offer_id uuid NOT NULL REFERENCES store_offers(id),
  quantity int NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held','committed','released')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX reservations_open ON inventory_reservations(expires_at) WHERE status = 'held';

-- ===== Payments =====
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  provider text NOT NULL,
  provider_payment_id text NOT NULL,
  amount_cents int NOT NULL CHECK (amount_cents >= 0),
  currency char(3) NOT NULL DEFAULT 'CAD',
  status text NOT NULL DEFAULT 'requires_payment' CHECK (status IN ('requires_payment','succeeded','failed','canceled')),
  failure_message text,
  client_secret text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id)
);
-- Every provider event is recorded exactly once; the unique key makes webhook handling idempotent.
CREATE TABLE payment_events (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  event_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  outcome text,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  suborder_id uuid NOT NULL REFERENCES suborders(id),
  payment_id uuid NOT NULL REFERENCES payments(id),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','succeeded','failed')),
  reason text NOT NULL,
  lines jsonb NOT NULL DEFAULT '[]',          -- [{line_id, quantity}]
  include_delivery boolean NOT NULL DEFAULT false,
  merchandise_cents int NOT NULL DEFAULT 0, discount_cents int NOT NULL DEFAULT 0,
  tax_cents int NOT NULL DEFAULT 0, delivery_cents int NOT NULL DEFAULT 0, commission_cents int NOT NULL DEFAULT 0,
  amount_cents int NOT NULL CHECK (amount_cents >= 0),
  vendor_funded boolean NOT NULL DEFAULT true,  -- false = marketplace absorbs the cost (e.g. driver/late/our error)
  requested_by uuid REFERENCES users(id), decided_by uuid REFERENCES users(id), decision_note text,
  provider_refund_id text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz
);

-- ===== Double-entry ledger (append-only, each transaction sums to zero) =====
CREATE TABLE ledger_entries (
  id bigserial PRIMARY KEY,
  txn_id uuid NOT NULL,
  account text NOT NULL CHECK (account IN
    ('cash_provider','vendor_payable','commission_revenue','delivery_revenue','tax_payable','discount_expense','driver_payable','delivery_cost','refund_loss')),
  vendor_id uuid REFERENCES vendors(id),
  driver_id uuid,
  order_id uuid REFERENCES orders(id),
  suborder_id uuid REFERENCES suborders(id),
  amount_cents bigint NOT NULL,   -- debit positive, credit negative
  kind text NOT NULL,
  ref_type text, ref_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_txn ON ledger_entries(txn_id);
CREATE INDEX ledger_vendor ON ledger_entries(vendor_id, account);
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE FUNCTION ledger_balanced() RETURNS trigger AS $$
BEGIN
  IF (SELECT sum(amount_cents) FROM ledger_entries WHERE txn_id = NEW.txn_id) <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % does not balance', NEW.txn_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER ledger_zero_sum AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_balanced();

CREATE TABLE payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payee_type text NOT NULL CHECK (payee_type IN ('vendor','driver')),
  vendor_id uuid REFERENCES vendors(id),
  driver_id uuid,
  amount_cents int NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
  provider_transfer_id text,
  note text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE suborders ADD CONSTRAINT suborders_payout_fk FOREIGN KEY (payout_id) REFERENCES payouts(id);

INSERT INTO app_settings(key, value) VALUES
 ('currency', '"CAD"'),
 ('tax.rates_bps', '{"zero_rated":0,"standard":500}'),
 ('commission.default_bps', '1200'),
 ('checkout.reservation_minutes', '15'),
 ('vendor.accept_timeout_minutes', '15'),
 ('vendor.auto_reject_minutes', '45'),
 ('vendor.require_verified_docs', 'true'),
 ('ordering.require_open', 'true'),
 ('driver.pay_per_delivery_cents', '450'),
 ('payout.hold_days', '2');
