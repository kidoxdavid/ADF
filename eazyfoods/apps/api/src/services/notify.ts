import { config } from '../config.js';
import type { Queryable } from '../lib/db-types.js';
import { pool } from '../db/pool.js';

const render = (t: string, vars: Record<string, unknown>) => t.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''));

/** Queue an email (rendered from the editable template). Delivery is done by processOutbox. */
export async function notify(c: Queryable, a: { userId?: string | null; email: string; template: string; vars?: Record<string, unknown>; transactional?: boolean }) {
  const t = (await c.query('SELECT subject, body FROM notification_templates WHERE key = $1', [a.template])).rows[0];
  if (!t) throw new Error(`Unknown notification template ${a.template}`);
  const vars = { ...a.vars, web_url: config.WEB_ORIGIN };
  await c.query(
    `INSERT INTO notifications(user_id, to_email, template, vars, subject, body, transactional) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [a.userId ?? null, a.email, a.template, vars, render(t.subject, vars), render(t.body, vars), a.transactional ?? true]);
}

export async function notifyVendorOwners(c: Queryable, vendorId: string, template: string, vars: Record<string, unknown>) {
  const r = await c.query(`SELECT u.id, u.email FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE ur.vendor_id = $1 AND u.disabled_at IS NULL`, [vendorId]);
  for (const u of r.rows) await notify(c, { userId: u.id, email: u.email, template, vars });
}

async function send(to: string, subject: string, body: string) {
  if (config.EMAIL_TRANSPORT === 'log') {
    if (config.NODE_ENV !== 'test') console.log(`[email:log] to=${to} subject=${subject}`);
    return;
  }
  if (!config.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: config.EMAIL_FROM, to, subject, text: body }),
  });
  if (!res.ok) throw new Error(`email provider responded ${res.status}`);
}

/** Deliver pending notifications. Respects the user's opt-out for non-transactional mail; retries up to 5 times. */
export async function processOutbox(limit = 50) {
  const { rows } = await pool.query(
    `SELECT n.*, u.notify_email FROM notifications n LEFT JOIN users u ON u.id = n.user_id WHERE n.status = 'pending' ORDER BY n.id LIMIT $1 FOR UPDATE OF n SKIP LOCKED`, [limit]);
  let sent = 0;
  for (const n of rows) {
    if (!n.transactional && n.notify_email === false) { await pool.query(`UPDATE notifications SET status='skipped' WHERE id=$1`, [n.id]); continue; }
    try {
      await send(n.to_email, n.subject, n.body);
      await pool.query(`UPDATE notifications SET status='sent', sent_at=now(), attempts=attempts+1 WHERE id=$1`, [n.id]);
      sent++;
    } catch (e: any) {
      await pool.query(`UPDATE notifications SET attempts=attempts+1, error=$2, status = CASE WHEN attempts+1 >= 5 THEN 'failed' ELSE 'pending' END WHERE id=$1`, [n.id, String(e.message)]);
    }
  }
  return sent;
}
