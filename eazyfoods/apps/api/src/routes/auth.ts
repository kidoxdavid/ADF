import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { COOKIE, createSession } from '../lib/auth.js';
import { hashPassword, hashToken, verifyPassword } from '../lib/password.js';

const creds = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
});
const DUMMY = await hashPassword('timing-equalizer');

export const authRoutes: FastifyPluginAsync = async (app) => {
  const limit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/register', limit, async (req, reply) => {
    const body = creds.extend({ full_name: z.string().min(1).max(120) }).parse(req.body);
    const hash = await hashPassword(body.password);
    try {
      const u = await pool.query('INSERT INTO users(email,password_hash,full_name) VALUES ($1,$2,$3) RETURNING id', [body.email, hash, body.full_name]);
      await pool.query(`INSERT INTO user_roles(user_id, role) VALUES ($1,'customer')`, [u.rows[0].id]);
      await createSession(u.rows[0].id, reply);
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
};
