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
  'east-africa': { name: 'East Africa', countries: [['ET', 'Ethiopia'], ['ER', 'Eritrea'], ['SO', 'Somalia'], ['KE', 'Kenya'], ['TZ', 'Tanzania'], ['UG', 'Uganda'], ['RW', 'Rwanda']] },
  'central-africa': { name: 'Central Africa', countries: [['CD', 'Democratic Republic of the Congo'], ['CG', 'Republic of the Congo'], ['CM', 'Cameroon'], ['GA', 'Gabon'], ['AO', 'Angola']] },
  'north-africa': { name: 'North Africa', countries: [['MA', 'Morocco'], ['DZ', 'Algeria'], ['TN', 'Tunisia'], ['EG', 'Egypt'], ['LY', 'Libya']] },
  'southern-africa': { name: 'Southern Africa', countries: [['ZA', 'South Africa'], ['ZW', 'Zimbabwe'], ['ZM', 'Zambia'], ['MW', 'Malawi'], ['MZ', 'Mozambique'], ['AO', 'Angola']] },
};

const CATEGORIES: [string, string, string | null][] = [
  ['rice-grains-flour', 'Rice, Grains & Flour', null],
  ['spices-seasonings-sauces', 'Spices, Seasonings & Sauces', null],
  ['fresh-produce', 'Fresh Produce & Leafy Vegetables', null],
  ['frozen', 'Frozen Fish & Meat', null],
  ['snacks-drinks', 'Snacks, Drinks & Treats', null],
  ['soup-stew', 'Soup & Stew Ingredients', null],
];

type P = { name: string; brand?: string; cat: string; size?: number; unit?: string; sold?: 'unit' | 'weight'; culinary: string[]; made?: string[]; aliases?: [string, boolean][]; desc: string; ingredients?: string; allergens?: string[] };
const PRODUCTS: P[] = [
  { name: 'Garri (White)', brand: 'Ola Ola', cat: 'rice-grains-flour', size: 2, unit: 'kg', culinary: ['nigeria'], made: ['nigeria'], aliases: [['Gari', true], ['Garri Ijebu', false]], desc: 'Granulated cassava, eaten as eba or soaked with cold water.', ingredients: 'Cassava', allergens: [] },
  { name: 'Shito Black Pepper Sauce', brand: 'Obaapa', cat: 'spices-seasonings-sauces', size: 340, unit: 'g', culinary: ['ghana'], aliases: [['Shitor', true], ['Shito', true]], desc: 'Ghanaian hot pepper sauce made with dried fish and shrimp.', allergens: ['fish', 'crustaceans'] },
  { name: 'Berbere Spice Blend', cat: 'spices-seasonings-sauces', size: 200, unit: 'g', culinary: ['ethiopia', 'eritrea'], aliases: [['Berbera', true]], desc: 'Ethiopian and Eritrean red chilli and spice blend.' },
  { name: 'Preserved Lemons', cat: 'spices-seasonings-sauces', size: 500, unit: 'g', culinary: ['morocco'], desc: 'Salt-cured lemons for tagines and salads.' },
  { name: 'Cassava Leaves (Frozen)', cat: 'fresh-produce', size: 500, unit: 'g', culinary: ['democratic-republic-of-the-congo', 'republic-of-the-congo'], aliases: [['Pondu', true], ['Saka saka', true]], desc: 'Shredded cassava leaves, cooked into pondu / saka saka.', allergens: [] },
  { name: 'Chakalaka Relish (Hot)', brand: 'Mrs H.S. Ball', cat: 'spices-seasonings-sauces', size: 410, unit: 'g', culinary: ['south-africa'], made: ['south-africa'], desc: 'Spicy vegetable relish served with pap, braai and bread.' },
  { name: 'Egusi (Ground Melon Seeds)', cat: 'soup-stew', size: 450, unit: 'g', culinary: ['nigeria', 'cameroon'], aliases: [['Agusi', true], ['Ogbono', false]], desc: 'Ground melon seeds used to thicken egusi soup.' },
  { name: 'Ugali Maize Flour', cat: 'rice-grains-flour', size: 2, unit: 'kg', culinary: ['kenya', 'tanzania', 'uganda'], aliases: [['Posho', true], ['Sembe', true]], desc: 'White maize flour for ugali.' },
  { name: 'Teff Flour (Ivory)', cat: 'rice-grains-flour', size: 1, unit: 'kg', culinary: ['ethiopia', 'eritrea'], desc: 'Whole-grain teff flour for injera.', allergens: [] },
  { name: 'Plantain Chips (Salted)', cat: 'snacks-drinks', size: 100, unit: 'g', culinary: ['nigeria', 'ghana', 'cameroon'], desc: 'Crisp fried plantain slices.' },
  { name: 'Fufu Flour (Cassava)', cat: 'rice-grains-flour', size: 680, unit: 'g', culinary: ['ghana', 'nigeria'], aliases: [['Foufou', true]], desc: 'Instant fufu flour.' },
  { name: 'Frozen Tilapia (Whole)', cat: 'frozen', sold: 'weight', unit: 'kg', culinary: ['ghana', 'nigeria', 'kenya'], desc: 'Whole cleaned tilapia, sold by weight.', allergens: ['fish'] },
  { name: 'Harissa Paste', cat: 'spices-seasonings-sauces', size: 135, unit: 'g', culinary: ['tunisia', 'algeria', 'morocco'], desc: 'North African chilli paste.' },
  { name: 'Jollof Rice Seasoning', cat: 'spices-seasonings-sauces', size: 100, unit: 'g', culinary: ['nigeria', 'ghana', 'senegal'], desc: 'Seasoning blend for jollof rice.' },
  { name: 'Mielie Meal (Maize Meal)', brand: 'Iwisa', cat: 'rice-grains-flour', size: 5, unit: 'kg', culinary: ['south-africa', 'zimbabwe'], aliases: [['Pap flour', true], ['Sadza flour', true]], desc: 'Maize meal for pap and sadza.' },
  { name: 'Parboiled Long Grain Rice', cat: 'rice-grains-flour', size: 5, unit: 'kg', culinary: ['nigeria', 'ghana', 'senegal', 'cote-d-ivoire'], desc: 'Long grain parboiled rice, the usual base for jollof.', allergens: [] },
  { name: 'Suya Spice (Yaji)', cat: 'spices-seasonings-sauces', size: 150, unit: 'g', culinary: ['nigeria'], aliases: [['Yaji', true]], desc: 'Peanut-based suya rub.', allergens: ['peanuts'] },
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
      if (p.cat === 'snacks-drinks') await c.query(`UPDATE products SET tax_class='standard' WHERE id=$1`, [id]);
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
        const price = 399 + ((pi * 137 + si * 53) % 1500);
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
  });
  log('seeded (test data only)');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seed().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
