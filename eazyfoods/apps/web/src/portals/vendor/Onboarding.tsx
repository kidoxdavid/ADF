import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, fmtDate, post, put } from '../../api';
import { useAction, useApi } from '../../hooks';
import { useToast } from '../../toast';
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, StatusBadge, formValues } from '../../ui';
import { useAuth } from '../../auth';

type OB = { vendor_status: string; store_status: string; store_id: string; store_slug: string; can_submit: boolean; items: { key: string; label: string; done: boolean; required: boolean; hint: string }[] };
type Doc = { id: string; kind: string; status: string; review_note: string | null; created_at: string };
const KINDS: Record<string, string> = { business_licence: 'Business licence', gst_registration: 'GST registration', food_premises_permit: 'Food premises permit', id: 'Owner ID', other: 'Other' };
const LINKS: Record<string, [string, string]> = { store_location: ['../store', 'Edit store'], hours: ['../store', 'Set hours'], regions: ['../store', 'Choose regions'], fulfilment: ['../store', 'Delivery / pickup'], products: ['../inventory', 'Add products'] };

export default function Onboarding() {
  const toast = useToast(); const { has } = useAuth();
  const ob = useApi<OB>('/vendor/onboarding'); const docs = useApi<Doc[]>('/vendor/documents');
  const page = useApi<{ body: string; needs_legal_review: boolean }>('/pages/vendor-agreement');
  const prof = useApi<{ name: string; legal_name: string | null; business_number: string | null; phone: string | null; contact_email: string | null }>('/vendor/profile');
  const [open, setOpen] = useState<string | null>(null);
  const owner = has('vendor_owner');
  const refresh = () => { ob.reload(); docs.reload(); };
  const profile = useAction(async (v: Record<string, string>) => { await put('/vendor/profile', { name: v.name, legal_name: v.legal_name || null, business_number: v.business_number || null, phone: v.phone, contact_email: v.contact_email }); toast('Business details saved.'); setOpen(null); refresh(); });
  const accept = useAction(async () => { await post('/vendor/agreement/accept'); toast('Agreement accepted.'); refresh(); });
  const submit = useAction(async () => { await post('/vendor/submit'); toast('Submitted for review.'); refresh(); });
  const [kind, setKind] = useState('business_licence'); const [upErr, setUpErr] = useState<string>(); const [upBusy, setUpBusy] = useState(false);
  const uploadDoc = async (file: File) => {
    setUpBusy(true); setUpErr(undefined);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`/api/vendor/documents?kind=${kind}`, { method: 'POST', body: fd, credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, data.message ?? 'Upload failed');
      toast('Document uploaded for review.'); refresh();
    } catch (e: any) { setUpErr(e.message); } finally { setUpBusy(false); }
  };
  if (ob.loading && !ob.data) return <Loading />;
  if (ob.error) return <ErrorBox message={ob.error} retry={ob.reload} />;
  if (!ob.data) return null;
  const d = ob.data; const draft = d.vendor_status === 'draft';
  const msg: Record<string, [string, 'info' | 'warn' | 'ok' | 'error']> = {
    draft: ['Finish the required steps below, then submit your store for review. Nothing is public until we approve it.', 'info'],
    submitted: ['Submitted. Our team is reviewing your documents. We will email you when you are approved.', 'warn'],
    approved: [d.store_status === 'published' ? 'Your store is approved and live.' : 'Approved. Our team will publish your store; you can add products meanwhile.', 'ok'], suspended: ['Your account is suspended. Please contact support from the Help page.', 'error'] };
  const [text, tone] = msg[d.vendor_status] ?? ['', 'info'];
  return (<>
    <PageHeader title="Setup" sub="Get your store ready to sell" actions={<StatusBadge status={d.vendor_status} />} />
    <Notice tone={tone}>{text}</Notice>
    {!owner && <Notice tone="warn">Only the store owner can change business details or accept the agreement.</Notice>}
    <Card><ul className="checklist">{d.items.map((it) => (
      <li key={it.key}><span className={`mark ${it.done ? 'done' : ''}`} aria-hidden="true">{it.done ? '✓' : ''}</span>
        <div className="grow"><strong>{it.label}</strong> {it.required ? <Badge tone={it.done ? 'ok' : 'warn'}>{it.done ? 'Done' : 'Required'}</Badge> : <Badge>{it.done ? 'Done' : 'Recommended'}</Badge>}<div className="muted small">{it.hint}</div>
          {LINKS[it.key] && <Link to={LINKS[it.key][0]}>{LINKS[it.key][1]}</Link>}
          {it.key === 'business_details' && owner && <button className="link" onClick={() => setOpen(open === 'biz' ? null : 'biz')}>{it.done ? 'Update details' : 'Enter details'}</button>}
          {open === 'biz' && it.key === 'business_details' && (
            <form onSubmit={(e) => profile.run(formValues(e))} style={{ marginTop: 10 }}>{profile.error && <Notice tone="error">{profile.error}</Notice>}
              <div className="form-grid"><Field label="Business name"><Input name="name" required minLength={2} defaultValue={prof.data?.name ?? ''} /></Field><Field label="Legal name (optional)"><Input name="legal_name" defaultValue={prof.data?.legal_name ?? ''} /></Field>
                <Field label="Business / GST number"><Input name="business_number" required defaultValue={prof.data?.business_number ?? ''} /></Field><Field label="Phone"><Input name="phone" type="tel" required defaultValue={prof.data?.phone ?? ''} /></Field><Field label="Contact email"><Input name="contact_email" type="email" required defaultValue={prof.data?.contact_email ?? ''} /></Field></div>
              <Button type="submit" size="sm" busy={profile.busy}>Save details</Button></form>)}
          {it.key === 'agreement' && (<div style={{ marginTop: 8 }}>
            {page.data && <>{page.data.needs_legal_review && <Notice tone="warn"><strong>Draft agreement.</strong> This text has not yet been reviewed by a legal professional and may change.</Notice>}<div className="agreement">{page.data.body.replace(/^## /gm, "")}</div></>}
            {accept.error && <Notice tone="error">{accept.error}</Notice>}
            {!it.done && owner && <Button size="sm" busy={accept.busy} onClick={() => accept.run()} style={{ marginTop: 8 }}>I have read and accept</Button>}</div>)}
        </div></li>))}</ul></Card>
    <Card><h2>Business documents</h2><p className="muted small">Uploaded files are private. Only our verification team can open them. PDF, JPG, PNG or WebP, up to 5 MB.</p>
      {upErr && <Notice tone="error">{upErr}</Notice>}
      <div className="row wrap"><Field label="Type" className="grow"><Select value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <label className="btn secondary">{upBusy ? 'Uploading…' : 'Choose file'}<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" disabled={upBusy} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc(f); e.target.value = ''; }} /></label></div>
      <DataTable rows={docs.data ?? []} rowKey={(r) => r.id} empty="No documents uploaded yet." columns={[{ key: 'k', header: 'Document', render: (r) => KINDS[r.kind] ?? r.kind }, { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'n', header: 'Reviewer note', render: (r) => r.review_note ?? '' }, { key: 'w', header: 'Uploaded', render: (r) => fmtDate(r.created_at) }]} /></Card>
    {draft && owner && <Card><h2>Submit for review</h2>{!d.can_submit && <p className="muted">Complete every “Required” step above to enable submission.</p>}
      {submit.error && <Notice tone="error">{submit.error}</Notice>}<Button size="lg" disabled={!d.can_submit} busy={submit.busy} onClick={() => submit.run()}>Submit store for review</Button></Card>}
  </>);
}
