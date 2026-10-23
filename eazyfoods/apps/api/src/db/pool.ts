import pg from 'pg';
import { config } from '../config.js';

// NUMERIC/BIGINT come back as strings by default; we only use int columns for money so no parser override needed.
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
