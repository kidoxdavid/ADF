import type { FastifyReply, FastifyRequest } from 'fastify';
import { pool } from '../db/pool.js';
import { config, isProd } from '../config.js';
import { hashToken, newToken } from './password.js';

export const COOKIE = 'ez_session';

export type Role = { role: string; vendor_id: string | null };
export type AuthUser = { id: string; email: string; full_name: string; roles: Role[] };

declare module 'fastify' {
  interface FastifyRequest { user: AuthUser | null }
}

export async function createSession(userId: string, reply: FastifyReply) {
  const token = newToken();
  const expires = new Date(Date.now() + config.SESSION_DAYS * 86400_000);
  await pool.query('INSERT INTO sessions(user_id, token_hash, expires_at) VALUES ($1,$2,$3)', [userId, hashToken(token), expires]);
  reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: isProd || config.WEB_ORIGIN.startsWith('https'), path: '/', expires });
}

export async function loadUser(req: FastifyRequest) {
  req.user = null;
  const token = req.cookies[COOKIE];
  if (!token) return;
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.full_name,
            COALESCE(json_agg(json_build_object('role', r.role, 'vendor_id', r.vendor_id)) FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
       FROM sessions s JOIN users u ON u.id = s.user_id AND u.disabled_at IS NULL
       LEFT JOIN user_roles r ON r.user_id = u.id
      WHERE s.token_hash = $1 AND s.expires_at > now()
      GROUP BY u.id`,
    [hashToken(token)],
  );
  if (rows[0]) req.user = rows[0];
}

export function requireUser(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) { reply.code(401).send({ error: 'unauthenticated' }); return false; }
  return true;
}

export const hasRole = (u: AuthUser, role: string) => u.roles.some((r) => r.role === role);

/** Resource-level check: user must be an owner/staff of the vendor that owns the store, or an admin. */
export async function canManageStore(u: AuthUser, storeId: string): Promise<boolean> {
  if (hasRole(u, 'admin')) return true;
  const vendorIds = u.roles.filter((r) => r.vendor_id).map((r) => r.vendor_id);
  if (!vendorIds.length) return false;
  const { rowCount } = await pool.query('SELECT 1 FROM stores WHERE id = $1 AND vendor_id = ANY($2::uuid[])', [storeId, vendorIds]);
  return !!rowCount;
}

export async function audit(actor: string | null, action: string, entityType: string, entityId: string, detail: object = {}, c: { query: typeof pool.query } = pool) {
  await c.query('INSERT INTO audit_log(actor_user_id, action, entity_type, entity_id, detail) VALUES ($1,$2,$3,$4,$5)', [actor, action, entityType, entityId, detail]);
}
