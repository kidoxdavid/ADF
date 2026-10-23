import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Loading, Notice } from './ui';

/** Requires sign-in; optionally one of `roles` (any match). Redirects to sign-in, remembering where the person was going. */
export function RequireAuth({ children, roles, fallback }: { children: ReactNode; roles?: string[]; fallback?: ReactNode }) {
  const { me, ready, has } = useAuth();
  const loc = useLocation();
  if (!ready) return <div className="wrap"><Loading /></div>;
  if (!me) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (roles && !roles.some((r) => has(r))) return <>{fallback ?? <div className="wrap"><Notice tone="warn">You do not have access to this area. If you think you should, ask the account owner to check your role.</Notice></div>}</>;
  return <>{children}</>;
}
