import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../db/pool.js';
import { audit, hasRole, requireUser } from '../lib/auth.js';

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    if (!requireUser(req, reply)) return reply;
    if (!hasRole(req.user!, 'admin')) return reply.code(403).send({ error: 'forbidden' });
  });

  app.patch<{ Params: { id: string } }>('/vendors/:id/status', async (req, reply) => {
    const id = z.string().uuid().parse(req.params.id);
    const { status } = z.object({ status: z.enum(['approved', 'suspended', 'submitted']) }).parse(req.body);
    const r = await pool.query('UPDATE vendors SET status = $2 WHERE id = $1 RETURNING id, status', [id, status]);
    if (!r.rowCount) return reply.code(404).send({ error: 'not_found' });
    await audit(req.user!.id, `vendor.${status}`, 'vendor', id);
    return r.rows[0];
  });

  app.patch<{ Params: { id: string } }>('/stores/:id/status', async (req, reply) => {
    const id = z.string().uuid().parse(req.params.id);
    const { status } = z.object({ status: z.enum(['published', 'suspended', 'pending']) }).parse(req.body);
    return tx(async (c) => {
      const s = (await c.query('SELECT s.id, v.status AS vendor_status FROM stores s JOIN vendors v ON v.id = s.vendor_id WHERE s.id = $1 FOR UPDATE OF s', [id])).rows[0];
      if (!s) return reply.code(404).send({ error: 'not_found' });
      if (status === 'published' && s.vendor_status !== 'approved')
        return reply.code(409).send({ error: 'vendor_not_approved', message: 'Approve the vendor before publishing its store.' });
      const r = await c.query('UPDATE stores SET status = $2 WHERE id = $1 RETURNING id, status', [id, status]);
      await audit(req.user!.id, `store.${status}`, 'store', id, {}, c);
      return r.rows[0];
    });
  });
};
