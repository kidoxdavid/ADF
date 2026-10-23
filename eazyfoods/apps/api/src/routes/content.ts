import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { notFound } from '../lib/errors.js';

export const contentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/content/home', async () => {
    const rows = (await pool.query('SELECT key, value FROM content_blocks')).rows;
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });
  app.get<{ Params: { slug: string } }>('/pages/:slug', async (req) => {
    const p = (await pool.query(`SELECT slug, title, body, needs_legal_review, updated_at FROM pages WHERE slug = $1 AND status = 'published'`, [req.params.slug])).rows[0];
    if (!p) throw notFound('Page not found');
    return p;
  });
  app.get('/pages', async () => (await pool.query(`SELECT slug, title FROM pages WHERE status = 'published' ORDER BY title`)).rows);
};
