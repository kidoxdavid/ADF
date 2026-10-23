import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate, money, post, put } from '../../api';
import { useApi } from '../../hooks';
import { useToast } from '../../toast';
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, PortalLayout, Stat, Textarea, formValues } from '../../ui';
import './driver.css';

type Addr = { line1?: string; line2?: string; city?: string; postal_code?: string; first_name?: string; phone?: string };
type Job = {
  id: string; status: 'assigned' | 'picked_up' | 'delivered' | 'failed'; instructions: string | null; earning_cents: number;
  pickup: { store_name: string; address_line: string | null; city: string | null; postal_code: string | null; phone: string | null };
  dropoff: Addr; order_number: string; promised_at: string | null; delivered_at: string | null; assigned_at: string | null;
};
type Me = { status: 'none' | 'applied' | 'approved' | 'suspended' | 'rejected'; is_available?: boolean };

/** Local copy of useAction: the shared one stops reporting errors under React StrictMode (its alive-ref is never restored after the dev double-mount). */
function useAction<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (...a: A) => {
    setBusy(true); setError(undefined);
    try { return await fn(...a); } catch (e: any) { setError(e.message ?? 'Something went wrong'); return undefined; } finally { setBusy(false); }
  };
  return { run, busy, error };
}

const NAV = [{ to: '/driver', label: 'Jobs', end: true }, { to: '/driver/history', label: 'History' }, { to: '/driver/earnings', label: 'Earnings' }];
const mapUrl = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const isLate = (j: Job) => !!j.promised_at && new Date(j.promised_at).getTime() < Date.now() && ['assigned', 'picked_up'].includes(j.status);
const dropAddr = (d: Addr) => [d.line1, d.line2, d.city, d.postal_code].filter(Boolean).join(', ');
const pickAddr = (p: Job['pickup']) => [p.address_line, p.city, p.postal_code].filter(Boolean).join(', ');

export default function DriverPortal() {
  const me = useApi<Me>('/driver/me');
  return (
    <PortalLayout title="Driver" nav={NAV}>
      {me.loading ? <Loading /> : me.error ? <ErrorBox message={me.error} retry={me.reload} /> : me.data?.status === 'none' ? <Apply onDone={me.reload} />
        : me.data?.status !== 'approved' ? <Status status={me.data!.status} />
        : (
          <Routes>
            <Route index element={<Jobs initialAvailable={!!me.data.is_available} />} />
            <Route path="jobs/:id" element={<JobDetail />} />
            <Route path="history" element={<History />} />
            <Route path="earnings" element={<Earnings />} />
            <Route path="*" element={<Navigate to="/driver" replace />} />
          </Routes>
        )}
    </PortalLayout>
  );
}

function Apply({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const { run, busy, error } = useAction(async (f: Record<string, string>) => { await post('/driver/apply', { phone: f.phone, vehicle: f.vehicle || undefined }); toast('Application sent'); onDone(); });
  return (
    <>
      <PageHeader title="Drive with EAZyfoods" />
      <Notice>Before you can take deliveries, EAZyfoods must verify your driver’s licence and complete a background check. We do not promise any amount of work or earnings. Applying does not guarantee approval.</Notice>
      <Card>
        <form onSubmit={(e) => run(formValues(e))}>
          <Field label="Mobile phone"><Input name="phone" type="tel" required minLength={7} autoComplete="tel" /></Field>
          <Field label="Vehicle (optional)" hint="For example: car, bike, van."><Input name="vehicle" maxLength={80} /></Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button size="lg" busy={busy} type="submit">Send application</Button>
        </form>
      </Card>
    </>
  );
}

function Status({ status }: { status: string }) {
  const text: Record<string, string> = {
    applied: 'Your application is under review. We will verify your licence and background check, then approve your account. You cannot see deliveries until you are approved.',
    suspended: 'Your driver account is suspended. Please contact EAZyfoods support.', rejected: 'Your application was not approved.',
  };
  return <><PageHeader title={status === 'applied' ? 'Under review' : 'Account not active'} /><Notice tone={status === 'applied' ? 'info' : 'warn'}>{text[status] ?? 'Your account is not active.'}</Notice></>;
}

function Jobs({ initialAvailable }: { initialAvailable: boolean }) {
  const { data, error, loading, reload } = useApi<Job[]>('/driver/jobs?scope=active');
  const toast = useToast();
  const [on, setOn] = useState(initialAvailable);
  useEffect(() => { const t = setInterval(reload, 30000); return () => clearInterval(t); }, [reload]);
  const toggle = useAction(async () => { const r = await put('/driver/availability', { available: !on }); setOn(r.is_available); toast(r.is_available ? 'You are available' : 'You are offline'); });
  return (
    <>
      <PageHeader title="My deliveries" />
      <Card className="row between">
        <div><strong>{on ? 'Available' : 'Offline'}</strong><div className="muted small">{on ? 'Dispatch can assign you deliveries.' : 'Turn on to receive deliveries.'}</div></div>
        <Button size="lg" variant={on ? 'secondary' : 'primary'} busy={toggle.busy} onClick={() => toggle.run()} aria-pressed={on}>{on ? 'Go offline' : 'Go online'}</Button>
      </Card>
      {toggle.error && <Notice tone="error">{toggle.error}</Notice>}
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} retry={reload} />}
      {data && !data.length && <Empty title="No deliveries assigned">New jobs appear here when dispatch assigns them. This page refreshes every 30 seconds.</Empty>}
      {data?.map((j) => <JobCard key={j.id} j={j} />)}
    </>
  );
}

function JobCard({ j }: { j: Job }) {
  const late = isLate(j);
  const toStore = j.status === 'assigned';
  return (
    <Card className={`job ${late ? 'late' : ''}`}>
      <div className="row between wrap"><strong className="display">#{j.order_number}</strong><div className="row">{late && <Badge tone="danger">Late</Badge>}<Badge tone={toStore ? 'warn' : 'info'}>{toStore ? 'Go to store' : 'Deliver now'}</Badge></div></div>
      <div className="stack">
        <div><span className="eyebrow">Pick up</span><div><strong>{j.pickup.store_name}</strong></div><div className="muted">{pickAddr(j.pickup)}</div></div>
        <div><span className="eyebrow">Drop off</span><div><strong>{j.dropoff.first_name}</strong> · {dropAddr(j.dropoff)}</div></div>
        <div className="row wrap small muted">{j.promised_at && <span>Promised by {fmtDate(j.promised_at, { timeStyle: 'short' })}</span>}<span>Earning {money(j.earning_cents)}</span></div>
        {j.instructions && <Notice tone="warn"><strong>Instructions:</strong> {j.instructions}</Notice>}
        <div className="driver-actions">
          <a className="btn secondary" href={mapUrl(toStore ? `${j.pickup.store_name} ${pickAddr(j.pickup)}` : dropAddr(j.dropoff))} target="_blank" rel="noreferrer">Navigate</a>
          {j.dropoff.phone && <a className="btn secondary" href={`tel:${j.dropoff.phone}`}>Call customer</a>}
        </div>
        <Link className="btn primary lg" to={`/driver/jobs/${j.id}`}>{toStore ? 'Open job' : 'Continue delivery'}</Link>
      </div>
    </Card>
  );
}

function JobDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Job[]>('/driver/jobs?scope=active');
  const [modal, setModal] = useState<null | 'bypass' | 'issue' | 'fail'>(null);
  const [code, setCode] = useState('');
  const j = data?.find((x) => x.id === id);

  const pickup = useAction(async () => { await post(`/driver/jobs/${id}/pickup`); toast('Marked as picked up'); reload(); });
  const deliver = useAction(async (body: { code?: string; bypass_reason?: string }) => {
    try { await post(`/driver/jobs/${id}/deliver`, body); toast('Delivered. Thank you!'); nav('/driver'); }
    catch (e: any) { throw new Error(e.code === 'wrong_code' ? 'That code does not match. Ask the customer to open their order page and read it again.' : e.message); }
  });
  const issue = useAction(async (note: string) => { await post(`/driver/jobs/${id}/issue`, { note }); toast('Dispatch has been told'); setModal(null); });
  const fail = useAction(async (reason: string) => { await post(`/driver/jobs/${id}/fail`, { reason }); toast('Marked as not delivered'); nav('/driver'); });

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!j) return <><Notice>This job is no longer active.</Notice><Link className="btn primary" to="/driver">Back to jobs</Link></>;
  const step1 = j.status === 'assigned';
  return (
    <>
      <PageHeader title={`Order #${j.order_number}`} actions={<Link to="/driver" className="btn ghost">← Jobs</Link>} />
      <div className="steps" aria-label="Progress"><span className={step1 ? 'on' : 'done'}>1 · Pick up</span><span className={step1 ? '' : 'on'}>2 · Deliver</span></div>
      {isLate(j) && <Notice tone="error">This delivery is past its promised time.</Notice>}
      {step1 ? (
        <Card className="job">
          <span className="eyebrow">Step 1 · Go to the store</span>
          <h2 className="display">{j.pickup.store_name}</h2>
          <p>{pickAddr(j.pickup)}</p>
          <div className="driver-actions">
            <a className="btn secondary" href={mapUrl(`${j.pickup.store_name} ${pickAddr(j.pickup)}`)} target="_blank" rel="noreferrer">Navigate</a>
            {j.pickup.phone && <a className="btn secondary" href={`tel:${j.pickup.phone}`}>Call store</a>}
          </div>
          {pickup.error && <Notice tone="error">{pickup.error}</Notice>}
          <div className="big-actions"><Button busy={pickup.busy} onClick={() => pickup.run()}>I’ve picked up the order</Button></div>
        </Card>
      ) : (
        <Card className="job">
          <span className="eyebrow">Step 2 · Deliver to</span>
          <h2 className="display">{j.dropoff.first_name}</h2>
          <p>{dropAddr(j.dropoff)}</p>
          {j.instructions && <Notice tone="warn"><strong>Instructions:</strong> {j.instructions}</Notice>}
          <div className="driver-actions">
            <a className="btn secondary" href={mapUrl(dropAddr(j.dropoff))} target="_blank" rel="noreferrer">Navigate</a>
            {j.dropoff.phone && <a className="btn secondary" href={`tel:${j.dropoff.phone}`}>Call customer</a>}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); deliver.run({ code }); }}>
            <Field label="4-digit code from the customer" hint="The customer sees it on their order page. Ask them to read it to you.">
              <Input className="code-input" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoComplete="off" placeholder="0000" />
            </Field>
            {deliver.error && <Notice tone="error">{deliver.error}</Notice>}
            <div className="big-actions"><Button type="submit" busy={deliver.busy} disabled={code.length !== 4}>Confirm delivery</Button></div>
          </form>
          <button className="link" onClick={() => setModal('bypass')}>Customer can’t give the code</button>
        </Card>
      )}
      <div className="driver-actions">
        <Button variant="secondary" onClick={() => setModal('issue')}>Report a problem</Button>
        <Button variant="danger" onClick={() => setModal('fail')}>I couldn’t deliver</Button>
      </div>

      <Modal open={modal === 'bypass'} onClose={() => setModal(null)} title="Deliver without the code">
        <Notice tone="warn">This is flagged for EAZyfoods to review. Only use it if the customer truly cannot give the code.</Notice>
        <ReasonForm label="Why can’t you use the code?" min={5} busy={deliver.busy} error={deliver.error} cta="Confirm delivery without code" onSubmit={(r) => deliver.run({ bypass_reason: r })} />
      </Modal>
      <Modal open={modal === 'issue'} onClose={() => setModal(null)} title="Report a problem">
        <ReasonForm label="What happened?" min={3} busy={issue.busy} error={issue.error} cta="Send to dispatch" onSubmit={(r) => issue.run(r)} />
      </Modal>
      <Modal open={modal === 'fail'} onClose={() => setModal(null)} title="I couldn’t deliver">
        <Notice tone="warn">The delivery will be marked as failed and dispatch will decide what happens next. Do this only after you have tried to reach the customer.</Notice>
        <ReasonForm label="Reason" min={3} busy={fail.busy} error={fail.error} cta="Yes, mark as not delivered" danger onSubmit={(r) => fail.run(r)} />
      </Modal>
    </>
  );
}

function ReasonForm({ label, min, busy, error, cta, onSubmit, danger }: { label: string; min: number; busy: boolean; error?: string; cta: string; onSubmit: (r: string) => void; danger?: boolean }) {
  const [v, setV] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(v.trim()); }}>
      <Field label={label}><Textarea value={v} onChange={(e) => setV(e.target.value)} maxLength={300} required /></Field>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="big-actions"><Button type="submit" variant={danger ? 'danger' : 'primary'} busy={busy} disabled={v.trim().length < min}>{cta}</Button></div>
    </form>
  );
}

function History() {
  const { data, error, loading, reload } = useApi<Job[]>('/driver/jobs?scope=history');
  return (
    <>
      <PageHeader title="History" />
      {loading && <Loading />}{error && <ErrorBox message={error} retry={reload} />}
      {data && <DataTable rows={data} rowKey={(j) => j.id} empty="No finished deliveries yet." columns={[
        { key: 'o', header: 'Order', render: (j) => `#${j.order_number}` },
        { key: 's', header: 'Result', render: (j) => <Badge tone={j.status === 'delivered' ? 'ok' : 'danger'}>{j.status === 'delivered' ? 'Delivered' : 'Not delivered'}</Badge> },
        { key: 'st', header: 'Store', render: (j) => j.pickup.store_name },
        { key: 'a', header: 'Drop-off', render: (j) => dropAddr(j.dropoff) },
        { key: 'd', header: 'When', render: (j) => fmtDate(j.delivered_at ?? j.assigned_at) },
        { key: 'e', header: 'Earning', render: (j) => (j.status === 'delivered' ? money(j.earning_cents) : '—') },
      ]} />}
    </>
  );
}

function Earnings() {
  const { data, error, loading, reload } = useApi<{ earnings: { amount_cents: number; created_at: string; order_number: string; paid_out: boolean; payout_status: string | null }[]; unpaid_cents: number; paid_cents: number }>('/driver/earnings');
  return (
    <>
      <PageHeader title="Earnings" />
      <Notice>Earnings are recorded when you complete a delivery. EAZyfoods pays them out after review; we do not guarantee when a payout will be made.</Notice>
      {loading && <Loading />}{error && <ErrorBox message={error} retry={reload} />}
      {data && <>
        <div className="grid cols-2"><Stat label="Not yet paid out" value={money(data.unpaid_cents)} /><Stat label="Paid out" value={money(data.paid_cents)} /></div>
        <h2>Deliveries</h2>
        <DataTable rows={data.earnings} rowKey={(e) => e.order_number + e.created_at} empty="No earnings yet." columns={[
          { key: 'o', header: 'Order', render: (e) => `#${e.order_number}` }, { key: 'd', header: 'Date', render: (e) => fmtDate(e.created_at) },
          { key: 'a', header: 'Amount', render: (e) => money(e.amount_cents) },
          { key: 'p', header: 'Payout', render: (e) => (e.paid_out ? <Badge tone={e.payout_status === 'paid' ? 'ok' : 'warn'}>{e.payout_status === 'paid' ? 'Paid' : 'Pending'}</Badge> : <Badge>Not yet</Badge>) },
        ]} />
      </>}
    </>
  );
}
