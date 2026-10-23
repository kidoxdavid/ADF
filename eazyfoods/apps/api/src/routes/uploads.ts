import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireLogin, isStaff } from '../lib/permissions.js';
import { bad, forbidden } from '../lib/errors.js';
import { openPrivate, save, sniff } from '../lib/storage.js';
import { vendorIdsOf } from './vendorOrders.js';
import { rl } from '../lib/ratelimit.js';

async function readFile(req: any) {
  const part = await req.file({ limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  if (!part) throw bad('no_file', 'No file received.');
  const buf = await part.toBuffer();
  if (part.file.truncated) throw bad('too_large', 'File is too large (5 MB maximum).');
  return buf;
}

export const uploadRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireLogin);

  // Public images (product, store logo/cover, ad creative). Vendors and staff only.
  app.post('/uploads/image', rl(30, '1 minute'), async (req) => {
    if (!vendorIdsOf(req.user!).length && !isStaff(req.user)) throw forbidden();
    const buf = await readFile(req);
    const t = sniff(buf, ['jpg', 'png', 'webp']);
    return save(buf, t.ext, 'public');
  });

  // Business documents are private: stored outside the public directory and downloadable only by staff who verify vendors.
  app.post('/vendor/documents', rl(10, '1 minute'), async (req, reply) => {
    const vids = vendorIdsOf(req.user!);
    if (!vids.length) throw forbidden();
    const buf = await readFile(req);
    const kind = z.enum(['business_licence', 'gst_registration', 'food_premises_permit', 'id', 'other']).parse((req.query as any).kind);
    const t = sniff(buf, ['jpg', 'png', 'webp', 'pdf']);
    const { url } = save(buf, t.ext, 'private');
    const r = await pool.query(`INSERT INTO vendor_documents(vendor_id, kind, url) VALUES ($1,$2,$3) RETURNING id, kind, status`, [vids[0], kind, url]);
    return reply.code(201).send(r.rows[0]);
  });

  app.get('/vendor/documents', async (req) =>
    (await pool.query(`SELECT id, kind, status, review_note, created_at FROM vendor_documents WHERE vendor_id = ANY($1::uuid[]) ORDER BY created_at`, [vendorIdsOf(req.user!)])).rows);

  app.get<{ Params: { id: string } }>('/admin/vendor-documents/:id/file', async (req, reply) => {
    const { can } = await import('../lib/permissions.js');
    if (!can(req.user, 'vendors.manage')) throw forbidden();
    const d = (await pool.query('SELECT url FROM vendor_documents WHERE id = $1', [z.string().uuid().parse(req.params.id)])).rows[0];
    if (!d?.url?.startsWith('private:')) return reply.code(404).send({ error: 'not_found' });
    const key = d.url.slice(8);
    const stream = openPrivate(key);
    if (!stream) return reply.code(404).send({ error: 'not_found' });
    reply.header('content-type', key.endsWith('.pdf') ? 'application/pdf' : `image/${key.endsWith('.jpg') ? 'jpeg' : key.split('.')[1]}`).header('content-disposition', 'attachment');
    return reply.send(stream);
  });
};
