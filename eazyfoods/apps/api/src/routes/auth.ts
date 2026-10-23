import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { COOKIE, createSession } from '../lib/auth.js';
import { rl } from '../lib/ratelimit.js';
import { hashPassword, hashToken, newToken, verifyPassword } from '../lib/password.js';
import { config } from '../config.js';
import { notify } from '../services/notify.js';

const creds = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
});
const DUMMY = await hashPassword('timing-equalizer');

async function issueToken(userId: string, kind: 'password_reset' | 'email_verify', hours: number) {
  const t = newToken();
  await pool.query(`UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND kind = $2 AND used_at IS NULL`, [userId, kind]);
  await pool.query(`INSERT INTO auth_tokens(user_id, kind, token_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(hours => $4))`, [userId, kind, hashToken(t), hours]);
  return t;
}
async function sendVerification(userId: string, email: string) {
  const t = await issueToken(userId, 'email_verify', 48);
  await notify(pool, { userId, email, template: 'email_verify', vars: { link: `${config.WEB_ORIGIN}/verify?token=${t}` } });
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  const limit = rl(10, '1 minute');

  app.post('/register', limit, async (req, reply) => {
    const body = creds.extend({ full_name: z.string().min(1).max(120) }).parse(req.body);
    const hash = await hashPassword(body.password);
    try {
      const u = await pool.query('INSERT INTO users(email,password_hash,full_name) VALUES ($1,$2,$3) RETURNING id', [body.email, hash, body.full_name]);
      await pool.query(`INSERT INTO user_roles(user_id, role) VALUES ($1,'customer')`, [u.rows[0].id]);
      await createSession(u.rows[0].id, reply);
      await sendVerification(u.rows[0].id, body.email).catch(() => {});
      return reply.code(201).send({ id: u.rows[0].id, email: body.email, full_name: body.full_name });
    } catch (e: any) {
      if (e.code === '23505') return reply.code(409).send({ error: 'email_taken', message: 'An account with this email already exists.' });
      throw e;
    }
  });

  app.post('/login', limit, async (req, reply) => {
    const body = creds.parse(req.body);
    const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE email = $1 AND disabled_at IS NULL', [body.email]);
    const ok = await verifyPassword(body.password, rows[0]?.password_hash ?? DUMMY);
    if (!rows[0] || !ok) return reply.code(401).send({ error: 'invalid_credentials', message: 'Email or password is incorrect.' });
    await createSession(rows[0].id, reply);
    return { ok: true };
  });

  app.post('/logout', async (req, reply) => {
    const t = req.cookies[COOKIE];
    if (t) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(t)]);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  // Anonymous visitors are a normal state, not an error.
  app.get('/me', async (req) => req.user);

  // Always answers the same way so the form cannot be used to discover which emails have accounts.
  app.post('/forgot', limit, async (req) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const u = (await pool.query('SELECT id FROM users WHERE email = $1 AND disabled_at IS NULL', [email])).rows[0];
    if (u) {
      const t = await issueToken(u.id, 'password_reset', 1);
      await notify(pool, { userId: u.id, email, template: 'password_reset', vars: { link: `${config.WEB_ORIGIN}/reset?token=${t}` } });
    }
    return { ok: true, message: 'If that email has an account, we have sent a reset link.' };
  });

  app.post('/reset', limit, async (req, reply) => {
    const b = z.object({ token: z.string().min(20).max(100), password: z.string().min(10).max(200) }).parse(req.body);
    const hash = await hashPassword(b.password);
    const r = await pool.query(
      `UPDATE auth_tokens SET used_at = now() WHERE token_hash = $1 AND kind = 'password_reset' AND used_at IS NULL AND expires_at > now() RETURNING user_id`, [hashToken(b.token)]);
    if (!r.rowCount) return reply.code(400).send({ error: 'invalid_token', message: 'This link is invalid or has expired. Request a new one.' });
    await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [r.rows[0].user_id, hash]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [r.rows[0].user_id]);
    return { ok: true };
  });

  app.post('/verify/request', limit, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthenticated' });
    await sendVerification(req.user.id, req.user.email);
    return { ok: true };
  });
  app.post('/verify', limit, async (req, reply) => {
    const { token } = z.object({ token: z.string().min(20).max(100) }).parse(req.body);
    const r = await pool.query(`UPDATE auth_tokens SET used_at = now() WHERE token_hash = $1 AND kind = 'email_verify' AND used_at IS NULL AND expires_at > now() RETURNING user_id`, [hashToken(token)]);
    if (!r.rowCount) return reply.code(400).send({ error: 'invalid_token', message: 'This link is invalid or has expired.' });
    await pool.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [r.rows[0].user_id]);
    return { ok: true };
  });
};
