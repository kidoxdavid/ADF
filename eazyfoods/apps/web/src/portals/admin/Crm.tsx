import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fmtDate } from '../../api';
import { useAction } from '../../hooks';
import { useToast } from '../../toast';
import { Badge, Button, Card, Field, Input, Modal, Notice, PageHeader, Select, Textarea } from '../../ui';
import { Fetch, Need, patch, post, useForm } from './common';

const STAGES = ['identified', 'contacted', 'demo', 'onboarding', 'launched', 'lost'];

export function Crm() {
  const nav = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const f = useForm({ business_name: '', contact_name: '', phone: '', email: '', address: '', source: '', next_action: '', next_action_at: '' });
  const add = useAction(async (reload: () => void) => {
    const v = f.v;
    const r = await post('/admin/crm/prospects', { business_name: v.business_name, contact_name: v.contact_name || undefined, phone: v.phone || undefined, email: v.email || undefined, address: v.address || undefined,
      source: v.source || undefined, next_action: v.next_action || undefined, next_action_at: v.next_action_at ? new Date(v.next_action_at).toISOString() : undefined });
    toast('Prospect added'); setOpen(false); f.setV({ business_name: '', contact_name: '', phone: '', email: '', address: '', source: '', next_action: '', next_action_at: '' }); reload(); void r;
  });
  return (
    <Need perm={['crm.manage']} what="the vendor sales pipeline">
      <PageHeader title="Vendor pipeline" sub="Internal only. Contact details here are personal information: keep it to what you need." actions={<Button onClick={() => setOpen(true)}>Add prospect</Button>} />
      <Fetch path="/admin/crm/prospects">{(rows: any[], reload) => (
        <>
          <div className="kanban">{STAGES.map((s) => {
            const items = rows.filter((r) => r.stage === s);
            return (
              <div key={s} className="col"><h3>{s[0].toUpperCase() + s.slice(1)} <Badge>{items.length}</Badge></h3>
                {items.map((r) => (
                  <a key={r.id} className={`item ${r.overdue ? 'overdue' : ''}`} href={`/admin/crm/${r.id}`} onClick={(e) => { e.preventDefault(); nav(`/admin/crm/${r.id}`); }}>
                    <strong>{r.business_name}</strong>
                    <div className="small muted">{r.contact_name ?? ''}{r.source ? ` · ${r.source}` : ''}</div>
                    {r.next_action && <div className="small">{r.overdue && <Badge tone="danger">Overdue</Badge>} {r.next_action}{r.next_action_at ? ` · ${fmtDate(r.next_action_at, { dateStyle: 'medium' })}` : ''}</div>}
                  </a>))}
                {!items.length && <p className="small muted">None</p>}
              </div>);
          })}</div>
          <Modal open={open} onClose={() => setOpen(false)} title="Add prospect">
            {add.error && <Notice tone="error">{add.error}</Notice>}
            <Field label="Business name"><Input value={f.v.business_name} onChange={f.set('business_name')} /></Field>
            <div className="form-grid"><Field label="Contact"><Input value={f.v.contact_name} onChange={f.set('contact_name')} /></Field><Field label="Phone"><Input value={f.v.phone} onChange={f.set('phone')} /></Field>
              <Field label="Email"><Input type="email" value={f.v.email} onChange={f.set('email')} /></Field><Field label="Source" hint="walk-in, referral, social…"><Input value={f.v.source} onChange={f.set('source')} /></Field></div>
            <Field label="Address"><Input value={f.v.address} onChange={f.set('address')} /></Field>
            <div className="form-grid"><Field label="Next action"><Input value={f.v.next_action} onChange={f.set('next_action')} /></Field><Field label="When"><Input type="datetime-local" value={f.v.next_action_at} onChange={f.set('next_action_at')} /></Field></div>
            <div className="row end"><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button busy={add.busy} disabled={f.v.business_name.length < 2} onClick={() => add.run(reload)}>Add</Button></div>
          </Modal>
        </>
      )}</Fetch>
    </Need>
  );
}

export function ProspectDetail() {
  const { id } = useParams();
  const toast = useToast();
  const f = useForm({ kind: 'call', note: '', next_action: '', next_action_at: '' });
  const act = useAction(async (fn: () => Promise<any>, ok: string, reload: () => void) => { await fn(); toast(ok); reload(); });
  return (
    <Need perm={['crm.manage']} what="the vendor sales pipeline">
      <Fetch path={`/admin/crm/prospects/${id}`}>{(p: any, reload) => (
        <>
          <PageHeader title={p.business_name} sub={<><Badge tone="info">{p.stage}</Badge> · <Link to="/admin/crm">Pipeline</Link></>}
            actions={<Select aria-label="Stage" value={p.stage} onChange={(e) => act.run(() => patch(`/admin/crm/prospects/${id}`, { stage: e.target.value }), 'Stage updated', reload)}>{STAGES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>} />
          {act.error && <Notice tone="error">{act.error}</Notice>}
          <div className="grid cols-2">
            <Card><h3>Details</h3><dl className="kv"><dt>Contact</dt><dd>{p.contact_name || '—'}</dd><dt>Phone</dt><dd>{p.phone || '—'}</dd><dt>Email</dt><dd>{p.email || '—'}</dd><dt>Address</dt><dd>{p.address || '—'}</dd>
              <dt>Source</dt><dd>{p.source || '—'}</dd><dt>Last contact</dt><dd>{p.last_contact_at ? fmtDate(p.last_contact_at) : 'Never'}</dd><dt>Next action</dt><dd>{p.next_action ? `${p.next_action}${p.next_action_at ? ' · ' + fmtDate(p.next_action_at) : ''}` : '—'}</dd>
              {p.launched_at && <><dt>Launched</dt><dd>{fmtDate(p.launched_at)}</dd></>}</dl></Card>
            <Card><h3>Log an activity</h3>
              <div className="form-grid"><Field label="Type"><Select value={f.v.kind} onChange={f.set('kind')}><option value="call">Call</option><option value="visit">Visit</option><option value="email">Email</option><option value="demo">Demo</option><option value="note">Note</option></Select></Field>
                <Field label="Next action"><Input value={f.v.next_action} onChange={f.set('next_action')} /></Field><Field label="When"><Input type="datetime-local" value={f.v.next_action_at} onChange={f.set('next_action_at')} /></Field></div>
              <Field label="What happened"><Textarea value={f.v.note} onChange={f.set('note')} /></Field>
              <Button disabled={!f.v.note.trim()} onClick={async () => { await act.run(() => post(`/admin/crm/prospects/${id}/activities`, { kind: f.v.kind, note: f.v.note, next_action: f.v.next_action || undefined, next_action_at: f.v.next_action_at ? new Date(f.v.next_action_at).toISOString() : undefined }), 'Activity logged', reload); f.setV({ kind: 'call', note: '', next_action: '', next_action_at: '' }); }}>Save activity</Button>
            </Card>
          </div>
          <Card><h3>History</h3>
            {p.activities.map((a: any) => <div key={a.id} className="msg"><div className="meta">{a.kind} · {a.by ?? 'System'} · {fmtDate(a.created_at)}</div>{a.note}</div>)}
            {!p.activities.length && <p className="muted">No activity yet.</p>}
          </Card>
        </>
      )}</Fetch>
    </Need>
  );
}
