import { useState } from 'react';
import { fmtDate } from '../../api';
import { useAction } from '../../hooks';
import { useToast } from '../../toast';
import { Badge, Button, Field, Input, Modal, Notice, PageHeader, Select } from '../../ui';
import { DataTable, Fetch, Need, cents, patch, post, useForm } from './common';

export function Promotions() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const f = useForm({ code: '', description: '', kind: 'percent', value: '10', min: '0', cap: '', first: false, starts: '', ends: '', max: '', per_user: '1' });
  const toggle = useAction(async (id: string, on: boolean, reload: () => void) => { await patch(`/admin/coupons/${id}`, { is_active: on }); toast(on ? 'Coupon enabled' : 'Coupon disabled'); reload(); });
  const create = useAction(async (reload: () => void) => {
    const v = f.v;
    await post('/admin/coupons', {
      code: v.code, description: v.description || undefined, kind: v.kind, value: v.kind === 'percent' ? Number(v.value) : Math.round(Number(v.value) * 100),
      min_subtotal_cents: Math.round(Number(v.min || 0) * 100), max_discount_cents: v.cap ? Math.round(Number(v.cap) * 100) : null, first_order_only: v.first,
      starts_at: v.starts ? new Date(v.starts).toISOString() : null, ends_at: v.ends ? new Date(v.ends).toISOString() : null, max_redemptions: v.max ? Number(v.max) : null, per_user_limit: Number(v.per_user || 1),
    });
    toast('Coupon created'); setOpen(false); reload();
  });
  return (
    <Need perm={['promotions.manage']} what="managing promotions">
      <PageHeader title="Promotions" sub="Coupons are funded by EAZyfoods: they lower what the customer pays but do not reduce a store’s earnings." actions={<Button onClick={() => setOpen(true)}>New coupon</Button>} />
      <Fetch path="/admin/coupons">{(rows: any[], reload) => (
        <>
          {toggle.error && <Notice tone="error">{toggle.error}</Notice>}
          <DataTable rows={rows} rowKey={(r) => r.id} empty="No coupons yet."
            columns={[
              { key: 'c', header: 'Code', render: (r) => <><strong>{r.code}</strong><div className="small muted">{r.description}</div></> },
              { key: 'v', header: 'Discount', render: (r) => (r.kind === 'percent' ? `${r.value}%${r.max_discount_cents ? ` (max ${cents(r.max_discount_cents)})` : ''}` : cents(r.value)) },
              { key: 'm', header: 'Rules', render: (r) => <span className="small">{r.min_subtotal_cents ? `min ${cents(r.min_subtotal_cents)} · ` : ''}{r.first_order_only ? 'first order only · ' : ''}{r.per_user_limit}/customer{r.max_redemptions ? ` · ${r.max_redemptions} total` : ''}</span> },
              { key: 'd', header: 'Dates', render: (r) => (r.starts_at || r.ends_at ? `${r.starts_at ? fmtDate(r.starts_at, { dateStyle: 'medium' }) : '…'} to ${r.ends_at ? fmtDate(r.ends_at, { dateStyle: 'medium' }) : '…'}` : 'Always') },
              { key: 'u', header: 'Used', render: (r) => r.redemptions }, { key: 's', header: 'State', render: (r) => (r.is_active ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>) },
              { key: 'a', header: '', render: (r) => <Button size="sm" variant="secondary" onClick={() => toggle.run(r.id, !r.is_active, reload)}>{r.is_active ? 'Disable' : 'Enable'}</Button> },
            ]} />
          <Modal open={open} onClose={() => setOpen(false)} title="New coupon">
            {create.error && <Notice tone="error">{create.error}</Notice>}
            <div className="form-grid">
              <Field label="Code" hint="Letters, numbers, - and _ (not case sensitive)"><Input value={f.v.code} onChange={f.set('code')} /></Field>
              <Field label="Type"><Select value={f.v.kind} onChange={f.set('kind')}><option value="percent">Percent off</option><option value="fixed">Fixed amount off</option></Select></Field>
              <Field label={f.v.kind === 'percent' ? 'Percent (1–100)' : 'Amount ($)'}><Input inputMode="decimal" value={f.v.value} onChange={f.set('value')} /></Field>
              <Field label="Minimum spend ($)"><Input inputMode="decimal" value={f.v.min} onChange={f.set('min')} /></Field>
              <Field label="Maximum discount ($, optional)"><Input inputMode="decimal" value={f.v.cap} onChange={f.set('cap')} /></Field>
              <Field label="Uses per customer"><Input inputMode="numeric" value={f.v.per_user} onChange={f.set('per_user')} /></Field>
              <Field label="Total uses (optional)"><Input inputMode="numeric" value={f.v.max} onChange={f.set('max')} /></Field>
              <Field label="Starts (optional)"><Input type="datetime-local" value={f.v.starts} onChange={f.set('starts')} /></Field>
              <Field label="Ends (optional)"><Input type="datetime-local" value={f.v.ends} onChange={f.set('ends')} /></Field>
            </div>
            <Field label="Description (internal)"><Input value={f.v.description} onChange={f.set('description')} /></Field>
            <label className="check"><input type="checkbox" checked={f.v.first} onChange={f.set('first')} />First orders only</label>
            <div className="row end"><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button busy={create.busy} disabled={f.v.code.length < 3} onClick={() => create.run(reload)}>Create coupon</Button></div>
          </Modal>
        </>
      )}</Fetch>
    </Need>
  );
}
