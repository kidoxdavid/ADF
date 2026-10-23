import pg from 'pg';
import { config } from '../config.js';

// NUMERIC/BIGINT come back as strings by default; we only use int columns for money so no parser override needed.
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

export type After = Array<() => Promise<unknown>>;

/** Run fn in a transaction. Anything pushed to `after` runs once the transaction has committed (e.g. provider calls, emails). */
export async function tx<T>(fn: (c: pg.PoolClient, after: After) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  const after: After = [];
  try {
    await c.query('BEGIN');
    const r = await fn(c, after);
    await c.query('COMMIT');
    c.release();
    for (const f of after) await f().catch((e) => console.error('post-commit hook failed', e));
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    c.release(true);
    throw e;
  }
}
