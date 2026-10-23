import { useState } from 'react';
import { post, fmtDate } from '../../api';
import { useAction, useApi } from '../../hooks';
import { Button, Card, StatusBadge, Field, Input, Notice, PageHeader, Select, Textarea, formValues } from '../../ui';
import { useVendor } from './Shared';

export default function Help() {
  const { orders } = useVendor();
  const [sent, setSent] = useState(false);
  const tickets = useApi<{ id: string; subject: string; status: string; created_at: string; last_reply: string | null }[]>('/vendor/support');
  const a = useAction(async (v: Record<string, string>) => { await post('/vendor/support', { subject: v.subject, message: v.message, suborder_id: v.order || undefined }); setSent(true); tickets.reload(); });
  return (<>
    <PageHeader title="Help" sub="Disputes, fulfilment problems, anything stuck" />
    {sent ? <Notice tone="ok"><strong>Message sent.</strong> Our support team will reply by email. <button className="link" onClick={() => setSent(false)}>Send another</button></Notice> :
      <Card><form onSubmit={(e) => a.run(formValues(e))}>{a.error && <Notice tone="error">{a.error}</Notice>}
        <Field label="About an order (optional)"><Select name="order" defaultValue=""><option value="">Not about a specific order</option>{orders.map((o) => <option key={o.id} value={o.id}>#{o.order_number} · {fmtDate(o.placed_at, { dateStyle: 'medium' })}</option>)}</Select></Field>
        <Field label="Subject"><Input name="subject" required minLength={3} maxLength={150} /></Field>
        <Field label="What happened?"><Textarea name="message" required minLength={5} maxLength={1500} /></Field>
        <Button type="submit" busy={a.busy}>Send to support</Button></form></Card>}
    <h2>Your requests</h2>
    {tickets.data?.length ? tickets.data.map((t) => <Card key={t.id}><div className="row between"><strong>{t.subject}</strong><StatusBadge status={t.status} /></div><div className="muted small">{fmtDate(t.created_at)}</div>{t.last_reply && <p><strong>Reply:</strong> {t.last_reply}</p>}</Card>) : <p className="muted">No requests yet. Replies are also sent to your account email.</p>}
  </>);
}
