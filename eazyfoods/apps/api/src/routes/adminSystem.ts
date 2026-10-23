import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool, tx } from '../db/pool.js';
import { audit } from '../lib/auth.js';
import { requirePerm, ROLE_PERMS } from '../lib/permissions.js';
import { bad, conflict, notFound } from '../lib/errors.js';
import { config } from '../config.js';
import { getProvider } from '../payments/provider.js';

const uuid = z.string().uuid();
const int = (min: number, max: number) => z.number().int().min(min).max(max);

/** Every commercial rule is configurable, but only within sane, validated ranges. Unknown keys are refused. */
export const SETTING_SCHEMAS: Record<string, z.ZodTypeAny> = {
  'currency': z.literal('CAD'),
  'tax.rates_bps': z.object({ zero_rated: int(0, 3000), standard: int(0, 3000) }),
  'commission.default_bps': int(0, 5000),
  'checkout.reservation_minutes': int(5, 60),
  'vendor.accept_timeout_minutes': int(1, 240),
  'vendor.auto_reject_minutes': int(5, 720),
  'vendor.require_verified_docs': z.boolean(),
  'ordering.require_open': z.boolean(),
  'driver.pay_per_delivery_cents': int(0, 10000),
  'payout.hold_days': int(0, 30),
  'ads.min_cpc_cents': int(1, 5000),
  'ads.min_budget_cents': int(100, 1000000),
  'vendor.agreement_version': z.string().min(1).max(40),
};

export const adminSystemRoutes: FastifyPluginAsync = async (app) => {
  // ---------- Settings ----------
  app.get('/settings', { preHandler: requirePerm('settings.view') }, async () => (await pool.query('SELECT key, value, updated_at FROM app_settings ORDER BY key')).rows.filter((r) => r.key in SETTING_SCHEMAS));

  app.put<{ Params: { key: string } }>('/settings/:key', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const key = req.params.key;
    const schema = SETTING_SCHEMAS[key];
    if (!schema) throw notFound('Unknown setting');
    const value = schema.parse((req.body as any)?.value);
    return tx(async (c) => {
      const old = (await c.query('SELECT value FROM app_settings WHERE key = $1 FOR UPDATE', [key])).rows[0]?.value;
      await c.query('INSERT INTO app_settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()', [key, JSON.stringify(value)]);
      await audit(req.user!.id, 'setting.changed', 'setting', key, { old, new: value }, c);
      return { key, value };
    });
  });

  // ---------- Users & roles ----------
  app.get('/users', { preHandler: requirePerm('users.view') }, async (req) => {
    const { q } = z.object({ q: z.string().max(80).optional() }).parse(req.query);
    return (await pool.query(
      `SELECT u.id, u.email, u.full_name, u.created_at, u.disabled_at IS NOT NULL AS disabled,
              COALESCE(array_agg(DISTINCT r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
         FROM users u LEFT JOIN user_roles r ON r.user_id = u.id WHERE $1::text IS NULL OR u.email ILIKE '%'||$1||'%' OR u.full_name ILIKE '%'||$1||'%' GROUP BY u.id ORDER BY u.created_at DESC LIMIT 100`, [q ?? null])).rows;
  });

  app.post<{ Params: { id: string } }>('/users/:id/roles', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const id = uuid.parse(req.params.id);
    const { role } = z.object({ role: z.enum(['owner', 'admin', 'support', 'finance', 'dispatcher', 'catalog']) }).parse(req.body);
    await pool.query('INSERT INTO user_roles(user_id, role) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, role]);
    await audit(req.user!.id, 'role.granted', 'user', id, { role });
    return { ok: true };
  });
  app.delete<{ Params: { id: string; role: string } }>('/users/:id/roles/:role', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const id = uuid.parse(req.params.id);
    const role = z.enum(['owner', 'admin', 'support', 'finance', 'dispatcher', 'catalog']).parse(req.params.role);
    if (role === 'owner') {
      const n = (await pool.query(`SELECT count(*)::int n FROM user_roles WHERE role = 'owner'`)).rows[0].n;
      if (n <= 1) throw conflict('last_owner', 'There must always be at least one owner.');
    }
    await pool.query('DELETE FROM user_roles WHERE user_id = $1 AND role = $2', [id, role]);
    await audit(req.user!.id, 'role.revoked', 'user', id, { role });
    return { ok: true };
  });
  app.get('/roles', { preHandler: requirePerm('users.view') }, async () => ROLE_PERMS);
  app.patch<{ Params: { id: string } }>('/users/:id/disabled', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const id = uuid.parse(req.params.id);
    const { disabled } = z.object({ disabled: z.boolean() }).parse(req.body);
    if (id === req.user!.id) throw bad('self', 'You cannot disable your own account.');
    await pool.query('UPDATE users SET disabled_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1', [id, disabled]);
    if (disabled) await pool.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await audit(req.user!.id, disabled ? 'user.disabled' : 'user.enabled', 'user', id);
    return { ok: true };
  });

  // Payout account (set after Stripe Connect onboarding; finance only).
  app.patch<{ Params: { id: string } }>('/vendors/:id/payout-account', { preHandler: requirePerm('payouts.manage') }, async (req) => {
    const { stripe_account_id } = z.object({ stripe_account_id: z.string().regex(/^acct_[A-Za-z0-9]+$/).nullable() }).parse(req.body);
    const r = await pool.query('UPDATE vendors SET stripe_account_id = $2 WHERE id = $1 RETURNING id', [uuid.parse(req.params.id), stripe_account_id]);
    if (!r.rowCount) throw notFound('Vendor not found');
    await audit(req.user!.id, 'vendor.payout_account_set', 'vendor', req.params.id, { connected: !!stripe_account_id });
    return { ok: true };
  });

  // ---------- Audit log ----------
  app.get('/audit', { preHandler: requirePerm('audit.view') }, async (req) => {
    const q = z.object({ entity_type: z.string().optional(), action: z.string().optional() }).parse(req.query);
    return (await pool.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.detail, a.created_at, u.email AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE ($1::text IS NULL OR a.entity_type = $1) AND ($2::text IS NULL OR a.action LIKE $2 || '%') ORDER BY a.id DESC LIMIT 200`, [q.entity_type ?? null, q.action ?? null])).rows;
  });

  // ---------- System health & integration status ----------
  app.get('/system', { preHandler: requirePerm('settings.view', 'orders.view') }, async () => {
    const one = async (sql: string) => (await pool.query(sql)).rows[0];
    const [db, outbox, stale, anomalies, lastEvent, jobs] = await Promise.all([
      one('SELECT now() AS now'),
      one(`SELECT count(*) FILTER (WHERE status='pending')::int AS pending, count(*) FILTER (WHERE status='failed')::int AS failed FROM notifications`),
      one(`SELECT count(*)::int AS n FROM inventory_reservations WHERE status='held' AND expires_at < now() - interval '5 minutes'`),
      one(`SELECT count(*)::int AS n FROM payment_events WHERE outcome IN ('amount_mismatch','unknown_payment') AND received_at > now() - interval '24 hours'`),
      one(`SELECT max(received_at) AS at FROM payment_events`),
      one(`SELECT count(*)::int AS n FROM payments WHERE status = 'requires_payment' AND created_at < now() - interval '1 hour'`),
    ]);
    const errors = (await pool.query('SELECT id, message, method, url, created_at FROM error_events ORDER BY id DESC LIMIT 20')).rows;
    const errors24 = (await pool.query(`SELECT count(*)::int n FROM error_events WHERE created_at > now() - interval '24 hours'`)).rows[0].n;
    const provider = getProvider();
    const integ = (name: string, configured: boolean, note: string) => ({ name, configured, note });
    return {
      database: { ok: true, time: db.now },
      checks: [
        { name: 'Email outbox backlog', ok: outbox.pending < 50, detail: `${outbox.pending} pending, ${outbox.failed} failed` },
        { name: 'Expired stock holds not released', ok: stale.n === 0, detail: `${stale.n} stale (the background job should clear these)` },
        { name: 'Payment anomalies (24h)', ok: anomalies.n === 0, detail: `${anomalies.n} mismatched or unknown provider events` },
        { name: 'Server errors (24h)', ok: errors24 === 0, detail: `${errors24} logged` },
        { name: 'Payments waiting over an hour', ok: jobs.n < 20, detail: `${jobs.n}` },
      ],
      last_payment_event_at: lastEvent.at, errors_24h: errors24, recent_errors: errors,
      integrations: [
        integ('Payments', provider.name === 'stripe', provider.name === 'mock' ? 'DEVELOPMENT MOCK. No real payments can be taken.' : 'Stripe configured. Verify with the test-mode checklist in docs/PAYMENTS.md.'),
        integ('Email', config.EMAIL_TRANSPORT === 'resend' && !!config.RESEND_API_KEY, config.EMAIL_TRANSPORT === 'log' ? 'Emails are only logged, not sent.' : 'Resend configured.'),
        integ('Error monitoring', !!config.SENTRY_DSN, config.SENTRY_DSN ? 'Sentry enabled.' : 'Not configured (set SENTRY_DSN).'),
        integ('Image storage', false, 'Local disk. Move to S3-compatible storage before running more than one server.'),
        integ('Background jobs', !config.DISABLE_BACKGROUND_JOBS, config.DISABLE_BACKGROUND_JOBS ? 'Disabled.' : 'Running in-process (expiry, email, vendor timeouts).'),
      ],
    };
  });

  // ---------- Vendor-sales CRM (internal) ----------
  const crm = requirePerm('crm.manage');
  const stage = z.enum(['identified', 'contacted', 'demo', 'onboarding', 'launched', 'lost']);
  app.get('/crm/prospects', { preHandler: crm }, async (req) => {
    const { stage: s } = z.object({ stage: stage.optional() }).parse(req.query);
    return (await pool.query(`SELECT id, business_name, contact_name, phone, email, address, regions, source, stage, next_action, next_action_at, last_contact_at, vendor_id, created_at,
        (next_action_at IS NOT NULL AND next_action_at < now() AND stage NOT IN ('launched','lost')) AS overdue FROM vendor_prospects WHERE ($1::text IS NULL OR stage = $1) ORDER BY (next_action_at IS NULL), next_action_at, created_at DESC LIMIT 300`, [s ?? null])).rows;
  });
  app.post('/crm/prospects', { preHandler: crm }, async (req, reply) => {
    const b = z.object({ business_name: z.string().min(2).max(160), contact_name: z.string().max(120).optional(), phone: z.string().max(30).optional(), email: z.string().email().optional(), address: z.string().max(200).optional(),
      regions: z.array(z.string()).default([]), source: z.string().max(80).optional(), next_action: z.string().max(200).optional(), next_action_at: z.coerce.date().optional() }).parse(req.body);
    const r = await pool.query(`INSERT INTO vendor_prospects(business_name, contact_name, phone, email, address, regions, source, next_action, next_action_at, owner_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [b.business_name, b.contact_name ?? null, b.phone ?? null, b.email ?? null, b.address ?? null, b.regions, b.source ?? null, b.next_action ?? null, b.next_action_at ?? null, req.user!.id]);
    return reply.code(201).send({ id: r.rows[0].id });
  });
  app.get<{ Params: { id: string } }>('/crm/prospects/:id', { preHandler: crm }, async (req) => {
    const id = uuid.parse(req.params.id);
    const p = (await pool.query('SELECT * FROM vendor_prospects WHERE id = $1', [id])).rows[0];
    if (!p) throw notFound('Prospect not found');
    const acts = (await pool.query(`SELECT a.id, a.kind, a.note, a.created_at, u.full_name AS by FROM prospect_activities a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.prospect_id = $1 ORDER BY a.id DESC`, [id])).rows;
    return { ...p, activities: acts };
  });
  app.patch<{ Params: { id: string } }>('/crm/prospects/:id', { preHandler: crm }, async (req) => {
    const id = uuid.parse(req.params.id);
    const b = z.object({ stage: stage.optional(), next_action: z.string().max(200).nullable().optional(), next_action_at: z.coerce.date().nullable().optional(), vendor_id: uuid.nullable().optional() }).parse(req.body);
    await tx(async (c) => {
      const cur = (await c.query('SELECT stage FROM vendor_prospects WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!cur) throw notFound('Prospect not found');
      await c.query(`UPDATE vendor_prospects SET stage = COALESCE($2, stage), next_action = CASE WHEN $3 THEN $4 ELSE next_action END, next_action_at = CASE WHEN $5 THEN $6 ELSE next_action_at END,
        vendor_id = CASE WHEN $7 THEN $8::uuid ELSE vendor_id END, launched_at = CASE WHEN $2 = 'launched' THEN COALESCE(launched_at, now()) ELSE launched_at END WHERE id = $1`,
        [id, b.stage ?? null, b.next_action !== undefined, b.next_action ?? null, b.next_action_at !== undefined, b.next_action_at ?? null, b.vendor_id !== undefined, b.vendor_id ?? null]);
      if (b.stage && b.stage !== cur.stage) await c.query(`INSERT INTO prospect_activities(prospect_id, kind, note, actor_user_id) VALUES ($1,'stage_change',$2,$3)`, [id, `${cur.stage} → ${b.stage}`, req.user!.id]);
    });
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/crm/prospects/:id/activities', { preHandler: crm }, async (req, reply) => {
    const id = uuid.parse(req.params.id);
    const b = z.object({ kind: z.enum(['call', 'visit', 'email', 'demo', 'note']), note: z.string().min(1).max(2000), next_action: z.string().max(200).optional(), next_action_at: z.coerce.date().optional() }).parse(req.body);
    await tx(async (c) => {
      await c.query('INSERT INTO prospect_activities(prospect_id, kind, note, actor_user_id) VALUES ($1,$2,$3,$4)', [id, b.kind, b.note, req.user!.id]);
      await c.query(`UPDATE vendor_prospects SET last_contact_at = CASE WHEN $2 <> 'note' THEN now() ELSE last_contact_at END, stage = CASE WHEN stage = 'identified' AND $2 <> 'note' THEN 'contacted' ELSE stage END,
        next_action = COALESCE($3, next_action), next_action_at = COALESCE($4, next_action_at) WHERE id = $1`, [id, b.kind, b.next_action ?? null, b.next_action_at ?? null]);
    });
    return reply.code(201).send({ ok: true });
  });
};
