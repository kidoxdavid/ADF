import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate } from '../../api';
import { useAction } from '../../hooks';
import { useToast } from '../../toast';
import { Badge, Button, Card, Confirm, Notice, PageHeader, Select, StatusBadge } from '../../ui';
import { DataTable, Fetch, Need, cents, patch, post } from './common';

export function Dispatch() {
  const toast = useToast();
  const [pick, setPick] = useState<Record<string, string>>({});
  const act = useAction(async (fn: () => Promise<any>, ok: string, reload: () => void) => { await fn(); toast(ok); reload(); });
  return (
    <Need perm={['dispatch.manage']} what="dispatching deliveries">
      <PageHeader title="Dispatch" sub="Assign a driver to each ready delivery. Late jobs are flagged." />
      {act.error && <Notice tone="error">{act.error}</Notice>}
      <Fetch path="/admin/dispatch">{(d: any, reload) => (
        <>
          <Card><h3>Drivers</h3>
            {d.drivers.length ? <div className="row wrap">{d.drivers.map((x: any) => <Badge key={x.id} tone={x.is_available ? 'ok' : 'neutral'}>{x.full_name} · {x.active_jobs} active · {x.is_available ? 'available' : 'off'}</Badge>)}</div>
              : <p className="muted">No approved drivers yet. Approve applicants in <Link to="/admin/drivers">Drivers</Link>.</p>}</Card>
          <DataTable rows={d.jobs} rowKey={(j: any) => j.id} empty="No deliveries to manage right now."
            columns={[
              { key: 'o', header: 'Order', render: (j: any) => <><strong>{j.order_number}</strong>{j.late && <> <Badge tone="danger">Late</Badge></>}</> },
              { key: 's', header: 'Status', render: (j: any) => <StatusBadge status={j.status} /> },
              { key: 'p', header: 'Pick up', render: (j: any) => <>{j.store_name}<div className="small muted">{j.pickup_address}</div></> },
              { key: 'd', header: 'Drop off', render: (j: any) => `${j.dropoff_city ?? ''} ${j.dropoff_postal ?? ''}` },
              { key: 'w', header: 'Promised', render: (j: any) => fmtDate(j.promised_at) },
              { key: 'e', header: 'Driver pay', render: (j: any) => cents(j.earning_cents) },
              { key: 'dr', header: 'Driver', render: (j: any) => j.driver_name ?? <span className="muted">none</span> },
              { key: 'a', header: '', render: (j: any) => (
                ['unassigned', 'assigned', 'failed'].includes(j.status) ? (
                  <div className="row wrap">
                    <Select aria-label="Driver" style={{ minWidth: 150 }} value={pick[j.id] ?? j.driver_id ?? ''} onChange={(e) => setPick((s) => ({ ...s, [j.id]: e.target.value }))}>
                      <option value="">Choose driver…</option>{d.drivers.map((x: any) => <option key={x.id} value={x.id}>{x.full_name}{x.is_available ? '' : ' (off)'} · {x.active_jobs} active</option>)}</Select>
                    <Button size="sm" disabled={!(pick[j.id] ?? j.driver_id)} onClick={() => act.run(() => post(`/admin/deliveries/${j.id}/assign`, { driver_id: pick[j.id] ?? j.driver_id }), 'Driver assigned', reload)}>{j.status === 'assigned' ? 'Reassign' : 'Assign'}</Button>
                    {j.status === 'assigned' && <Button size="sm" variant="ghost" onClick={() => act.run(() => post(`/admin/deliveries/${j.id}/unassign`), 'Unassigned', reload)}>Unassign</Button>}
                  </div>) : <span className="small muted">In progress</span>) },
            ]} />
        </>
      )}</Fetch>
    </Need>
  );
}

export function Drivers() {
  const toast = useToast();
  const act = useAction(async (fn: () => Promise<any>, ok: string, reload: () => void) => { await fn(); toast(ok); reload(); });
  return (
    <Need perm={['drivers.manage']} what="managing drivers">
      <PageHeader title="Drivers" sub="Verify the licence and background check first; the system will not approve a driver until both are verified." />
      {act.error && <Notice tone="error">{act.error}</Notice>}
      <Fetch path="/admin/drivers">{(rows: any[], reload) => (
        <DataTable rows={rows} rowKey={(r) => r.id} empty="No drivers have applied."
          columns={[
            { key: 'n', header: 'Driver', render: (r) => <><strong>{r.full_name}</strong><div className="small muted">{r.email} · {r.phone}{r.vehicle ? ` · ${r.vehicle}` : ''}</div></> },
            { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'l', header: 'Licence verified', render: (r) => <label className="check"><input type="checkbox" checked={r.licence_verified} onChange={(e) => act.run(() => patch(`/admin/drivers/${r.id}`, { licence_verified: e.target.checked }), 'Updated', reload)} />{r.licence_verified ? 'Yes' : 'No'}</label> },
            { key: 'b', header: 'Background check', render: (r) => <label className="check"><input type="checkbox" checked={r.background_check_verified} onChange={(e) => act.run(() => patch(`/admin/drivers/${r.id}`, { background_check_verified: e.target.checked }), 'Updated', reload)} />{r.background_check_verified ? 'Yes' : 'No'}</label> },
            { key: 'j', header: 'Active jobs', render: (r) => r.active_jobs },
            { key: 'a', header: '', render: (r) => (
              <div className="row wrap">
                {r.status !== 'approved' && <Button size="sm" disabled={!(r.licence_verified && r.background_check_verified)} title={!(r.licence_verified && r.background_check_verified) ? 'Verify licence and background check first' : ''} onClick={() => act.run(() => patch(`/admin/drivers/${r.id}`, { status: 'approved' }), 'Driver approved', reload)}>Approve</Button>}
                {r.status === 'approved' && <Confirm size="sm" message={`Suspend ${r.full_name}? They lose access to driver jobs immediately.`} onConfirm={() => act.run(() => patch(`/admin/drivers/${r.id}`, { status: 'suspended' }), 'Driver suspended', reload) as any}>Suspend</Confirm>}
                {r.status === 'applied' && <Button size="sm" variant="ghost" onClick={() => act.run(() => patch(`/admin/drivers/${r.id}`, { status: 'rejected' }), 'Application rejected', reload)}>Reject</Button>}
              </div>) },
          ]} />
      )}</Fetch>
    </Need>
  );
}

