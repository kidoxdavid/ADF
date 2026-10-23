import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fmtDate } from '../../api';
import { useAction } from '../../hooks';
import { useToast } from '../../toast';
import { Badge, Button, Card, Field, Notice, PageHeader, Select, StatusBadge, Textarea } from '../../ui';
import { DataTable, Fetch, Need, patch, post, useCan } from './common';

export function Support() {
  const nav = useNavigate();
  const [status, setStatus] = useState('open');
  return (
    <Need perm={['support.manage']} what="handling support tickets">
      <PageHeader title="Support" sub="Customer problems, vendor questions and driver issues." />
      <div className="filters-row"><Field label="Show"><Select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="open">Open</option><option value="pending">Waiting on customer</option><option value="resolved">Resolved</option><option value="closed">Closed</option><option value="">All</option></Select></Field></div>
      <Fetch path={`/admin/tickets${status ? `?status=${status}` : ''}`}>{(rows: any[]) => (
        <DataTable rows={rows} rowKey={(r) => r.id} onRowClick={(r) => nav(`/admin/support/${r.id}`)} empty="No tickets in this view."
          columns={[{ key: 's', header: 'Subject', render: (r) => <strong>{r.subject}</strong> }, { key: 'k', header: 'From', render: (r) => <Badge tone="info">{r.kind}</Badge> },
            { key: 'c', header: 'Category', render: (r) => r.category.replace(/_/g, ' ') }, { key: 'o', header: 'Order', render: (r) => r.order_number ?? '' }, { key: 'e', header: 'Who', render: (r) => r.email ?? '' },
            { key: 'st', header: 'Status', render: (r) => <StatusBadge status={r.status} /> }, { key: 'u', header: 'Updated', render: (r) => fmtDate(r.updated_at) }]} />
      )}</Fetch>
    </Need>
  );
}

export function TicketDetail() {
  const { id } = useParams();
  const can = useCan();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const act = useAction(async (fn: () => Promise<any>, ok: string, reload: () => void) => { await fn(); toast(ok); reload(); });
  return (
    <Need perm={['support.manage']} what="handling support tickets">
      <Fetch path={`/admin/tickets/${id}`}>{(t: any, reload) => (
        <>
          <PageHeader title={t.subject} sub={<><StatusBadge status={t.status} /> · {t.kind} · {t.category.replace(/_/g, ' ')} · <Link to="/admin/support">All tickets</Link></>}
            actions={<>
              <Select aria-label="Status" value={t.status} onChange={(e) => act.run(() => patch(`/admin/tickets/${id}`, { status: e.target.value }), 'Status updated', reload)}>
                <option value="open">Open</option><option value="pending">Pending</option><option value="resolved">Resolved</option><option value="closed">Closed</option></Select>
              <Button variant="secondary" onClick={() => act.run(() => patch(`/admin/tickets/${id}`, { assign_to_me: true }), 'Assigned to you', reload)}>Assign to me</Button></>} />
          {act.error && <Notice tone="error">{act.error}</Notice>}
          <div className="grid cols-2">
            <Card><h3>Context</h3><dl className="kv"><dt>Customer</dt><dd>{t.email ?? '—'}</dd><dt>Order</dt><dd>{t.order_id ? <Link to={`/admin/orders/${t.order_id}`}>{t.order_number}</Link> : '—'}</dd><dt>Opened</dt><dd>{fmtDate(t.created_at)}</dd></dl>
              {t.affected_lines?.length > 0 && <><h3 style={{ marginTop: 10 }}>Items reported</h3>{t.affected_lines.map((l: any) => <div key={l.id} className="small">{l.quantity} × {l.product_name}</div>)}</>}
              {t.order_id && can('refunds.request') && <p style={{ marginTop: 12 }}><Link className="btn secondary sm" to={`/admin/orders/${t.order_id}`}>Open order to raise a refund</Link></p>}
            </Card>
            <Card><h3>Reply</h3>
              <Field label={internal ? 'Internal note (the customer never sees this)' : 'Message to the customer'}><Textarea value={body} onChange={(e) => setBody(e.target.value)} /></Field>
              <label className="check"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />Internal note only</label>
              <Button disabled={!body.trim()} onClick={async () => { await act.run(() => post(`/admin/tickets/${id}/messages`, { body, internal }), internal ? 'Note saved' : 'Reply sent', reload); setBody(''); }}>{internal ? 'Save note' : 'Send reply'}</Button>
            </Card>
          </div>
          <Card><h3>Conversation</h3>
            {t.messages.map((m: any) => <div key={m.id} className={`msg ${m.is_internal ? 'internal' : ''}`}><div className="meta">{m.author ?? 'System'} · {fmtDate(m.created_at)}{m.is_internal && ' · INTERNAL NOTE'}</div>{m.body}</div>)}
            {!t.messages.length && <p className="muted">No messages.</p>}
          </Card>
        </>
      )}</Fetch>
    </Need>
  );
}
