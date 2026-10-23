import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../db/pool.js';
import { audit } from '../lib/auth.js';
import { can, requirePerm } from '../lib/permissions.js';
import { bad, conflict, notFound } from '../lib/errors.js';
import { getSetting } from '../lib/settings.js';
import { notifyVendorOwners } from '../services/notify.js';
import { createRefund, processRefund, rejectRefund } from '../services/refunds.js';
import { loadOrder } from './orders.js';
import { adminCatalogRoutes } from './adminCatalog.js';
import { adminOpsRoutes } from './adminOps.js';

const uuid = z.string().uuid();

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // ---- Vendors & stores ----
  app.get('/vendors', { preHandler: requirePerm('vendors.manage') }, async (req) => {
    const { status } = z.object({ status: z.string().optional() }).parse(req.query);
    return (await pool.query(
      `SELECT v.id, v.name, v.status, v.commission_bps, v.is_test_data, v.submitted_at, v.created_at,
              (SELECT count(*)::int FROM stores s WHERE s.vendor_id = v.id) AS stores,
              (SELECT count(*)::int FROM vendor_documents d WHERE d.vendor_id = v.id AND d.status = 'verified') AS verified_docs,
              (SELECT count(*)::int FROM vendor_documents d WHERE d.vendor_id = v.id AND d.status = 'pending') AS pending_docs
         FROM vendors v WHERE ($1::text IS NULL OR v.status = $1) ORDER BY (v.status = 'submitted') DESC, v.created_at DESC`, [status ?? null])).rows;
  });

  app.get<{ Params: { id: string } }>('/vendors/:id', { preHandler: requirePerm('vendors.manage') }, async (req) => {
    const id = uuid.parse(req.params.id);
    const v = (await pool.query('SELECT * FROM vendors WHERE id = $1', [id])).rows[0];
    if (!v) throw notFound('Vendor not found');
    const [docs, stores, members] = await Promise.all([
      pool.query('SELECT id, kind, url, status, review_note, created_at FROM vendor_documents WHERE vendor_id = $1 ORDER BY created_at', [id]),
      pool.query('SELECT id, slug, name, status, address_line, city, postal_code, phone FROM stores WHERE vendor_id = $1', [id]),
      pool.query(`SELECT u.email, u.full_name, ur.role FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE ur.vendor_id = $1`, [id]),
    ]);
    return { ...v, documents: docs.rows, stores: stores.rows, members: members.rows };
  });

  app.patch<{ Params: { id: string } }>('/vendors/:id/status', { preHandler: requirePerm('vendors.manage') }, async (req, reply) => {
    const id = uuid.parse(req.params.id);
    const { status } = z.object({ status: z.enum(['approved', 'suspended', 'submitted']) }).parse(req.body);
    return tx(async (c, after) => {
      const v = (await c.query('SELECT id, name, status FROM vendors WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!v) throw notFound('Vendor not found');
      if (status === 'approved' && (await getSetting<boolean>('vendor.require_verified_docs', c))) {
        const ok = (await c.query(`SELECT 1 FROM vendor_documents WHERE vendor_id = $1 AND status = 'verified'`, [id])).rowCount;
        if (!ok) throw conflict('docs_required', 'Verify at least one business document before approving this vendor.');
      }
      const r = await c.query('UPDATE vendors SET status = $2 WHERE id = $1 RETURNING id, status', [id, status]);
      await audit(req.user!.id, `vendor.${status}`, 'vendor', id, {}, c);
      if (status === 'approved') after.push(() => notifyVendorOwners(pool, id, 'vendor_approved', { name: v.name }));
      return r.rows[0];
    });
  });

  app.patch<{ Params: { id: string } }>('/vendor-documents/:id', { preHandler: requirePerm('vendors.manage') }, async (req) => {
    const id = uuid.parse(req.params.id);
    const b = z.object({ status: z.enum(['verified', 'rejected']), note: z.string().max(300).optional() }).parse(req.body);
    const r = await pool.query('UPDATE vendor_documents SET status = $2, review_note = $3, reviewed_by = $4 WHERE id = $1 RETURNING id, status', [id, b.status, b.note ?? null, req.user!.id]);
    if (!r.rowCount) throw notFound('Document not found');
    await audit(req.user!.id, `vendor_document.${b.status}`, 'vendor_document', id, b);
    return r.rows[0];
  });

  // Commission is a financial term: owner-only, recorded.
  app.patch<{ Params: { id: string } }>('/vendors/:id/commission', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const id = uuid.parse(req.params.id);
    const { commission_bps } = z.object({ commission_bps: z.number().int().min(0).max(5000).nullable() }).parse(req.body);
    const r = await pool.query('UPDATE vendors SET commission_bps = $2 WHERE id = $1 RETURNING id, commission_bps', [id, commission_bps]);
    if (!r.rowCount) throw notFound('Vendor not found');
    await audit(req.user!.id, 'vendor.commission_changed', 'vendor', id, { commission_bps });
    return r.rows[0];
  });

  app.get('/stores', { preHandler: requirePerm('stores.manage') }, async () =>
    (await pool.query(`SELECT s.id, s.slug, s.name, s.status, s.city, s.is_test_data, v.name AS vendor_name, v.status AS vendor_status, s.ordering_paused FROM stores s JOIN vendors v ON v.id = s.vendor_id ORDER BY s.created_at DESC`)).rows);

  app.patch<{ Params: { id: string } }>('/stores/:id/status', { preHandler: requirePerm('stores.manage') }, async (req) => {
    const id = uuid.parse(req.params.id);
    const { status } = z.object({ status: z.enum(['published', 'suspended', 'pending']) }).parse(req.body);
    return tx(async (c) => {
      const s = (await c.query('SELECT s.id, v.status AS vendor_status FROM stores s JOIN vendors v ON v.id = s.vendor_id WHERE s.id = $1 FOR UPDATE OF s', [id])).rows[0];
      if (!s) throw notFound('Store not found');
      if (status === 'published' && s.vendor_status !== 'approved') throw conflict('vendor_not_approved', 'Approve the vendor before publishing its store.');
      const r = await c.query('UPDATE stores SET status = $2 WHERE id = $1 RETURNING id, status', [id, status]);
      await audit(req.user!.id, `store.${status}`, 'store', id, {}, c);
      return r.rows[0];
    });
  });

  // ---- Orders (view) & refunds ----
  app.get('/orders', { preHandler: requirePerm('orders.view') }, async (req) => {
    const q = z.object({ q: z.string().max(80).optional(), status: z.string().optional() }).parse(req.query);
    return (await pool.query(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.total_cents, o.customer_email, o.created_at,
              (SELECT string_agg(st.name || ' (' || s.status || ')', ', ') FROM suborders s JOIN stores st ON st.id = s.store_id WHERE s.order_id = o.id) AS stores
         FROM orders o WHERE ($1::text IS NULL OR o.order_number ILIKE '%'||$1||'%' OR o.customer_email ILIKE '%'||$1||'%') AND ($2::text IS NULL OR o.status = $2)
        ORDER BY o.created_at DESC LIMIT 100`, [q.q ?? null, q.status ?? null])).rows;
  });
  app.get<{ Params: { id: string } }>('/orders/:id', { preHandler: requirePerm('orders.view') }, async (req) => {
    const id = uuid.parse(req.params.id);
    const order = await loadOrder(id, null);
    const payments = (await pool.query('SELECT provider, provider_payment_id, amount_cents, status, failure_message, created_at FROM payments WHERE order_id = $1', [id])).rows;
    const refunds = (await pool.query('SELECT id, suborder_id, status, reason, amount_cents, vendor_funded, created_at FROM refunds WHERE order_id = $1 ORDER BY created_at', [id])).rows;
    return { ...order, customer_email: (await pool.query('SELECT customer_email, customer_phone FROM orders WHERE id=$1', [id])).rows[0], payments, refunds };
  });

  app.post<{ Params: { sid: string } }>('/suborders/:sid/refunds', { preHandler: requirePerm('refunds.request') }, async (req, reply) => {
    const sid = uuid.parse(req.params.sid);
    const b = z.object({
      lines: z.array(z.object({ line_id: uuid, quantity: z.number().int().min(1) })), include_delivery: z.boolean().default(false),
      reason: z.string().min(3).max(300), vendor_funded: z.boolean().default(true), ticket_id: uuid.optional(),
    }).parse(req.body);
    if (!b.lines.length && !b.include_delivery) throw bad('nothing_selected', 'Choose at least one item or the delivery fee.');
    const r = await tx(async (c) => {
      const rf = await createRefund(c, { suborderId: sid, lines: b.lines, includeDelivery: b.include_delivery, reason: b.reason, vendorFunded: b.vendor_funded, requestedBy: req.user!.id, ticketId: b.ticket_id });
      await audit(req.user!.id, 'refund.requested', 'refund', rf.id, { amount_cents: rf.amount_cents, reason: b.reason }, c);
      return rf;
    });
    return reply.code(201).send({ id: r.id, amount_cents: r.amount_cents, status: r.status });
  });

  app.get('/refunds', { preHandler: requirePerm('refunds.approve', 'refunds.request', 'orders.view') }, async (req) => {
    const { status } = z.object({ status: z.string().optional() }).parse(req.query);
    return (await pool.query(
      `SELECT r.id, r.status, r.reason, r.amount_cents, r.vendor_funded, r.created_at, o.order_number, st.name AS store_name, u.full_name AS requested_by
         FROM refunds r JOIN orders o ON o.id = r.order_id JOIN suborders s ON s.id = r.suborder_id JOIN stores st ON st.id = s.store_id LEFT JOIN users u ON u.id = r.requested_by
        WHERE ($1::text IS NULL OR r.status = $1) ORDER BY (r.status = 'requested') DESC, r.created_at DESC LIMIT 100`, [status ?? null])).rows;
  });
  app.post<{ Params: { id: string } }>('/refunds/:id/approve', { preHandler: requirePerm('refunds.approve') }, async (req) => processRefund(uuid.parse(req.params.id), req.user!.id));
  app.post<{ Params: { id: string } }>('/refunds/:id/reject', { preHandler: requirePerm('refunds.approve') }, async (req) => {
    const { note } = z.object({ note: z.string().min(3).max(300) }).parse(req.body);
    await rejectRefund(uuid.parse(req.params.id), req.user!.id, note);
    return { ok: true };
  });

  await app.register(adminCatalogRoutes);
  await app.register(adminOpsRoutes);
  void can;
};
