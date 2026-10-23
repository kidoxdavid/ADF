import { useState } from 'react';

import { useAction, useApi } from '../../hooks';
import { useToast } from '../../toast';
import { Badge, Button, Field, Input, Modal, Notice, PageHeader } from '../../ui';
import { CheckList, DataTable, Fetch, Need, cents, lines, post, put, useForm } from './common';

export function Zones() {
  const toast = useToast();
  const stores = useApi<any[]>('/admin/stores');
  const [edit, setEdit] = useState<any | null>(null);
  const f = useForm({ name: '', fee: '5.99', free_over: '', eta: '90', is_active: true, fsas: '' });
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const open = (z: any | null) => { setEdit(z ?? {}); f.setV({ name: z?.name ?? '', fee: z ? (z.fee_cents / 100).toFixed(2) : '5.99', free_over: z?.free_over_cents ? (z.free_over_cents / 100).toFixed(2) : '', eta: String(z?.eta_minutes ?? 90), is_active: z?.is_active ?? true, fsas: (z?.fsas ?? []).join(' ') }); setStoreIds(z?.store_ids ?? []); };
  const save = useAction(async (reload: () => void) => {
    const body = { name: f.v.name, fee_cents: Math.round(Number(f.v.fee) * 100), free_over_cents: f.v.free_over ? Math.round(Number(f.v.free_over) * 100) : null, eta_minutes: Number(f.v.eta), is_active: f.v.is_active,
      fsas: f.v.fsas.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean), store_ids: storeIds };
    if (edit?.id) await put(`/admin/zones/${edit.id}`, body); else await post('/admin/zones', body);
    toast('Zone saved'); setEdit(null); reload();
  });
  return (
    <Need perm={['stores.manage']} what="managing delivery zones">
      <PageHeader title="Delivery zones" sub="A postal code’s first three characters (FSA) decide which zone, fee and arrival estimate applies. Fee is charged per store." />
      <Fetch path="/admin/zones">{(rows: any[], reload) => (
        <>
          <div className="row end" style={{ marginTop: 0, marginBottom: 10 }}><Button onClick={() => open(null)}>New zone</Button></div>
          <DataTable rows={rows} rowKey={(z) => z.id} onRowClick={open} empty="No delivery zones. Without a zone nobody can choose delivery."
            columns={[{ key: 'name', header: 'Zone', render: (z) => <strong>{z.name}</strong> }, { key: 'active', header: 'State', render: (z) => (z.is_active ? <Badge tone="ok">Active</Badge> : <Badge>Off</Badge>) },
              { key: 'fee', header: 'Fee per store', render: (z) => <>{cents(z.fee_cents)}{z.free_over_cents ? <span className="small muted"> · free over {cents(z.free_over_cents)}</span> : null}</> },
              { key: 'eta', header: 'Estimate', render: (z) => `${z.eta_minutes} min` }, { key: 'fsas', header: 'Postal areas', render: (z) => `${z.fsas.length}` }, { key: 'st', header: 'Stores', render: (z) => `${z.store_ids.length}` }]} />
          <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name}` : 'New zone'}>
            {save.error && <Notice tone="error">{save.error}</Notice>}
            <Field label="Name"><Input value={f.v.name} onChange={f.set('name')} /></Field>
            <div className="form-grid">
              <Field label="Delivery fee ($ per store)"><Input inputMode="decimal" value={f.v.fee} onChange={f.set('fee')} /></Field>
              <Field label="Free over ($, optional)" hint="Per store subtotal"><Input inputMode="decimal" value={f.v.free_over} onChange={f.set('free_over')} /></Field>
              <Field label="Arrival estimate (minutes)"><Input inputMode="numeric" value={f.v.eta} onChange={f.set('eta')} /></Field>
            </div>
            <Field label="Postal areas (FSA)" hint="3 characters each, e.g. T2A T2B. An area can only be in one zone."><Input value={f.v.fsas} onChange={f.set('fsas')} /></Field>
            <p className="small muted">{lines(f.v.fsas.replace(/\s+/g, ',')).length} areas</p>
            <strong>Stores that deliver here</strong>
            <CheckList options={(stores.data ?? []).map((s: any) => ({ value: s.id, label: s.name }))} value={storeIds} onChange={setStoreIds} />
            <label className="check"><input type="checkbox" checked={f.v.is_active} onChange={f.set('is_active')} />Zone is active</label>
            <div className="row end"><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button busy={save.busy} disabled={f.v.name.length < 2} onClick={() => save.run(reload)}>Save</Button></div>
          </Modal>
        </>
      )}</Fetch>
    </Need>
  );
}
