import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../db/pool.js';
import { requireLogin } from '../lib/permissions.js';
import { bad, notFound } from '../lib/errors.js';
import { vendorIdsOf } from './vendorOrders.js';

const categories = ['missing_item', 'incorrect_item', 'damaged_item', 'substituted_item', 'late_order', 'payment', 'other'] as const;

export const supportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireLogin);

  // Report a problem with part of an order. Allowed on paid orders owned by the caller.
  app.post<{ Params: { id: string } }>('/orders/:id/issues', async (req, reply) => {
    const id = z.string().uuid().parse(req.params.id);
    const b = z.object({
      suborder_id: z.string().uuid(), category: z.enum(categories), message: z.string().min(5).max(1500),
      line_ids: z.array(z.string().uuid()).max(50).default([]),
    }).parse(req.body);
    const sub = (await pool.query(`SELECT s.id, s.vendor_id, o.order_number FROM suborders s JOIN orders o ON o.id = s.order_id WHERE s.id = $1 AND o.id = $2 AND o.user_id = $3 AND o.payment_status <> 'pending'`, [b.suborder_id, id, req.user!.id])).rows[0];
    if (!sub) throw notFound('Order not found');
    const t = await tx(async (c) => {
      const lines = b.line_ids.length ? (await c.query('SELECT id, product_name, quantity FROM order_lines WHERE id = ANY($1::uuid[]) AND suborder_id = $2', [b.line_ids, b.suborder_id])).rows : [];
      const ticket = (await c.query(
        `INSERT INTO support_tickets(user_id, vendor_id, suborder_id, kind, category, subject, affected_lines) VALUES ($1,$2,$3,'customer',$4,$5,$6) RETURNING id`,
        [req.user!.id, sub.vendor_id, b.suborder_id, b.category, `Order ${sub.order_number}: ${b.category.replace(/_/g, ' ')}`, JSON.stringify(lines)])).rows[0];
      await c.query('INSERT INTO ticket_messages(ticket_id, author_user_id, body) VALUES ($1,$2,$3)', [ticket.id, req.user!.id, b.message]);
      return ticket;
    });
    return reply.code(201).send({ id: t.id });
  });

  app.get('/support/tickets', async (req) =>
    (await pool.query(`SELECT id, category, subject, status, created_at, updated_at FROM support_tickets WHERE user_id = $1 AND kind = 'customer' ORDER BY updated_at DESC`, [req.user!.id])).rows);

  app.get<{ Params: { id: string } }>('/support/tickets/:id', async (req) => {
    const id = z.string().uuid().parse(req.params.id);
    const t = (await pool.query('SELECT id, category, subject, status, created_at, affected_lines FROM support_tickets WHERE id = $1 AND user_id = $2', [id, req.user!.id])).rows[0];
    if (!t) throw notFound('Ticket not found');
    // Internal staff notes are never shown to customers.
    const messages = (await pool.query(`SELECT m.body, m.created_at, (m.author_user_id = $2) AS mine FROM ticket_messages m WHERE m.ticket_id = $1 AND NOT m.is_internal ORDER BY m.id`, [id, req.user!.id])).rows;
    return { ...t, messages };
  });

  app.post<{ Params: { id: string } }>('/support/tickets/:id/messages', async (req) => {
    const id = z.string().uuid().parse(req.params.id);
    const { body } = z.object({ body: z.string().min(1).max(1500) }).parse(req.body);
    const t = (await pool.query(`UPDATE support_tickets SET updated_at = now(), status = CASE WHEN status IN ('resolved','pending') THEN 'open' ELSE status END WHERE id = $1 AND user_id = $2 RETURNING id`, [id, req.user!.id])).rows[0];
    if (!t) throw notFound('Ticket not found');
    await pool.query('INSERT INTO ticket_messages(ticket_id, author_user_id, body) VALUES ($1,$2,$3)', [id, req.user!.id, body]);
    return { ok: true };
  });

  // Vendors ask for help with disputes or fulfilment problems.
  app.post('/vendor/support', async (req, reply) => {
    const vids = vendorIdsOf(req.user!);
    if (!vids.length) throw bad('not_a_vendor', 'Only vendor accounts can use this.');
    const b = z.object({ subject: z.string().min(3).max(150), message: z.string().min(5).max(1500), suborder_id: z.string().uuid().optional() }).parse(req.body);
    if (b.suborder_id) {
      const ok = (await pool.query('SELECT 1 FROM suborders WHERE id = $1 AND vendor_id = ANY($2::uuid[])', [b.suborder_id, vids])).rowCount;
      if (!ok) throw notFound('Order not found');
    }
    const t = await tx(async (c) => {
      const ticket = (await c.query(`INSERT INTO support_tickets(user_id, vendor_id, suborder_id, kind, category, subject) VALUES ($1,$2,$3,'vendor','other',$4) RETURNING id`, [req.user!.id, vids[0], b.suborder_id ?? null, b.subject])).rows[0];
      await c.query('INSERT INTO ticket_messages(ticket_id, author_user_id, body) VALUES ($1,$2,$3)', [ticket.id, req.user!.id, b.message]);
      return ticket;
    });
    return reply.code(201).send({ id: t.id });
  });
};
