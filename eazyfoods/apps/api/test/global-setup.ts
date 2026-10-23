import pg from 'pg';

// Wipes the TEST database, then migrates and seeds it. Never point TEST_DATABASE_URL at real data.
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:pw@localhost:5432/eazyfoods_test';
  if (!/test/.test(new URL(url).pathname)) throw new Error('Refusing to reset a database whose name does not contain "test"');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  process.env.DATABASE_URL = url;
  const { migrate } = await import('../src/db/migrate.js');
  const { seed } = await import('../src/db/seed.js');
  const { pool } = await import('../src/db/pool.js');
  await migrate(() => {});
  await seed(() => {});
  await pool.end();
}
