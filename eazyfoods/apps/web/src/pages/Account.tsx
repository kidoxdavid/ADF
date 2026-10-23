import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, del, post, put } from '../api';
import { useAuth } from '../auth';
import { useAction, useApi } from '../hooks';
import { useToast } from '../toast';
import { Badge, Button, Confirm, Empty, ErrorBox, Field, Input, Loading, Notice, Tabs, StatusBadge } from '../ui';
import { ProductGrid } from '../cards';
import { AddressForm } from './Checkout';
import { fmtDate } from '../api';

export function AccountPage() {
  const [tab, setTab] = useState('profile');
  const { me, logout, isVendor, has, isStaff } = useAuth();
  return (
    <>
      <h1>Your account</h1>
      <p className="muted">{me?.email}</p>
      <div className="row wrap">{isVendor && <Link to="/vendor" className="btn secondary sm">Vendor portal</Link>}{has('driver') && <Link to="/driver" className="btn secondary sm">Driver portal</Link>}{isStaff && <Link to="/admin" className="btn secondary sm">Admin</Link>}</div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'profile', label: 'Profile' }, { id: 'addresses', label: 'Addresses' }, { id: 'favourites', label: 'Saved' }, { id: 'support', label: 'Help requests' }, { id: 'privacy', label: 'Privacy & security' }]} />
      {tab === 'profile' && <Profile />}{tab === 'addresses' && <Addresses />}{tab === 'favourites' && <Favourites />}{tab === 'support' && <Tickets />}{tab === 'privacy' && <Privacy />}
      <hr /><Button variant="ghost" onClick={logout}>Sign out</Button>
    </>
  );
}

function Profile() {
  const p = useApi<{ full_name: string; phone: string | null; email_verified_at: string | null; notify_email: boolean; marketing_opt_in_at: string | null }>('/account/profile');
  const toast = useToast();
  const save = useAction(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    await put('/account/profile', { full_name: f.get('full_name'), phone: f.get('phone') || null, notify_email: f.get('notify') === 'on', marketing_opt_in: f.get('marketing') === 'on' });
    toast('Saved'); p.reload();
  });
  const verify = useAction(async () => { await post('/auth/verify/request'); toast('Verification email sent'); });
  if (p.loading) return <Loading />;
  if (!p.data) return <ErrorBox message={p.error ?? 'Could not load profile'} />;
  return (
    <form onSubmit={save.run} className="panel" key={JSON.stringify(p.data)}>
      {save.error && <ErrorBox message={save.error} />}
      <Field label="Full name"><Input name="full_name" required defaultValue={p.data.full_name} /></Field>
      <Field label="Phone"><Input name="phone" type="tel" defaultValue={p.data.phone ?? ''} /></Field>
      <p>{p.data.email_verified_at ? <Badge tone="ok">Email verified</Badge> : <>Email not verified yet. <button type="button" className="link" onClick={() => verify.run()}>Send verification email</button></>}</p>
      <label className="check"><input type="checkbox" name="notify" defaultChecked={p.data.notify_email} /> Email me order progress updates (payment and order confirmations are always sent)</label>
      <label className="check"><input type="checkbox" name="marketing" defaultChecked={!!p.data.marketing_opt_in_at} /> Email me offers and news{p.data.marketing_opt_in_at ? ` (opted in ${fmtDate(p.data.marketing_opt_in_at, { dateStyle: 'medium' })})` : ''}</label>
      <Button type="submit" busy={save.busy}>Save changes</Button>
    </form>
  );
}

function Addresses() {
  const a = useApi<any[]>('/addresses'); const [adding, setAdding] = useState(false); const toast = useToast();
  if (a.loading) return <Loading />;
  return (
    <>
      {!a.data?.length && !adding && <Empty title="No saved addresses" />}
      {a.data?.map((x) => (
        <div key={x.id} className="panel row between wrap">
          <div><strong>{x.label ?? x.recipient_name}</strong> {x.is_default && <Badge>Default</Badge>} {x.serviceable ? <Badge tone="ok">We deliver here</Badge> : <Badge tone="danger">Outside our area</Badge>}
            <div className="small muted">{x.line1}{x.line2 ? `, ${x.line2}` : ''}, {x.city} {x.postal_code} · {x.phone}</div></div>
          <Confirm size="sm" variant="secondary" message="Delete this address?" onConfirm={async () => { await del(`/addresses/${x.id}`); toast('Address removed'); a.reload(); }}>Delete</Confirm>
        </div>
      ))}
      {adding ? <div className="panel"><AddressForm onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); a.reload(); }} /></div> : <Button variant="secondary" onClick={() => setAdding(true)}>Add an address</Button>}
    </>
  );
}

function Favourites() {
  const f = useApi<any[]>('/favourites');
  if (f.loading) return <Loading />;
  if (!f.data?.length) return <Empty title="Nothing saved yet"><p>Tap “Save” on any product to keep it here.</p></Empty>;
  return <ProductGrid products={f.data} />;
}

function Tickets() {
  const t = useApi<{ id: string; subject: string; status: string; created_at: string }[]>('/support/tickets');
  const [open, setOpen] = useState<string | null>(null);
  if (t.loading) return <Loading />;
  if (!t.data?.length) return <Empty title="No help requests"><p>To report a problem, open an order and choose “Report a problem”.</p></Empty>;
  return <>{t.data.map((x) => <div key={x.id} className="panel"><div className="row between"><strong>{x.subject}</strong><StatusBadge status={x.status} /></div><div className="small muted">{fmtDate(x.created_at)}</div>
    <button className="link" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? 'Hide conversation' : 'View conversation'}</button>{open === x.id && <Thread id={x.id} />}</div>)}</>;
}
function Thread({ id }: { id: string }) {
  const t = useApi<{ messages: { body: string; mine: boolean; created_at: string }[] }>(`/support/tickets/${id}`);
  const send = useAction(async (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = e.currentTarget; await post(`/support/tickets/${id}/messages`, { body: new FormData(f).get('body') }); f.reset(); t.reload(); });
  if (t.loading) return <Loading />;
  return <div className="stack" style={{ marginTop: 8 }}>{t.data?.messages.map((m, i) => <div key={i} className={`notice ${m.mine ? '' : 'ok'}`}><strong>{m.mine ? 'You' : 'EAZyfoods'}</strong> · <span className="small muted">{fmtDate(m.created_at)}</span><br />{m.body}</div>)}
    <form onSubmit={send.run} className="row"><Input name="body" required placeholder="Write a reply…" aria-label="Reply" /><Button type="submit" busy={send.busy}>Send</Button></form></div>;
}

function Privacy() {
  const nav = useNavigate(); const { reload } = useAuth(); const toast = useToast();
  const pw = useAction(async (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); await post('/account/password', { current_password: f.get('current'), new_password: f.get('next') }); toast('Password changed. Please sign in again.'); await reload(); nav('/signin'); });
  const exp = async () => {
    const data = await api('/account/export'); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'my-eazyfoods-data.json'; a.click(); URL.revokeObjectURL(url);
  };
  const delAcct = useAction(async (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); await post('/account/delete', { password: new FormData(e.currentTarget).get('password') }); await reload(); toast('Your account was deleted'); nav('/'); });
  return (
    <>
      <section className="panel"><h2>Change password</h2>
        <form onSubmit={pw.run}>{pw.error && <ErrorBox message={pw.error} />}<Field label="Current password"><Input name="current" type="password" required autoComplete="current-password" /></Field><Field label="New password" hint="At least 10 characters."><Input name="next" type="password" minLength={10} required autoComplete="new-password" /></Field><Button type="submit" busy={pw.busy}>Change password</Button></form></section>
      <section className="panel"><h2>Your data</h2><p>Download a copy of the personal information we hold about you.</p><Button variant="secondary" onClick={exp}>Download my data</Button></section>
      <section className="panel"><h2>Delete my account</h2>
        <Notice tone="warn">This removes your name, contact details, addresses and saved items. We must keep anonymised order and payment records for accounting and tax purposes. You cannot delete while an order is in progress.</Notice>
        <form onSubmit={delAcct.run}>{delAcct.error && <ErrorBox message={delAcct.error} />}<Field label="Confirm with your password"><Input name="password" type="password" required autoComplete="current-password" /></Field><Button type="submit" variant="danger" busy={delAcct.busy}>Delete my account</Button></form></section>
    </>
  );
}
