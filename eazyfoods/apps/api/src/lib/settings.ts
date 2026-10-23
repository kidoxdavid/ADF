import type { Queryable } from './db-types.js';
import { pool } from '../db/pool.js';

export async function getSetting<T>(key: string, c: Queryable = pool): Promise<T> {
  const r = await c.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  if (!r.rows[0]) throw new Error(`Missing setting ${key}`);
  return r.rows[0].value as T;
}
