import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';

const API = 4301, WEB = 5301;
const adminUrl = process.env.E2E_ADMIN_DATABASE_URL ?? 'postgresql://postgres:pw@localhost:5432/postgres';
const dbUrl = adminUrl.replace(/\/[^/]*$/, '/eazyfoods_e2e');
const root = resolve(import.meta.dirname, '../..');

const waitFor = async (url: string, ms = 60_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 400)); }
  throw new Error(`Timed out waiting for ${url}`);
};

/** Fresh database + real API + real web dev server. Nothing is mocked except the development payment provider. */
export default async function setup() {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  await c.query('DROP DATABASE IF EXISTS eazyfoods_e2e WITH (FORCE)');
  await c.query('CREATE DATABASE eazyfoods_e2e');
  await c.end();

  const env = { ...process.env, DATABASE_URL: dbUrl, NODE_ENV: 'development' };
  const run = (script: string) => execFileSync('npx', ['tsx', script], { cwd: join(root, 'apps/api'), env, stdio: 'inherit' });
  run('src/db/migrate.ts'); run('src/db/seed.ts');
  // Stores are open around the clock so the journeys do not depend on the time of day.
  const d = new pg.Client({ connectionString: dbUrl }); await d.connect();
  await d.query('DELETE FROM store_hours');
  await d.query(`INSERT INTO store_hours(store_id, dow, opens, closes) SELECT s.id, g, '00:00', '23:59:59' FROM stores s, generate_series(0,6) g`);
  await d.end();

  const kids: ChildProcess[] = [];
  const start = (cmd: string, args: string[], cwd: string, extra: Record<string, string>) => {
    const p = spawn(cmd, args, { cwd, env: { ...env, ...extra }, stdio: 'ignore', detached: true });   // own process group so the whole tree can be stopped
    kids.push(p);
  };
  start('npx', ['tsx', 'src/server.ts'], join(root, 'apps/api'), { PORT: String(API), WEB_ORIGIN: `http://localhost:${WEB}`, DISABLE_BACKGROUND_JOBS: '1', RATE_LIMIT_OFF: '1', UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'ez-uploads-')) });
  start('npx', ['vite', '--port', String(WEB), '--strictPort'], join(root, 'apps/web'), { API_PORT: String(API), WEB_PORT: String(WEB) });
  await waitFor(`http://localhost:${API}/health`);
  await waitFor(`http://localhost:${WEB}/`);
  process.env.E2E_BASE = `http://localhost:${WEB}`;
  process.env.E2E_DB = dbUrl;

  return () => { for (const k of kids) { try { process.kill(-k.pid!, 'SIGTERM'); } catch { /* already gone */ } } };
}
