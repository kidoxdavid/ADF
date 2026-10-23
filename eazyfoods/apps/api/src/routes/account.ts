import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../db/pool.js';
import { requireLogin } from '../lib/permissions.js';
import { isCanadianPostal, normalisePostal } from '../services/pricing.js';
import { bad, notFound } from '../lib/errors.js';
import { rl } from '../lib/ratelimit.js';
import { audit } from '../lib/auth.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

const addr = z.object({
  label: z.string().max(40).optional(), recipient_name: z.string().min(1).max(120), phone: z.string().min(7).max(25),
  line1: z.string().min(3).max(160), line2: z.string().max(80).optional().nullable(), city: z.string().min(1).max(80), province: z.string().length(2).default('AB'),
  postal_code: z.string().refine(isCanadianPostal, 'Enter a valid Canadian postal code, e.g. T2A 0A0'),
  instructions: z.string().max(300).optional().nullable(), is_default: z.boolean().optional(),
});

async function withService(a: any) {
  const zone = (await pool.query(`SELECT z.name, z.eta_minutes FROM delivery_zone_fsas f JOIN delivery_zones z ON z.id = f.zone_id AND z.is_active WHERE f.fsa = $1`, [a.postal_code.slice(0, 3)])).rows[0];
  return { ...a, serviceable: !!zone, zone: zone?.name ?? null };
}

export const accountRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireLogin);

  app.get('/addresses', async (req) => {
    const rows = (await pool.query('SELECT id, label, recipient_name, phone, line1, line2, city, province, postal_code, instructions, is_default FROM addresses WHERE user_id = $1 AND deleted_at IS NULL ORDER BY is_default DESC, created_at', [req.user!.id])).rows;
    return Promise.all(rows.map(withService));
  });
  app.post('/addresses', async (req, reply) => {
    const b = addr.parse(req.body);
    const row = await tx(async (c) => {
      const first = !(await c.query('SELECT 1 FROM addresses WHERE user_id = $1 AND deleted_at IS NULL', [req.user!.id])).rowCount;
      if (b.is_default || first) await c.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [req.user!.id]);
      return (await c.query(
        `INSERT INTO addresses(user_id,label,recipient_name,phone,line1,line2,city,province,postal_code,instructions,is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id, label, recipient_name, phone, line1, line2, city, province, postal_code, instructions, is_default`,
        [req.user!.id, b.label ?? null, b.recipient_name, b.phone, b.line1, b.line2 ?? null, b.city, b.province.toUpperCase(), normalisePostal(b.postal_code), b.instructions ?? null, !!(b.is_default || first)])).rows[0];
    });
    return reply.code(201).send(await withService(row));
  });
  app.put<{ Params: { id: string } }>('/addresses/:id', async (req) => {
    const b = addr.parse(req.body);
    const r = await pool.query(
      `UPDATE addresses SET label=$3, recipient_name=$4, phone=$5, line1=$6, line2=$7, city=$8, province=$9, postal_code=$10, instructions=$11 WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL
       RETURNING id, label, recipient_name, phone, line1, line2, city, province, postal_code, instructions, is_default`,
      [z.string().uuid().parse(req.params.id), req.user!.id, b.label ?? null, b.recipient_name, b.phone, b.line1, b.line2 ?? null, b.city, b.province.toUpperCase(), normalisePostal(b.postal_code), b.instructions ?? null]);
    if (!r.rowCount) throw notFound('Address not found');
    return withService(r.rows[0]);
  });
  app.delete<{ Params: { id: string } }>('/addresses/:id', async (req) => {
    const r = await pool.query('UPDATE addresses SET deleted_at = now(), is_default = false WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [z.string().uuid().parse(req.params.id), req.user!.id]);
    if (!r.rowCount) throw notFound('Address not found');
    return { ok: true };
  });

  app.get('/account/profile', async (req) => {
    const u = (await pool.query('SELECT id, email, full_name, phone, email_verified_at, notify_email, marketing_opt_in_at FROM users WHERE id = $1', [req.user!.id])).rows[0];
    return { ...u, roles: req.user!.roles };
  });
  app.put('/account/profile', async (req) => {
    const b = z.object({ full_name: z.string().min(1).max(120), phone: z.string().max(25).nullable().optional(), notify_email: z.boolean(), marketing_opt_in: z.boolean() }).parse(req.body);
    // Consent is recorded with a timestamp when granted, and cleared when withdrawn.
    await pool.query(
      `UPDATE users SET full_name=$2, phone=$3, notify_email=$4, marketing_opt_in_at = CASE WHEN $5 THEN COALESCE(marketing_opt_in_at, now()) ELSE NULL END WHERE id=$1`,
      [req.user!.id, b.full_name, b.phone ?? null, b.notify_email, b.marketing_opt_in]);
    return { ok: true };
  });
  app.post('/account/password', rl(5, '10 minutes'), async (req) => {
    const b = z.object({ current_password: z.string(), new_password: z.string().min(10).max(200) }).parse(req.body);
    const u = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user!.id])).rows[0];
    if (!(await verifyPassword(b.current_password, u.password_hash))) throw bad('wrong_password', 'Your current password is incorrect.');
    await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user!.id, await hashPassword(b.new_password)]);
    // Sign out everywhere else.
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [req.user!.id]);
    return { ok: true, message: 'Password changed. Please sign in again.' };
  });

  // Data portability.
  app.get('/account/export', async (req) => {
    const id = req.user!.id;
    const q = async (sql: string) => (await pool.query(sql, [id])).rows;
    return {
      exported_at: new Date().toISOString(),
      profile: (await q('SELECT id,email,full_name,phone,created_at,marketing_opt_in_at,notify_email FROM users WHERE id=$1'))[0],
      addresses: await q('SELECT * FROM addresses WHERE user_id=$1'),
      orders: await q('SELECT order_number,status,payment_status,fulfilment_method,total_cents,placed_at,address FROM orders WHERE user_id=$1 ORDER BY created_at'),
      favourites: await q('SELECT product_id,created_at FROM favourites WHERE user_id=$1'),
      reviews: await q('SELECT rating,body,created_at FROM reviews WHERE user_id=$1'),
      support_tickets: await q('SELECT id,category,subject,status,created_at FROM support_tickets WHERE user_id=$1'),
    };
  });

  // Erasure: personal details are removed; order and payment records are kept (anonymised) because the law requires financial records.
  app.post('/account/delete', rl(3, '10 minutes'), async (req, reply) => {
    const b = z.object({ password: z.string() }).parse(req.body);
    const u = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user!.id])).rows[0];
    if (!(await verifyPassword(b.password, u.password_hash))) throw bad('wrong_password', 'Password is incorrect.');
    const open = (await pool.query(`SELECT 1 FROM orders WHERE user_id = $1 AND status IN ('pending_payment','placed')`, [req.user!.id])).rowCount;
    if (open) throw bad('open_orders', 'You have orders in progress. Please wait until they are finished before deleting your account.');
    await tx(async (c) => {
      const id = req.user!.id;
      await c.query(`UPDATE users SET email = 'deleted+' || id || '@deleted.invalid', full_name = 'Deleted user', phone = NULL, disabled_at = now(), deleted_at = now(), marketing_opt_in_at = NULL, password_hash = 'x' WHERE id = $1`, [id]);
      await c.query(`UPDATE orders SET customer_name='Deleted user', customer_phone=NULL, customer_email='deleted@deleted.invalid', address=NULL, delivery_instructions=NULL WHERE user_id=$1`, [id]);
      await c.query('DELETE FROM addresses WHERE user_id=$1', [id]);
      await c.query('DELETE FROM favourites WHERE user_id=$1', [id]);
      await c.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      await c.query('DELETE FROM carts WHERE user_id=$1', [id]);
      await audit(id, 'account.deleted', 'user', id, {}, c);
    });
    reply.clearCookie('ez_session', { path: '/' });
    return { ok: true };
  });
};
