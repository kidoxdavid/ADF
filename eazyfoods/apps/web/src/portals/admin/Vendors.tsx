import { Fragment, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fmtDate } from '../../api';
import { useAction } from '../../hooks';
import { useToast } from '../../toast';
import { Badge, Button, Card, Confirm, Field, Input, Modal, Notice, PageHeader, Select, StatusBadge, Textarea } from '../../ui';
import { DataTable, Fetch, Need, patch, useCan } from './common';

export function Vendors() {
  const [status, setStatus] = useState('');
  const nav = useNavigate();
  return (
    <Need perm={['vendors.manage']} what="managing vendors">
      <PageHeader title="Vendors" sub="Review applications, verify business documents, approve stores." />
      <div className="filters-row">
        <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option><option value="submitted">Submitted (needs review)</option><option value="draft">Draft</option><option value="approved">Approved</option><option value="suspended">Suspended</option>
        </Select></Field>
      </div>
      <Fetch path={`/admin/vendors${status ? `?status=${status}` : ''}`}>{(rows: any[]) => (
        <DataTable rows={rows} rowKey={(r) => r.id} onRowClick={(r) => nav(`/admin/vendors/${r.id}`)} empty="No vendors match."
          columns={[
            { key: 'name', header: 'Vendor', render: (r) => <><strong>{r.name}</strong> {r.is_test_data && <Badge tone="demo">Demo</Badge>}</> },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'stores', header: 'Stores' },
            { key: 'docs', header: 'Documents', render: (r) => <>{r.verified_docs} verified{r.pending_docs ? <> · <Badge tone="warn">{r.pending_docs} to review</Badge></> : null}</> },
            { key: 'commission', header: 'Commission', render: (r) => (r.commission_bps == null ? 'Default' : `${r.commission_bps / 100}%`) },
            { key: 'submitted', header: 'Submitted', render: (r) => fmtDate(r.submitted_at, { dateStyle: 'medium' }) },
          ]} />
      )}</Fetch>
    </Need>
  );
}

export function VendorDetail() {
  const { id } = useParams();
  const can = useCan();
  const toast = useToast();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [comm, setComm] = useState<string | null>(null);
  const [acct, setAcct] = useState<string | null>(null);
  const act = useAction(async (fn: () => Promise<any>, ok: string, reload: () => void) => { await fn(); toast(ok); reload(); });

  return (
    <Need perm={['vendors.manage']} what="managing vendors">
      <Fetch path={`/admin/vendors/${id}`}>{(v: any, reload) => {
        const verified = v.documents.some((d: any) => d.status === 'verified');
        return (
          <>
            <PageHeader title={v.name} sub={<><StatusBadge status={v.status} /> {v.legal_name && <>· {v.legal_name}</>} · <Link to="/admin/vendors">All vendors</Link></>} />
            {act.error && <Notice tone="error">{act.error}</Notice>}
            {v.status === 'submitted' && !verified && <Notice tone="warn">This vendor cannot be approved until at least one business document is <strong>verified</strong> (open the documents below, check them, then verify).</Notice>}
            <div className="row wrap" style={{ marginBottom: 14 }}>
              {v.status !== 'approved' && <Confirm variant="primary" message={`Approve ${v.name}? Their stores can then be published and take orders.`} onConfirm={() => act.run(() => patch(`/admin/vendors/${id}/status`, { status: 'approved' }), 'Vendor approved', reload) as any}>Approve vendor</Confirm>}
              {v.status !== 'suspended' && <Confirm message={`Suspend ${v.name}? Their stores stop appearing and cannot take orders.`} onConfirm={() => act.run(() => patch(`/admin/vendors/${id}/status`, { status: 'suspended' }), 'Vendor suspended', reload) as any}>Suspend</Confirm>}
            </div>
            <div className="grid cols-2">
              <Card><h3>Business</h3>
                <dl className="kv"><dt>Business number</dt><dd>{v.business_number || '—'}</dd><dt>Phone</dt><dd>{v.phone || '—'}</dd><dt>Email</dt><dd>{v.contact_email || '—'}</dd>
                  <dt>Agreement</dt><dd>{v.agreement_accepted_at ? `Accepted ${fmtDate(v.agreement_accepted_at)} (${v.agreement_version})` : <Badge tone="warn">Not accepted</Badge>}</dd>
                  <dt>Payout account</dt><dd>{v.stripe_account_id ?? <span className="muted">Not connected</span>}</dd></dl>
              </Card>
              <Card><h3>People</h3>
                {v.members.length ? <dl className="kv">{v.members.map((m: any) => <Fragment key={m.email + m.role}><dt>{m.role.replace('vendor_', '')}</dt><dd>{m.full_name} · {m.email}</dd></Fragment>)}</dl> : <p className="muted">No members.</p>}
              </Card>
            </div>
            <Card><h3>Stores</h3>
              <DataTable rows={v.stores} rowKey={(s: any) => s.id} empty="No stores."
                columns={[{ key: 'name', header: 'Store', render: (s: any) => <strong>{s.name}</strong> }, { key: 'status', header: 'Status', render: (s: any) => <StatusBadge status={s.status} /> },
                  { key: 'addr', header: 'Address', render: (s: any) => `${s.address_line ?? ''} ${s.city ?? ''} ${s.postal_code ?? ''}` }, { key: 'phone', header: 'Phone' }]} />
              <p className="small muted">Publish stores from <Link to="/admin/stores">Stores</Link> once the vendor is approved.</p>
            </Card>
            <Card><h3>Business documents</h3>
              <p className="small muted">Documents are private. Open each, check it matches the business, then verify or reject with a note.</p>
              <DataTable rows={v.documents} rowKey={(d: any) => d.id} empty="No documents uploaded yet."
                columns={[
                  { key: 'kind', header: 'Type', render: (d: any) => d.kind.replace(/_/g, ' ') }, { key: 'status', header: 'Status', render: (d: any) => <StatusBadge status={d.status} /> },
                  { key: 'note', header: 'Note', render: (d: any) => d.review_note ?? '' }, { key: 'at', header: 'Uploaded', render: (d: any) => fmtDate(d.created_at) },
                  { key: 'a', header: '', render: (d: any) => (
                    <div className="row wrap">
                      <a className="btn secondary sm" href={`/api/admin/vendor-documents/${d.id}/file`} target="_blank" rel="noreferrer">Open file</a>
                      <Button size="sm" onClick={() => act.run(() => patch(`/admin/vendor-documents/${d.id}`, { status: 'verified' }), 'Document verified', reload)}>Verify</Button>
                      <Button size="sm" variant="danger" onClick={() => { setRejecting(d.id); setNote(''); }}>Reject</Button>
                    </div>) },
                ]} />
            </Card>
            <Card><h3>Commercial terms</h3>
              <p>Commission: <strong>{v.commission_bps == null ? 'marketplace default' : `${v.commission_bps / 100}%`}</strong></p>
              {can('settings.manage') ? <Button variant="secondary" size="sm" onClick={() => setComm(v.commission_bps == null ? '' : String(v.commission_bps / 100))}>Change commission override</Button>
                : <p className="small muted">Only an owner can change a vendor’s commission.</p>}
              <hr />
              <p>Payout account: <strong>{v.stripe_account_id ?? 'none'}</strong></p>
              {can('payouts.manage') ? <Button variant="secondary" size="sm" onClick={() => setAcct(v.stripe_account_id ?? '')}>Set payout account</Button>
                : <p className="small muted">Finance connects payout accounts. Until then payouts are by manual bank transfer.</p>}
            </Card>

            <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Reject document">
              <Field label="Reason (the vendor will see this)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <div className="row end"><Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
                <Button variant="danger" disabled={note.length < 3} onClick={async () => { await act.run(() => patch(`/admin/vendor-documents/${rejecting}`, { status: 'rejected', note }), 'Document rejected', reload); setRejecting(null); }}>Reject</Button></div>
            </Modal>
            <Modal open={comm !== null} onClose={() => setComm(null)} title="Commission override">
              <p className="small muted">Percent of merchandise value. Leave empty to use the marketplace default. Applies to new orders only. This change is recorded in the audit log.</p>
              <Field label="Commission %"><Input inputMode="decimal" value={comm ?? ''} onChange={(e) => setComm(e.target.value)} /></Field>
              <div className="row end"><Button variant="ghost" onClick={() => setComm(null)}>Cancel</Button>
                <Button onClick={async () => { await act.run(() => patch(`/admin/vendors/${id}/commission`, { commission_bps: comm === '' ? null : Math.round(Number(comm) * 100) }), 'Commission updated', reload); setComm(null); }}>Save</Button></div>
            </Modal>
            <Modal open={acct !== null} onClose={() => setAcct(null)} title="Payout account">
              <Field label="Stripe Connect account id" hint="Starts with acct_. Leave empty to disconnect."><Input value={acct ?? ''} onChange={(e) => setAcct(e.target.value)} placeholder="acct_…" /></Field>
              <div className="row end"><Button variant="ghost" onClick={() => setAcct(null)}>Cancel</Button>
                <Button onClick={async () => { await act.run(() => patch(`/admin/vendors/${id}/payout-account`, { stripe_account_id: acct === '' ? null : acct }), 'Payout account saved', reload); setAcct(null); }}>Save</Button></div>
            </Modal>
          </>
        );
      }}</Fetch>
    </Need>
  );
}

export function StoresAdmin() {
  const toast = useToast();
  const act = useAction(async (fn: () => Promise<any>, ok: string, reload: () => void) => { await fn(); toast(ok); reload(); });
  return (
    <Need perm={['stores.manage']} what="managing stores">
      <PageHeader title="Stores" sub="A store is public only when it is published and its vendor is approved." />
      {act.error && <Notice tone="error">{act.error}</Notice>}
      <Fetch path="/admin/stores">{(rows: any[], reload) => (
        <DataTable rows={rows} rowKey={(r) => r.id} empty="No stores yet."
          columns={[
            { key: 'name', header: 'Store', render: (r) => <><strong>{r.name}</strong> {r.is_test_data && <Badge tone="demo">Demo</Badge>}<div className="small muted">{r.vendor_name}</div></> },
            { key: 'status', header: 'Store', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'vs', header: 'Vendor', render: (r) => <StatusBadge status={r.vendor_status} /> },
            { key: 'paused', header: 'Ordering', render: (r) => (r.ordering_paused ? <Badge tone="warn">Paused by store</Badge> : 'On') },
            { key: 'a', header: '', render: (r) => (
              <div className="row wrap">
                {r.status !== 'published' && <Button size="sm" disabled={r.vendor_status !== 'approved'} title={r.vendor_status !== 'approved' ? 'Approve the vendor first' : ''}
                  onClick={() => act.run(() => patch(`/admin/stores/${r.id}/status`, { status: 'published' }), 'Store published', reload)}>Publish</Button>}
                {r.status !== 'suspended' && <Confirm size="sm" message={`Suspend ${r.name}? It disappears from the shop immediately.`} onConfirm={() => act.run(() => patch(`/admin/stores/${r.id}/status`, { status: 'suspended' }), 'Store suspended', reload) as any}>Suspend</Confirm>}
                {r.vendor_status !== 'approved' && <span className="small muted">Vendor must be approved first</span>}
              </div>) },
          ]} />
      )}</Fetch>
    </Need>
  );
}
