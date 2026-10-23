import { useState } from 'react';
import { fmtDate } from '../../api';
import { useAction } from '../../hooks';
import { useToast } from '../../toast';
import { Badge, Button, Confirm, Field, Modal, Notice, PageHeader, Select, StatusBadge, Textarea } from '../../ui';
import { DataTable, Fetch, Need, cents, post, useCan } from './common';

export function Refunds() {
  const can = useCan();
  const toast = useToast();
  const [status, setStatus] = useState('requested');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const act = useAction(async (fn: () => Promise<any>, ok: string, reload: () => void) => { const r = await fn(); if (r?.status === 'failed') toast(`Provider refused: ${r.error}`, 'error'); else toast(ok); reload(); });
  return (
    <Need perm={['refunds.approve', 'refunds.request', 'orders.view']} what="viewing refunds">
      <PageHeader title="Refunds" sub="Support raises refunds; only finance approves and sends them. Approved refunds go to the original payment method." />
      {act.error && <Notice tone="error">{act.error}</Notice>}
      <div className="filters-row"><Field label="Show"><Select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="requested">Waiting for approval</option><option value="failed">Failed</option><option value="succeeded">Completed</option><option value="rejected">Rejected</option><option value="">All</option></Select></Field></div>
      <Fetch path={`/admin/refunds${status ? `?status=${status}` : ''}`}>{(rows: any[], reload) => (
        <>
          <DataTable rows={rows} rowKey={(r) => r.id} empty="No refunds in this view."
            columns={[
              { key: 'o', header: 'Order', render: (r) => <strong>{r.order_number}</strong> }, { key: 's', header: 'Store', render: (r) => r.store_name }, { key: 'a', header: 'Amount', render: (r) => <strong>{cents(r.amount_cents)}</strong> },
              { key: 'r', header: 'Reason', render: (r) => r.reason }, { key: 'f', header: 'Who pays', render: (r) => (r.vendor_funded ? 'Store' : <Badge tone="warn">EAZyfoods</Badge>) },
              { key: 'by', header: 'Requested by', render: (r) => r.requested_by ?? 'System' }, { key: 'at', header: 'When', render: (r) => fmtDate(r.created_at) }, { key: 'st', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'act', header: '', render: (r) => (['requested', 'failed'].includes(r.status) ? (
                can('refunds.approve') ? <div className="row wrap">
                  <Confirm variant="primary" size="sm" message={`Send a refund of ${cents(r.amount_cents)} for ${r.order_number} to the customer’s card? This cannot be undone.`} onConfirm={() => act.run(() => post(`/admin/refunds/${r.id}/approve`), 'Refund sent', reload) as any}>{r.status === 'failed' ? 'Retry' : 'Approve'}</Confirm>
                  {r.status === 'requested' && <Button size="sm" variant="ghost" onClick={() => { setRejecting(r.id); setNote(''); }}>Reject</Button>}</div>
                  : <span className="small muted">Finance approves</span>) : null) },
            ]} />
          <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Reject refund request">
            <Field label="Reason (recorded)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="row end"><Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
              <Button variant="danger" disabled={note.length < 3} onClick={async () => { await act.run(() => post(`/admin/refunds/${rejecting}/reject`, { note }), 'Refund rejected', reload); setRejecting(null); }}>Reject</Button></div>
          </Modal>
        </>
      )}</Fetch>
    </Need>
  );
}
