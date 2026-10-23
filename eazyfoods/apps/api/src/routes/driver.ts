import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../db/pool.js';
import { requireLogin } from '../lib/permissions.js';
import { bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { moveSuborder } from '../services/orders.js';
import { postDriverEarning } from '../services/ledger.js';

async function me(req: FastifyRequest) {
  const d = (await pool.query('SELECT * FROM drivers WHERE user_id = $1', [req.user!.id])).rows[0];
  return d ?? null;
}
async function approvedDriver(req: FastifyRequest) {
  const d = await me(req);
  if (!d || d.status !== 'approved') throw forbidden('Your driver account is not approved yet.');
  return d;
}

const JOB_SQL = `
  SELECT d.id, d.status, d.instructions, d.earning_cents, d.pickup, d.created_at, d.assigned_at, d.picked_up_at, d.delivered_at,
         jsonb_build_object('line1', d.dropoff->>'line1', 'line2', d.dropoff->>'line2', 'city', d.dropoff->>'city', 'postal_code', d.dropoff->>'postal_code',
                            'first_name', split_part(d.dropoff->>'recipient_name',' ',1), 'phone', d.dropoff->>'phone') AS dropoff,
         o.order_number, s.promised_at, s.status AS suborder_status
    FROM deliveries d JOIN suborders s ON s.id = d.suborder_id JOIN orders o ON o.id = s.order_id`;

export const driverRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireLogin);

  app.post('/driver/apply', async (req, reply) => {
    const b = z.object({ phone: z.string().min(7).max(25), vehicle: z.string().max(80).optional() }).parse(req.body);
    const r = await pool.query(`INSERT INTO drivers(user_id, phone, vehicle) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO NOTHING RETURNING id`, [req.user!.id, b.phone, b.vehicle ?? null]);
    if (!r.rowCount) throw conflict('already_applied', 'You have already applied.');
    return reply.code(201).send({ ok: true, status: 'applied' });
  });

  app.get('/driver/me', async (req) => {
    const d = await me(req);
    if (!d) return { status: 'none' };
    return { id: d.id, status: d.status, phone: d.phone, vehicle: d.vehicle, is_available: d.is_available, licence_verified: d.licence_verified, background_check_verified: d.background_check_verified };
  });

  app.put('/driver/availability', async (req) => {
    const d = await approvedDriver(req);
    const { available } = z.object({ available: z.boolean() }).parse(req.body);
    await pool.query('UPDATE drivers SET is_available = $2 WHERE id = $1', [d.id, available]);
    return { is_available: available };
  });

  // A driver only ever sees jobs assigned to them, and only the customer details needed to deliver.
  app.get('/driver/jobs', async (req) => {
    const d = await approvedDriver(req);
    const { scope } = z.object({ scope: z.enum(['active', 'history']).default('active') }).parse(req.query);
    const where = scope === 'active' ? `d.status IN ('assigned','picked_up')` : `d.status IN ('delivered','failed')`;
    return (await pool.query(`${JOB_SQL} WHERE d.driver_id = $1 AND ${where} ORDER BY d.assigned_at DESC LIMIT 100`, [d.id])).rows;
  });

  const ownJob = async (req: FastifyRequest, id: string) => {
    const d = await approvedDriver(req);
    const j = (await pool.query('SELECT d.*, s.order_id FROM deliveries d JOIN suborders s ON s.id = d.suborder_id WHERE d.id = $1', [id])).rows[0];
    if (!j || j.driver_id !== d.id) throw notFound('Job not found');   // 404, not 403: do not reveal other drivers' jobs
    return { d, j };
  };
  const jobId = (req: any) => z.string().uuid().parse(req.params.id);

  app.post('/driver/jobs/:id/pickup', async (req) => {
    const { j } = await ownJob(req, jobId(req));
    if (j.status !== 'assigned') throw conflict('invalid_state', 'This job is not waiting for pickup.');
    return tx(async (c, after) => {
      await moveSuborder(c, after, j.suborder_id, 'out_for_delivery', { userId: req.user!.id, kind: 'driver' });
      await c.query(`UPDATE deliveries SET status='picked_up', picked_up_at=now() WHERE id=$1`, [j.id]);
      await c.query(`INSERT INTO delivery_events(delivery_id, type, actor_user_id) VALUES ($1,'picked_up',$2)`, [j.id, req.user!.id]);
      return { ok: true, status: 'picked_up' };
    });
  });

  app.post('/driver/jobs/:id/deliver', async (req) => {
    const b = z.object({ code: z.string().max(10).optional(), bypass_reason: z.string().min(5).max(300).optional() }).parse(req.body);
    const { d, j } = await ownJob(req, jobId(req));
    if (j.status !== 'picked_up') throw conflict('invalid_state', 'Pick up the order first.');
    const bypass = !b.code;
    if (bypass && !b.bypass_reason) throw bad('code_required', 'Enter the 4-digit code from the customer, or explain why you cannot.');
    if (!bypass && b.code !== j.handover_code) throw bad('wrong_code', 'That code does not match. Ask the customer to check their order page.');
    return tx(async (c, after) => {
      await moveSuborder(c, after, j.suborder_id, 'delivered', { userId: req.user!.id, kind: 'driver' }, null);
      await c.query(`UPDATE deliveries SET status='delivered', delivered_at=now(), code_bypassed=$2, completion_note=$3 WHERE id=$1`, [j.id, bypass, b.bypass_reason ?? null]);
      await c.query(`INSERT INTO delivery_events(delivery_id, type, actor_user_id, note) VALUES ($1,'delivered',$2,$3)`, [j.id, req.user!.id, bypass ? `CODE BYPASSED: ${b.bypass_reason}` : null]);
      await c.query('INSERT INTO driver_earnings(driver_id, delivery_id, amount_cents) VALUES ($1,$2,$3)', [d.id, j.id, j.earning_cents]);
      await postDriverEarning(c, { driver_id: d.id, delivery_id: j.id, amount: j.earning_cents, order_id: j.order_id, suborder_id: j.suborder_id });
      if (bypass) await c.query(`INSERT INTO support_tickets(kind, category, subject, suborder_id) VALUES ('driver','other',$1,$2)`, [`Delivery completed without handover code: ${b.bypass_reason}`, j.suborder_id]);
      return { ok: true, status: 'delivered', earning_cents: j.earning_cents };
    });
  });

  app.post('/driver/jobs/:id/issue', async (req) => {
    const { note } = z.object({ note: z.string().min(3).max(500) }).parse(req.body);
    const { j } = await ownJob(req, jobId(req));
    await pool.query(`INSERT INTO delivery_events(delivery_id, type, actor_user_id, note) VALUES ($1,'issue',$2,$3)`, [j.id, req.user!.id, note]);
    await pool.query(`INSERT INTO support_tickets(kind, category, subject, suborder_id, user_id) VALUES ('driver','other',$1,$2,$3)`, [`Delivery issue: ${note}`, j.suborder_id, req.user!.id]);
    return { ok: true };
  });

  app.post('/driver/jobs/:id/fail', async (req) => {
    const { reason } = z.object({ reason: z.string().min(3).max(300) }).parse(req.body);
    const { j } = await ownJob(req, jobId(req));
    if (!['assigned', 'picked_up'].includes(j.status)) throw conflict('invalid_state', 'This job is already finished.');
    await pool.query(`UPDATE deliveries SET status='failed', completion_note=$2 WHERE id=$1`, [j.id, reason]);
    await pool.query(`INSERT INTO delivery_events(delivery_id, type, actor_user_id, note) VALUES ($1,'failed',$2,$3)`, [j.id, req.user!.id, reason]);
    await pool.query(`INSERT INTO support_tickets(kind, category, subject, suborder_id, user_id) VALUES ('driver','late_order',$1,$2,$3)`, [`Delivery failed: ${reason}`, j.suborder_id, req.user!.id]);
    return { ok: true, status: 'failed' };
  });

  app.get('/driver/earnings', async (req) => {
    const d = await approvedDriver(req);
    const rows = (await pool.query(
      `SELECT e.amount_cents, e.created_at, o.order_number, (e.payout_id IS NOT NULL) AS paid_out, p.status AS payout_status
         FROM driver_earnings e JOIN deliveries dl ON dl.id = e.delivery_id JOIN suborders s ON s.id = dl.suborder_id JOIN orders o ON o.id = s.order_id LEFT JOIN payouts p ON p.id = e.payout_id
        WHERE e.driver_id = $1 ORDER BY e.created_at DESC LIMIT 200`, [d.id])).rows;
    return { earnings: rows, unpaid_cents: rows.filter((r) => !r.paid_out).reduce((a, r) => a + r.amount_cents, 0), paid_cents: rows.filter((r) => r.paid_out && r.payout_status === 'paid').reduce((a, r) => a + r.amount_cents, 0) };
  });
};
