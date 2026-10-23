import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from './auth.js';

/**
 * Staff roles carry explicit permissions; nobody is "just admin". `owner` is the only wildcard role.
 */
export const ROLE_PERMS: Record<string, string[]> = {
  owner: ['*'],
  admin: ['vendors.manage', 'stores.manage', 'catalog.manage', 'dispatch.manage', 'drivers.manage', 'content.manage', 'promotions.manage',
    'ads.manage', 'crm.manage', 'support.manage', 'orders.view', 'orders.manage', 'users.view', 'reports.view', 'settings.view', 'audit.view', 'refunds.request'],
  support: ['orders.view', 'orders.manage', 'support.manage', 'refunds.request', 'users.view'],
  finance: ['orders.view', 'refunds.approve', 'payouts.manage', 'reports.view', 'ledger.view', 'settings.view', 'audit.view'],
  dispatcher: ['dispatch.manage', 'orders.view', 'orders.manage', 'drivers.manage'],
  catalog: ['catalog.manage'],
};

export const can = (u: AuthUser | null, perm: string) =>
  !!u && u.roles.some((r) => ROLE_PERMS[r.role]?.includes('*') || ROLE_PERMS[r.role]?.includes(perm));

export const isStaff = (u: AuthUser | null) => !!u && u.roles.some((r) => r.role in ROLE_PERMS);

/** Fastify preHandler factory. Responds 401/403 itself. */
export const requirePerm = (...perms: string[]) => async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.user) return reply.code(401).send({ error: 'unauthenticated' });
  if (!perms.some((p) => can(req.user, p))) return reply.code(403).send({ error: 'forbidden', message: 'Your role does not allow this action.' });
};

export const requireLogin = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.user) return reply.code(401).send({ error: 'unauthenticated', message: 'Please sign in.' });
};
