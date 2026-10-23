-- Regions and countries are data, not code. A country may belong to several regions
-- (cultural cuisines overlap borders, e.g. Cameroon is West and Central).
CREATE TABLE regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iso2 char(2) UNIQUE,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE region_countries (
  region_id uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  country_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  PRIMARY KEY (region_id, country_id)
);

CREATE TABLE brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  name_norm text NOT NULL
);
CREATE INDEX brands_trgm ON brands USING gin (name_norm gin_trgm_ops);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES categories(id),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);

-- Shared catalogue entry. Price, stock and availability live on store_offers, never here.
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  name_norm text NOT NULL,
  description text,
  brand_id uuid REFERENCES brands(id),
  category_id uuid REFERENCES categories(id),
  sku text,
  barcode text,
  sold_by text NOT NULL DEFAULT 'unit' CHECK (sold_by IN ('unit','weight')),
  pack_size numeric(10,3),
  pack_unit text,
  ingredients text,
  allergens text[],            -- NULL = not supplied (unknown), '{}' = verified none
  storage_info text,
  manufacturer text,
  dietary jsonb NOT NULL DEFAULT '{}',  -- only verified attributes, e.g. {"gluten_free": true}
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','published','archived')),
  seo_title text,
  seo_description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_name_trgm ON products USING gin (name_norm gin_trgm_ops);
CREATE INDEX products_category ON products(category_id);
CREATE UNIQUE INDEX products_barcode ON products(barcode) WHERE barcode IS NOT NULL;

-- Culinary association vs. manufacturing origin are different facts.
CREATE TABLE product_countries (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  country_id uuid NOT NULL REFERENCES countries(id),
  kind text NOT NULL CHECK (kind IN ('culinary','manufacturing')),
  PRIMARY KEY (product_id, country_id, kind)
);

-- Alternative names/spellings. Only verified aliases are searchable, so we never
-- imply an unreviewed equivalence (important for allergens and dietary needs).
CREATE TABLE product_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  alias text NOT NULL,
  alias_norm text NOT NULL,
  note text,
  verified boolean NOT NULL DEFAULT false,
  UNIQUE (product_id, alias_norm)
);
CREATE INDEX aliases_trgm ON product_aliases USING gin (alias_norm gin_trgm_ops);

CREATE TABLE product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url text NOT NULL,
  alt text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);

-- Merchandising collections are rows. Manual items win; otherwise region/category rules apply.
CREATE TABLE collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  subtitle text,
  region_id uuid REFERENCES regions(id),
  category_id uuid REFERENCES categories(id),
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE collection_products (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, product_id)
);

-- Unmet-demand analytics.
CREATE TABLE search_events (
  id bigserial PRIMARY KEY,
  query text NOT NULL,
  result_count int NOT NULL,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
