/** Mirror of apps/api/src/lib/permissions.ts ROLE_PERMS. Only used to hide what a person cannot use; the API always enforces. */
export const ROLE_PERMS: Record<string, string[]> = {
  owner: ['*'],
  admin: ['vendors.manage', 'stores.manage', 'catalog.manage', 'dispatch.manage', 'drivers.manage', 'content.manage', 'promotions.manage',
    'ads.manage', 'crm.manage', 'support.manage', 'orders.view', 'orders.manage', 'users.view', 'reports.view', 'settings.view', 'audit.view', 'refunds.request'],
  support: ['orders.view', 'orders.manage', 'support.manage', 'refunds.request', 'users.view'],
  finance: ['orders.view', 'refunds.approve', 'payouts.manage', 'reports.view', 'ledger.view', 'settings.view', 'audit.view'],
  dispatcher: ['dispatch.manage', 'orders.view', 'orders.manage', 'drivers.manage'],
  catalog: ['catalog.manage'],
};

export const STAFF_ROLES = ['owner', 'admin', 'support', 'finance', 'dispatcher', 'catalog'];

export function permsOf(roles: { role: string }[]) {
  return roles.flatMap((r) => ROLE_PERMS[r.role] ?? []);
}
export function canDo(roles: { role: string }[], ...need: string[]) {
  const p = permsOf(roles);
  return p.includes('*') || need.some((n) => p.includes(n));
}
