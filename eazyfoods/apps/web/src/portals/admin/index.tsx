import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../auth';
import { PortalLayout, type NavItem } from '../../ui';
import { NoAccess } from './common';
import { canDo, STAFF_ROLES } from './perms';
import './admin.css';
import { Dashboard } from './Dashboard';
import { Vendors, VendorDetail, StoresAdmin } from './Vendors';
import { Catalogue, ProductEditor } from './Catalogue';
import { Taxonomy } from './Taxonomy';
import { Zones } from './Zones';
import { Orders, OrderDetail } from './Orders';
import { Refunds } from './Refunds';
import { Dispatch, Drivers } from './Dispatch';
import { Support, TicketDetail } from './Support';
import { Promotions } from './Promotions';
import { Ads } from './Ads';
import { Content } from './Content';
import { Crm, ProspectDetail } from './Crm';
import { Finance } from './Finance';
import { Reports } from './Reports';
import { Settings } from './Settings';
import { System } from './System';

type Item = NavItem & { need: string[]; any?: boolean };
const ITEMS: Item[] = [
  { to: '/admin', label: 'Dashboard', end: true, need: ['orders.view', 'dispatch.manage', 'support.manage', 'reports.view'] },
  { to: '/admin/orders', label: 'Orders', need: ['orders.view'] },
  { to: '/admin/dispatch', label: 'Dispatch', need: ['dispatch.manage'] },
  { to: '/admin/drivers', label: 'Drivers', need: ['drivers.manage'] },
  { to: '/admin/support', label: 'Support', need: ['support.manage'] },
  { to: '/admin/refunds', label: 'Refunds', need: ['refunds.approve', 'refunds.request'] },
  { to: '/admin/vendors', label: 'Vendors', need: ['vendors.manage'] },
  { to: '/admin/stores', label: 'Stores', need: ['stores.manage'] },
  { to: '/admin/catalogue', label: 'Catalogue', need: ['catalog.manage'] },
  { to: '/admin/taxonomy', label: 'Taxonomy', need: ['catalog.manage'] },
  { to: '/admin/zones', label: 'Delivery zones', need: ['stores.manage'] },
  { to: '/admin/promotions', label: 'Promotions', need: ['promotions.manage'] },
  { to: '/admin/ads', label: 'Advertising', need: ['ads.manage'] },
  { to: '/admin/content', label: 'Content', need: ['content.manage'] },
  { to: '/admin/crm', label: 'Vendor pipeline', need: ['crm.manage'] },
  { to: '/admin/finance', label: 'Finance', need: ['ledger.view', 'payouts.manage'] },
  { to: '/admin/reports', label: 'Reports', need: ['reports.view'] },
  { to: '/admin/settings', label: 'Settings & access', need: ['settings.view', 'users.view'] },
  { to: '/admin/system', label: 'System & audit', need: ['settings.view', 'orders.view', 'audit.view'] },
];

/** Each role lands on the screen most useful to it. */
const LANDING: [string, string][] = [['owner', '/admin'], ['admin', '/admin'], ['support', '/admin/support'], ['finance', '/admin/finance'], ['dispatcher', '/admin/dispatch'], ['catalog', '/admin/catalogue']];

export default function Admin() {
  const { me } = useAuth();
  const roles = me?.roles ?? [];
  if (!roles.some((r) => STAFF_ROLES.includes(r.role)))
    return <div className="wrap" style={{ paddingTop: 24 }}><NoAccess what="the admin console" /></div>;
  const nav = ITEMS.filter((i) => canDo(roles, ...i.need));
  const landing = LANDING.find(([r]) => roles.some((x) => x.role === r))?.[1] ?? nav[0]?.to ?? '/admin';
  return (
    <PortalLayout title="Admin" subtitle={roles.filter((r) => STAFF_ROLES.includes(r.role)).map((r) => r.role).join(', ')} nav={nav}>
      <Routes>
        <Route index element={landing === '/admin' ? <Dashboard /> : <Navigate to={landing} replace />} />
        <Route path="orders" element={<Orders />} /><Route path="orders/:id" element={<OrderDetail />} />
        <Route path="dispatch" element={<Dispatch />} /><Route path="drivers" element={<Drivers />} />
        <Route path="support" element={<Support />} /><Route path="support/:id" element={<TicketDetail />} />
        <Route path="refunds" element={<Refunds />} />
        <Route path="vendors" element={<Vendors />} /><Route path="vendors/:id" element={<VendorDetail />} /><Route path="stores" element={<StoresAdmin />} />
        <Route path="catalogue" element={<Catalogue />} /><Route path="catalogue/:id" element={<ProductEditor />} /><Route path="taxonomy" element={<Taxonomy />} />
        <Route path="zones" element={<Zones />} /><Route path="promotions" element={<Promotions />} /><Route path="ads" element={<Ads />} />
        <Route path="content" element={<Content />} />
        <Route path="crm" element={<Crm />} /><Route path="crm/:id" element={<ProspectDetail />} />
        <Route path="finance" element={<Finance />} /><Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} /><Route path="system" element={<System />} />
        <Route path="*" element={<NoAccess what="this page" />} />
      </Routes>
    </PortalLayout>
  );
}
