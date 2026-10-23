import { fileURLToPath } from 'node:url';
import { pool, tx } from './pool.js';
import { norm, slugify } from '../lib/norm.js';
import { hashPassword } from '../lib/password.js';

/**
 * DEVELOPMENT / TEST DATA ONLY.
 * Prices, stock, stores and vendors below are invented for development. Vendors and stores are
 * flagged is_test_data so the UI labels them. Replace with real pilot-store data via the vendor portal / CSV import.
 */

const REGIONS: Record<string, { name: string; countries: [string, string][] }> = {
  'west-africa': { name: 'West Africa', countries: [['NG', 'Nigeria'], ['GH', 'Ghana'], ['SN', 'Senegal'], ['CI', "Côte d'Ivoire"], ['CM', 'Cameroon'], ['SL', 'Sierra Leone'], ['LR', 'Liberia'], ['TG', 'Togo'], ['BJ', 'Benin'], ['ML', 'Mali']] },
  'east-africa': { name: 'East Africa', countries: [['ET', 'Ethiopia'], ['ER', 'Eritrea'], ['SO', 'Somalia'], ['KE', 'Kenya'], ['TZ', 'Tanzania'], ['UG', 'Uganda'], ['RW', 'Rwanda'], ['SD', 'Sudan']] },
  'central-africa': { name: 'Central Africa', countries: [['CD', 'Democratic Republic of the Congo'], ['CG', 'Republic of the Congo'], ['CM', 'Cameroon'], ['GA', 'Gabon'], ['AO', 'Angola']] },
  'north-africa': { name: 'North Africa', countries: [['MA', 'Morocco'], ['DZ', 'Algeria'], ['TN', 'Tunisia'], ['EG', 'Egypt'], ['LY', 'Libya'], ['SD', 'Sudan']] },
  'southern-africa': { name: 'Southern Africa', countries: [['ZA', 'South Africa'], ['ZW', 'Zimbabwe'], ['ZM', 'Zambia'], ['MW', 'Malawi'], ['MZ', 'Mozambique'], ['AO', 'Angola']] },
};

const CATEGORIES: [string, string, string | null][] = [
  ['rice-grains-flour', 'Rice, Grains & Flour', null],
  ['spices-seasonings-sauces', 'Spices, Seasonings & Sauces', null],
  ['fresh-produce', 'Fresh Produce & Leafy Vegetables', null],
  ['frozen', 'Frozen Fish & Meat', null],
  ['snacks-drinks', 'Snacks, Drinks & Treats', null],
  ['soup-stew', 'Soup & Stew Ingredients', null],
  ['oils-butters', 'Oils & Butters', null],
  ['canned-jarred', 'Canned & Jarred', null],
  ['breakfast', 'Breakfast & Porridge', null],
  ['dried-fish-meat', 'Dried Fish & Meat', null],
];

// Brands are fictional on purpose: demo data must never imply a real brand is stocked.
type P = { name: string; brand?: string; cat: string; size?: number; unit?: string; sold?: 'unit' | 'weight'; culinary: string[]; made?: string[]; aliases?: [string, boolean][]; desc: string; ingredients?: string; allergens?: string[]; tax?: 'standard' };
const PRODUCTS: P[] = [
  { name: 'Garri (White)', brand: 'Golden Mill', cat: 'rice-grains-flour', size: 2, unit: 'kg', culinary: ['nigeria'], made: ['nigeria'], aliases: [['Gari', true], ['Garri Ijebu', false]], desc: 'Granulated cassava, eaten as eba or soaked with cold water.', ingredients: 'Cassava', allergens: [] },
  { name: 'Garri (Yellow)', brand: 'Golden Mill', cat: 'rice-grains-flour', size: 2, unit: 'kg', culinary: ['nigeria'], desc: 'Palm-oil tinted garri with a nuttier flavour.', ingredients: 'Cassava, palm oil', allergens: [] },
  { name: 'Shito Black Pepper Sauce', brand: 'Harvest Kitchen', cat: 'spices-seasonings-sauces', size: 340, unit: 'g', culinary: ['ghana'], aliases: [['Shitor', true], ['Shito', true]], desc: 'Ghanaian hot pepper sauce made with dried fish and shrimp.', allergens: ['fish', 'crustaceans'] },
  { name: 'Berbere Spice Blend', brand: 'Highland Spice Co.', cat: 'spices-seasonings-sauces', size: 200, unit: 'g', culinary: ['ethiopia', 'eritrea'], aliases: [['Berbera', true]], desc: 'Ethiopian and Eritrean red chilli and spice blend.' },
  { name: 'Preserved Lemons', brand: 'Atlas Pantry', cat: 'canned-jarred', size: 500, unit: 'g', culinary: ['morocco'], desc: 'Salt-cured lemons for tagines and salads.' },
  { name: 'Cassava Leaves (Frozen)', brand: 'Congo River', cat: 'fresh-produce', size: 500, unit: 'g', culinary: ['democratic-republic-of-the-congo', 'republic-of-the-congo'], aliases: [['Pondu', true], ['Saka saka', true]], desc: 'Shredded cassava leaves, cooked into pondu / saka saka.', allergens: [] },
  { name: 'Chakalaka Relish (Hot)', brand: 'Savanna Table', cat: 'canned-jarred', size: 410, unit: 'g', culinary: ['south-africa'], made: ['south-africa'], desc: 'Spicy vegetable relish served with pap, braai and bread.' },
  { name: 'Egusi (Ground Melon Seeds)', brand: 'Harvest Kitchen', cat: 'soup-stew', size: 450, unit: 'g', culinary: ['nigeria', 'cameroon'], aliases: [['Agusi', true], ['Ogbono', false]], desc: 'Ground melon seeds used to thicken egusi soup.' },
  { name: 'Ogbono (Ground Wild Mango Seed)', brand: 'Harvest Kitchen', cat: 'soup-stew', size: 300, unit: 'g', culinary: ['nigeria'], desc: 'Ground seeds that make a thick, draw soup.' },
  { name: 'Ugali Maize Flour', brand: 'Sunrise Mill', cat: 'rice-grains-flour', size: 2, unit: 'kg', culinary: ['kenya', 'tanzania', 'uganda'], aliases: [['Posho', true], ['Sembe', true]], desc: 'White maize flour for ugali.' },
  { name: 'Teff Flour (Ivory)', brand: 'Highland Spice Co.', cat: 'rice-grains-flour', size: 1, unit: 'kg', culinary: ['ethiopia', 'eritrea'], desc: 'Whole-grain teff flour for injera.', allergens: [] },
  { name: 'Plantain Chips (Salted)', brand: 'Crunch Coast', cat: 'snacks-drinks', size: 100, unit: 'g', culinary: ['nigeria', 'ghana', 'cameroon'], desc: 'Crisp fried plantain slices.', tax: 'standard' },
  { name: 'Plantain Chips (Spicy)', brand: 'Crunch Coast', cat: 'snacks-drinks', size: 100, unit: 'g', culinary: ['nigeria', 'ghana', 'cameroon'], desc: 'Crisp fried plantain slices with chilli.', tax: 'standard' },
  { name: 'Chin Chin (Crunchy)', brand: 'Crunch Coast', cat: 'snacks-drinks', size: 250, unit: 'g', culinary: ['nigeria'], desc: 'Fried, crunchy dough bites.', tax: 'standard', allergens: ['wheat', 'eggs', 'milk'] },
  { name: 'Hibiscus Drink Concentrate (Zobo)', brand: 'Sunrise Mill', cat: 'snacks-drinks', size: 500, unit: 'ml', culinary: ['nigeria', 'senegal'], aliases: [['Bissap', true], ['Sorrel', false]], desc: 'Hibiscus concentrate to dilute and chill.', tax: 'standard' },
  { name: 'Fufu Flour (Cassava)', brand: 'Golden Mill', cat: 'rice-grains-flour', size: 680, unit: 'g', culinary: ['ghana', 'nigeria'], aliases: [['Foufou', true]], desc: 'Instant fufu flour.' },
  { name: 'Frozen Tilapia (Whole)', brand: 'Lakeside Fish', cat: 'frozen', sold: 'weight', unit: 'kg', culinary: ['ghana', 'nigeria', 'kenya'], desc: 'Whole cleaned tilapia, sold by weight.', allergens: ['fish'] },
  { name: 'Frozen Catfish Steaks', brand: 'Lakeside Fish', cat: 'frozen', sold: 'weight', unit: 'kg', culinary: ['nigeria', 'cameroon'], desc: 'Cut catfish steaks, sold by weight.', allergens: ['fish'] },
  { name: 'Frozen Goat Meat (Cubed)', brand: 'Prairie Halal', cat: 'frozen', sold: 'weight', unit: 'kg', culinary: ['nigeria', 'kenya', 'somalia'], desc: 'Bone-in cubed goat meat, sold by weight.' },
  { name: 'Harissa Paste', brand: 'Atlas Pantry', cat: 'canned-jarred', size: 135, unit: 'g', culinary: ['tunisia', 'algeria', 'morocco'], desc: 'North African chilli paste.' },
  { name: 'Ras el Hanout', brand: 'Atlas Pantry', cat: 'spices-seasonings-sauces', size: 90, unit: 'g', culinary: ['morocco', 'algeria'], desc: 'Fragrant North African spice blend.' },
  { name: 'Jollof Rice Seasoning', brand: 'Harvest Kitchen', cat: 'spices-seasonings-sauces', size: 100, unit: 'g', culinary: ['nigeria', 'ghana', 'senegal'], desc: 'Seasoning blend for jollof rice.' },
  { name: 'Mielie Meal (Maize Meal)', brand: 'Sunrise Mill', cat: 'rice-grains-flour', size: 5, unit: 'kg', culinary: ['south-africa', 'zimbabwe'], aliases: [['Pap flour', true], ['Sadza flour', true]], desc: 'Maize meal for pap and sadza.' },
  { name: 'Parboiled Long Grain Rice', brand: 'Golden Mill', cat: 'rice-grains-flour', size: 5, unit: 'kg', culinary: ['nigeria', 'ghana', 'senegal', 'cote-d-ivoire'], desc: 'Long grain parboiled rice, the usual base for jollof.', allergens: [] },
  { name: 'Suya Spice (Yaji)', brand: 'Harvest Kitchen', cat: 'spices-seasonings-sauces', size: 150, unit: 'g', culinary: ['nigeria'], aliases: [['Yaji', true]], desc: 'Peanut-based suya rub.', allergens: ['peanuts'] },
  { name: 'Red Palm Oil', brand: 'Golden Mill', cat: 'oils-butters', size: 1, unit: 'L', culinary: ['nigeria', 'ghana', 'cameroon', 'democratic-republic-of-the-congo'], desc: 'Unrefined red palm oil for stews and soups.' },
  { name: 'Shea Butter (Food Grade)', brand: 'Savanna Table', cat: 'oils-butters', size: 250, unit: 'g', culinary: ['ghana', 'mali'], desc: 'Unrefined shea butter for cooking.' },
  { name: 'Groundnut Oil', brand: 'Savanna Table', cat: 'oils-butters', size: 1, unit: 'L', culinary: ['senegal', 'ghana', 'nigeria'], desc: 'Pressed groundnut oil.', allergens: ['peanuts'] },
  { name: 'Black-Eyed Beans (Dried)', brand: 'Sunrise Mill', cat: 'rice-grains-flour', size: 1, unit: 'kg', culinary: ['nigeria', 'ghana'], desc: 'Dried black-eyed beans for moin moin and akara.', allergens: [] },
  { name: 'Tomato Paste (Double Concentrate)', brand: 'Savanna Table', cat: 'canned-jarred', size: 400, unit: 'g', culinary: ['nigeria', 'ghana', 'senegal'], desc: 'Double-concentrate tomato paste.' },
  { name: 'Sardines in Tomato Sauce', brand: 'Lakeside Fish', cat: 'canned-jarred', size: 155, unit: 'g', culinary: ['ghana', 'morocco'], desc: 'Tinned sardines in tomato sauce.', allergens: ['fish'] },
  { name: 'Ogi / Pap (Fermented Maize Porridge)', brand: 'Golden Mill', cat: 'breakfast', size: 500, unit: 'g', culinary: ['nigeria', 'ghana'], aliases: [['Akamu', true], ['Koko', true]], desc: 'Fermented maize porridge base.' },
  { name: 'Weetabix-style Maize Porridge Mix', brand: 'Sunrise Mill', cat: 'breakfast', size: 750, unit: 'g', culinary: ['south-africa', 'zimbabwe'], desc: 'Instant maize porridge mix.' },
  { name: 'Smoked Dried Catfish', brand: 'Lakeside Fish', cat: 'dried-fish-meat', size: 200, unit: 'g', culinary: ['nigeria', 'ghana'], desc: 'Smoke-dried catfish for soups and stews.', allergens: ['fish'] },
  { name: 'Stockfish (Dried Cod Head)', brand: 'Lakeside Fish', cat: 'dried-fish-meat', size: 250, unit: 'g', culinary: ['nigeria', 'cameroon'], desc: 'Dried stockfish for rich soups.', allergens: ['fish'] },
  { name: 'Biltong (Beef, Original)', brand: 'Prairie Halal', cat: 'dried-fish-meat', size: 100, unit: 'g', culinary: ['south-africa'], desc: 'Air-dried spiced beef.' },
  { name: 'Okra (Fresh)', brand: 'Valley Greens', cat: 'fresh-produce', sold: 'weight', unit: 'kg', culinary: ['nigeria', 'ghana', 'sudan'], desc: 'Fresh okra, sold by weight.' },
  { name: 'Scotch Bonnet Peppers (Fresh)', brand: 'Valley Greens', cat: 'fresh-produce', size: 250, unit: 'g', culinary: ['ghana', 'nigeria'], desc: 'Hot scotch bonnet peppers.' },
  { name: 'Plantains (Ripe)', brand: 'Valley Greens', cat: 'fresh-produce', sold: 'weight', unit: 'kg', culinary: ['nigeria', 'ghana', 'cameroon'], desc: 'Ripe plantains, sold by weight.' },
  { name: 'Yam Tubers', brand: 'Valley Greens', cat: 'fresh-produce', sold: 'weight', unit: 'kg', culinary: ['nigeria', 'ghana'], desc: 'Fresh yam, sold by weight.' },
  { name: 'Injera (Ready-to-eat, 10 pack)', brand: 'Highland Spice Co.', cat: 'breakfast', size: 10, unit: 'pack', culinary: ['ethiopia', 'eritrea'], desc: 'Soft sourdough flatbread, ready to serve.' },
  { name: 'Rooibos Tea (Loose Leaf)', brand: 'Savanna Table', cat: 'snacks-drinks', size: 250, unit: 'g', culinary: ['south-africa'], desc: 'Caffeine-free rooibos.', tax: 'standard' },
  { name: 'Kenyan Black Tea (Strong)', brand: 'Highland Spice Co.', cat: 'snacks-drinks', size: 250, unit: 'g', culinary: ['kenya', 'uganda'], desc: 'Strong black tea for chai.', tax: 'standard' },
  { name: 'Couscous (Medium)', brand: 'Atlas Pantry', cat: 'rice-grains-flour', size: 1, unit: 'kg', culinary: ['morocco', 'algeria', 'tunisia'], desc: 'Medium-grain couscous.', allergens: ['wheat'] },
  { name: 'Dried Hibiscus Flowers', brand: 'Atlas Pantry', cat: 'spices-seasonings-sauces', size: 100, unit: 'g', culinary: ['senegal', 'nigeria', 'egypt'], aliases: [['Bissap flowers', true]], desc: 'Dried hibiscus for teas and drinks.' },
];

const STORES = [
  { slug: 'demo-calgary-west-african-market', name: 'Demo West African Market', vendor: 'Demo West African Market Ltd.', regions: ['west-africa', 'central-africa'], postal: 'T2A 0A0', address: '1 Test St NE' },
  { slug: 'demo-horn-spice-grocer', name: 'Demo Horn Spice Grocer', vendor: 'Demo Horn Spice Grocer Ltd.', regions: ['east-africa', 'north-africa'], postal: 'T3J 0A0', address: '2 Test Ave NE' },
  { slug: 'demo-southern-pantry', name: 'Demo Southern Pantry', vendor: 'Demo Southern Pantry Ltd.', regions: ['southern-africa', 'west-africa'], postal: 'T2Y 0A0', address: '3 Test Rd SE' },
];

export async function seed(log = console.log) {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed test data in production');
  await tx(async (c) => {
    const regionId: Record<string, string> = {};
    const countryId: Record<string, string> = {};
    let order = 0;
    for (const [slug, r] of Object.entries(REGIONS)) {
      regionId[slug] = (await c.query(`INSERT INTO regions(slug,name,sort_order) VALUES ($1,$2,$3) ON CONFLICT (slug) DO UPDATE SET name=$2 RETURNING id`, [slug, r.name, order++])).rows[0].id;
      for (const [iso, name] of r.countries) {
        const cs = slugify(name);
        countryId[cs] ??= (await c.query(`INSERT INTO countries(iso2,slug,name) VALUES ($1,$2,$3) ON CONFLICT (slug) DO UPDATE SET name=$3 RETURNING id`, [iso, cs, name])).rows[0].id;
        await c.query('INSERT INTO region_countries VALUES ($1,$2) ON CONFLICT DO NOTHING', [regionId[slug], countryId[cs]]);
      }
    }
    const catId: Record<string, string> = {};
    for (const [i, [slug, name]] of CATEGORIES.entries())
      catId[slug] = (await c.query(`INSERT INTO categories(slug,name,sort_order) VALUES ($1,$2,$3) ON CONFLICT (slug) DO UPDATE SET name=$2 RETURNING id`, [slug, name, i])).rows[0].id;

    const productId: Record<string, string> = {};
    for (const p of PRODUCTS) {
      let brandId: string | null = null;
      if (p.brand) brandId = (await c.query(`INSERT INTO brands(slug,name,name_norm) VALUES ($1,$2,$3) ON CONFLICT (slug) DO UPDATE SET name=$2 RETURNING id`, [slugify(p.brand), p.brand, norm(p.brand)])).rows[0].id;
      const slug = slugify(p.name);
      const id = (await c.query(
        `INSERT INTO products(slug,name,name_norm,description,brand_id,category_id,pack_size,pack_unit,sold_by,ingredients,allergens,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'published')
         ON CONFLICT (slug) DO UPDATE SET description=$4 RETURNING id`,
        [slug, p.name, norm(p.name), p.desc, brandId, catId[p.cat], p.size ?? null, p.unit ?? null, p.sold ?? 'unit', p.ingredients ?? null, p.allergens ?? null])).rows[0].id;
      productId[slug] = id;
      if (p.tax === 'standard') await c.query(`UPDATE products SET tax_class='standard' WHERE id=$1`, [id]);
      for (const cs of p.culinary) await c.query(`INSERT INTO product_countries VALUES ($1,$2,'culinary') ON CONFLICT DO NOTHING`, [id, countryId[cs]]);
      for (const cs of p.made ?? []) await c.query(`INSERT INTO product_countries VALUES ($1,$2,'manufacturing') ON CONFLICT DO NOTHING`, [id, countryId[cs]]);
      for (const [alias, verified] of p.aliases ?? [])
        await c.query(`INSERT INTO product_aliases(product_id,alias,alias_norm,verified) VALUES ($1,$2,$3,$4) ON CONFLICT (product_id,alias_norm) DO UPDATE SET verified=$4`, [id, alias, norm(alias), verified]);
    }

    // Merchandising collections (data-driven).
    const cols: [string, string, string, string | null, string | null][] = [
      ['west-african-groceries', 'Shop West African Groceries', 'Nigeria, Ghana, Senegal and beyond', 'west-africa', null],
      ['east-african-ingredients', 'Discover East African Ingredients', 'Ethiopia, Eritrea, Kenya, Somalia and more', 'east-africa', null],
      ['north-african-pantry', 'North African Pantry Essentials', 'Morocco, Tunisia, Algeria, Egypt', 'north-africa', null],
      ['southern-african-favourites', 'Southern African Favourites', 'South Africa, Zimbabwe and neighbours', 'southern-africa', null],
      ['central-african-ingredients', 'Central African Ingredients', 'Congo, Cameroon, Gabon', 'central-africa', null],
      ['rice-grains-flour', 'Rice, Grains and Flour', 'Staples for every table', null, 'rice-grains-flour'],
      ['soup-stew', 'Soup and Stew Ingredients', 'Build the base of the pot', null, 'soup-stew'],
      ['breakfast-essentials', 'African Breakfast Essentials', 'Porridges, flatbreads and tea', null, 'breakfast'],
      ['frozen-fish-meat', 'Frozen Fish and Meat', 'Sold by weight', null, 'frozen'],
      ['snacks-drinks', 'Snacks, Drinks and Treats', 'Something for the road', null, 'snacks-drinks'],
      ['fresh-produce', 'Fresh Produce and Leafy Vegetables', 'Okra, plantain, yam, peppers', null, 'fresh-produce'],
      ['spices-sauces', 'Spices, Seasonings and Sauces', 'Build flavour from the base up', null, 'spices-seasonings-sauces'],
    ];
    for (const [i, [slug, title, sub, r, cat]] of cols.entries())
      await c.query(`INSERT INTO collections(slug,title,subtitle,region_id,category_id,sort_order) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slug) DO UPDATE SET title=$2`,
        [slug, title, sub, r ? regionId[r] : null, cat ? catId[cat] : null, i]);

    const pw = await hashPassword('dev-password-123');
    const user = async (email: string, name: string, role: string, vendorId: string | null = null) => {
      const id = (await c.query(`INSERT INTO users(email,password_hash,full_name) VALUES ($1,$2,$3) ON CONFLICT (email) DO UPDATE SET full_name=$3 RETURNING id`, [email, pw, name])).rows[0].id;
      await c.query(`INSERT INTO user_roles(user_id,role,vendor_id) SELECT $1,$2,$3::uuid WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id=$1 AND role=$2 AND vendor_id IS NOT DISTINCT FROM $3::uuid)`, [id, role, vendorId]);
      return id;
    };
    await user('admin@example.test', 'Test Admin', 'admin');
    await user('customer@example.test', 'Test Customer', 'customer');

    const slugs = Object.keys(productId);
    for (const [si, s] of STORES.entries()) {
      const v = (await c.query(`SELECT id FROM vendors WHERE name=$1`, [s.vendor])).rows[0]?.id
        ?? (await c.query(`INSERT INTO vendors(name,legal_name,status,is_test_data) VALUES ($1,$1,'approved',true) RETURNING id`, [s.vendor])).rows[0].id;
      await user(`owner${si + 1}@example.test`, `Test Owner ${si + 1}`, 'vendor_owner', v);
      const st = (await c.query(
        `INSERT INTO stores(vendor_id,slug,name,description,address_line,postal_code,phone,status,is_test_data,min_order_cents)
         VALUES ($1,$2,$3,$4,$5,$6,'000-000-0000','published',true,2500) ON CONFLICT (slug) DO UPDATE SET name=$3 RETURNING id`,
        [v, s.slug, s.name, 'TEST DATA - not a real store.', s.address, s.postal])).rows[0].id;
      await c.query('DELETE FROM store_hours WHERE store_id=$1', [st]);
      for (let d = 0; d < 7; d++) await c.query(`INSERT INTO store_hours VALUES ($1,$2,'09:00','21:00')`, [st, d]);
      for (const r of s.regions) await c.query('INSERT INTO store_regions VALUES ($1,$2) ON CONFLICT DO NOTHING', [st, regionId[r]]);
      // Each store stocks a different subset at different (invented) prices.
      for (const [pi, slug] of slugs.entries()) {
        if ((pi + si) % 4 === 3) continue;
        const price = 349 + ((pi * 137 + si * 53) % 1100);
        const stock = (pi + si) % 7 === 0 ? 0 : 5 + ((pi * 3 + si) % 20);
        const o = await c.query(
          `INSERT INTO store_offers(store_id,product_id,price_cents,stock_on_hand) VALUES ($1,$2,$3,$4) ON CONFLICT (store_id,product_id) DO NOTHING RETURNING id`,
          [st, productId[slug], price, stock]);
        if (o.rows[0]) await c.query(`INSERT INTO inventory_adjustments(offer_id,delta,reason,resulting_on_hand) VALUES ($1,$2,'initial',$2)`, [o.rows[0].id, stock]);
      }
    }

    // Delivery zone (development defaults; production zones are configured in the admin console).
    // Calgary forward sortation areas. Verify the list and fees before launch.
    const zone = (await c.query(`SELECT id FROM delivery_zones WHERE name='Calgary'`)).rows[0]?.id
      ?? (await c.query(`INSERT INTO delivery_zones(name, fee_cents, free_over_cents, eta_minutes) VALUES ('Calgary', 599, 7500, 90) RETURNING id`)).rows[0].id;
    const fsas = 'T1Y T2A T2B T2C T2E T2G T2H T2J T2K T2L T2M T2N T2P T2R T2S T2T T2V T2W T2X T2Y T2Z T3A T3B T3C T3E T3G T3H T3J T3K T3L T3M T3N T3P T3R'.split(' ');
    for (const f of fsas) await c.query('INSERT INTO delivery_zone_fsas VALUES ($1,$2) ON CONFLICT DO NOTHING', [f, zone]);
    await c.query('INSERT INTO store_delivery_zones SELECT s.id, $1 FROM stores s WHERE s.is_test_data ON CONFLICT DO NOTHING', [zone]);
    await c.query(`UPDATE stores SET offers_pickup = true WHERE slug = 'demo-horn-spice-grocer'`);

    for (const [email, name, role] of [['owner@example.test', 'Test Owner (all permissions)', 'owner'], ['support@example.test', 'Test Support', 'support'],
      ['finance@example.test', 'Test Finance', 'finance'], ['dispatcher@example.test', 'Test Dispatcher', 'dispatcher']] as const) await user(email, name, role);
    const driverUser = await user('driver@example.test', 'Test Driver', 'driver');
    await c.query(`INSERT INTO drivers(user_id, status, phone, vehicle, licence_verified, background_check_verified, is_available) VALUES ($1,'approved','000-000-0001','Car',true,true,true) ON CONFLICT (user_id) DO NOTHING`, [driverUser]);

    const cust = (await c.query(`SELECT id FROM users WHERE email='customer@example.test'`)).rows[0].id;
    if (!(await c.query('SELECT 1 FROM addresses WHERE user_id=$1', [cust])).rowCount)
      await c.query(`INSERT INTO addresses(user_id,label,recipient_name,phone,line1,city,postal_code,is_default) VALUES ($1,'Home','Test Customer','000-000-0002','10 Test Way NE','Calgary','T2A0A1',true)`, [cust]);
    await c.query(`INSERT INTO coupons(code, description, kind, value, min_subtotal_cents, first_order_only, max_discount_cents) VALUES ('WELCOME10','10% off your first order (dev coupon)','percent',10,2000,true,1500) ON CONFLICT (code) DO NOTHING`);

    // Starter recipes. Written as drafts (ai_generated = true, reviewed = false): they are labelled as such in the UI
    // and must be reviewed by a person before the label is removed.
    const R: { title: string; summary: string; region: string; country: string; servings: number; prep: number; cook: number; steps: string[]; safety?: string;
      ings: { label: string; qty?: string; product?: string; optional?: boolean }[] }[] = [
      { title: 'Jollof Rice (Nigerian-style)', summary: 'Smoky one-pot tomato rice.', region: 'west-africa', country: 'nigeria', servings: 4, prep: 20, cook: 45,
        steps: ['Blend tomatoes, peppers and half the onion until smooth, then simmer until the water has reduced.', 'Fry the remaining onion in oil, add tomato paste and cook for a few minutes, then add the blended mix and the jollof seasoning.', 'Wash the rice until the water runs clear, add it with enough stock to just cover, cover tightly and cook on low heat until tender.', 'Fluff with a fork and rest for 5 minutes before serving.'],
        safety: 'Serve rice hot. Refrigerate leftovers within an hour and reheat until steaming.',
        ings: [{ label: 'Parboiled long grain rice', qty: '3 cups', product: 'parboiled-long-grain-rice' }, { label: 'Jollof rice seasoning', qty: '2 tbsp', product: 'jollof-rice-seasoning' }, { label: 'Ripe tomatoes', qty: '6' }, { label: 'Red peppers', qty: '2' }, { label: 'Onions', qty: '2' }, { label: 'Tomato paste', qty: '3 tbsp' }, { label: 'Vegetable oil', qty: '1/2 cup' }, { label: 'Stock', qty: '3 cups' }] },
      { title: 'Egusi Soup', summary: 'Rich melon-seed soup, eaten with swallow foods.', region: 'west-africa', country: 'nigeria', servings: 4, prep: 20, cook: 40,
        steps: ['Heat palm oil, fry chopped onion briefly, then add the ground egusi and stir until it begins to clump.', 'Add stock and pepper, cover and simmer, stirring occasionally.', 'Add your cooked meat or fish and leafy vegetables, and simmer a few more minutes before serving.'],
        safety: 'Cook meat and fish thoroughly before adding to the soup.',
        ings: [{ label: 'Egusi (ground melon seeds)', qty: '1.5 cups', product: 'egusi-ground-melon-seeds' }, { label: 'Palm oil', qty: '1/2 cup' }, { label: 'Onion', qty: '1' }, { label: 'Stock', qty: '2 cups' }, { label: 'Leafy greens (spinach or bitterleaf)', qty: '2 handfuls' }, { label: 'Cooked meat or fish', qty: 'to taste', optional: true }] },
      { title: 'Ugali with Sautéed Greens', summary: 'East African maize staple with greens.', region: 'east-africa', country: 'kenya', servings: 4, prep: 10, cook: 25,
        steps: ['Bring water to a boil, then gradually stir in the maize flour, stirring firmly to avoid lumps.', 'Cover and cook on low heat for a few minutes, then stir and press until thick and smooth.', 'Meanwhile sauté onion and tomato, add shredded greens and cook until tender.', 'Serve the ugali in wedges with the greens.'],
        ings: [{ label: 'Ugali maize flour', qty: '2 cups', product: 'ugali-maize-flour' }, { label: 'Collard greens or kale', qty: '1 large bunch' }, { label: 'Onion', qty: '1' }, { label: 'Tomatoes', qty: '2' }, { label: 'Cooking oil', qty: '2 tbsp' }] },
      { title: 'Suya-spiced Chicken Skewers', summary: 'Peanut-spice rubbed grilled chicken.', region: 'west-africa', country: 'nigeria', servings: 4, prep: 30, cook: 15,
        steps: ['Cut chicken into strips and toss with oil and suya spice. Rest for at least 30 minutes in the refrigerator.', 'Thread onto skewers and grill, turning, until cooked through and charred at the edges.', 'Serve with sliced onion and tomato and extra spice.'],
        safety: 'Cook chicken until the thickest part reaches 74°C (165°F). Contains peanuts: check allergens before serving.',
        ings: [{ label: 'Suya spice (yaji)', qty: '3 tbsp', product: 'suya-spice-yaji' }, { label: 'Chicken thighs or breast', qty: '700 g' }, { label: 'Vegetable oil', qty: '2 tbsp' }, { label: 'Onion and tomato to serve', optional: true }] },
    ];
    for (const r of R) {
      const rid = (await c.query(`INSERT INTO recipes(slug,title,summary,region_id,country_id,servings,prep_minutes,cook_minutes,steps,food_safety_note,ai_generated,reviewed,status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,false,'published') ON CONFLICT (slug) DO NOTHING RETURNING id`,
        [slugify(r.title), r.title, r.summary, regionId[r.region], countryId[r.country], r.servings, r.prep, r.cook, JSON.stringify(r.steps), r.safety ?? null])).rows[0]?.id;
      if (!rid) continue;
      for (const [i, g] of r.ings.entries())
        await c.query('INSERT INTO recipe_ingredients(recipe_id, position, label, quantity_text, product_id, optional) VALUES ($1,$2,$3,$4,$5,$6)', [rid, i, g.label, g.qty ?? null, g.product ? productId[g.product] : null, !!g.optional]);
    }

    // A few live promotions and "was" prices so the deal merchandising has something real to show (all invented).
    if (!(await c.query('SELECT 1 FROM offer_promotions LIMIT 1')).rowCount) {
      await c.query(`INSERT INTO offer_promotions(offer_id, sale_price_cents, starts_at, ends_at)
        SELECT id, price_cents * 80 / 100, now() - interval '1 day', now() + interval '14 days'
          FROM (SELECT id, price_cents, row_number() OVER (ORDER BY id) AS rn FROM store_offers WHERE stock_on_hand > 5) x WHERE rn % 5 = 0`);
      await c.query(`UPDATE store_offers SET compare_at_cents = price_cents * 118 / 100 WHERE id IN
        (SELECT id FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM store_offers) y WHERE rn % 7 = 1)`);
    }
  });
  log('seeded (test data only)');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seed().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
