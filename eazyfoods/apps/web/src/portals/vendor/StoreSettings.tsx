import { useEffect, useState } from 'react';
import { centsToDollars, dollarsToCents, put } from '../../api';
import type { Region } from '../../api';
import { useAction, useApi } from '../../hooks';
import { useToast } from '../../toast';
import { Button, Card, ErrorBox, Field, ImageUpload, Input, Loading, Notice, PageHeader, Textarea } from '../../ui';
import { StoreSelect, useVendor } from './Shared';

type Profile = { name: string; description: string | null; address_line: string | null; city: string; postal_code: string | null; phone: string | null; policies: string | null; offers_delivery: boolean; offers_pickup: boolean; ordering_paused: boolean; min_order_cents: number | null; logo_url: string | null; cover_url: string | null; status: string; regions: string[] };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function StoreSettings() {
  const { storeId } = useVendor();
  return (<><PageHeader title="Store" sub="What customers see on your storefront." /><StoreSelect /><ProfileForm key={storeId} /><HoursForm key={storeId + 'h'} /></>);
}

function ProfileForm() {
  const { storeId } = useVendor(); const toast = useToast();
  const p = useApi<Profile>(`/vendor/stores/${storeId}/profile`); const regions = useApi<Region[]>('/regions');
  const [f, setF] = useState<Profile | null>(null); const [min, setMin] = useState('');
  useEffect(() => { if (p.data) { setF(p.data); setMin(p.data.min_order_cents ? centsToDollars(p.data.min_order_cents) : ''); } }, [p.data]);
  const save = useAction(async () => {
    if (!f) return;
    await put(`/vendor/stores/${storeId}/profile`, { description: f.description || null, address_line: f.address_line ?? undefined, city: f.city, postal_code: f.postal_code ?? undefined, phone: f.phone ?? undefined, policies: f.policies || null,
      offers_delivery: f.offers_delivery, offers_pickup: f.offers_pickup, ordering_paused: f.ordering_paused, min_order_cents: min ? dollarsToCents(min) : null, logo_url: f.logo_url, cover_url: f.cover_url, regions: f.regions });
    toast('Store saved.'); p.reload();
  });
  if (p.loading && !f) return <Loading />;
  if (p.error) return <ErrorBox message={p.error} retry={p.reload} />;
  if (!f) return null;
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setF({ ...f, [k]: v });
  return (
    <Card><h2>{f.name}</h2>
      <form onSubmit={(e) => { e.preventDefault(); save.run(); }}>
        {save.error && <Notice tone="error">{save.error}</Notice>}
        <div className="switch-row"><label className="check"><input type="checkbox" checked={f.ordering_paused} onChange={(e) => set('ordering_paused', e.target.checked)} /><span><strong>Pause new orders</strong><br /><span className="muted small">Customers can browse but not check out. Use this when you are too busy or closing early.</span></span></label></div>
        <hr />
        <div className="row wrap top"><div><span className="label" style={{ fontWeight: 600, fontSize: '.9rem' }}>Logo</span><ImageUpload value={f.logo_url} onChange={(u) => set('logo_url', u)} label="Logo" /></div><div><span className="label" style={{ fontWeight: 600, fontSize: '.9rem' }}>Cover image</span><ImageUpload value={f.cover_url} onChange={(u) => set('cover_url', u)} label="Cover" /></div></div>
        <Field label="About your store"><Textarea value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} maxLength={1500} /></Field>
        <div className="form-grid">
          <Field label="Street address"><Input value={f.address_line ?? ''} onChange={(e) => set('address_line', e.target.value)} required minLength={3} /></Field>
          <Field label="City"><Input value={f.city} onChange={(e) => set('city', e.target.value)} required /></Field>
          <Field label="Postal code"><Input value={f.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} required /></Field>
          <Field label="Phone"><Input type="tel" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} required /></Field>
          <Field label="Minimum order (CAD, optional)"><Input type="number" step="0.01" min="0" value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" /></Field></div>
        <div className="row wrap"><label className="check"><input type="checkbox" checked={f.offers_delivery} onChange={(e) => set('offers_delivery', e.target.checked)} />We offer delivery</label><label className="check"><input type="checkbox" checked={f.offers_pickup} onChange={(e) => set('offers_pickup', e.target.checked)} />We offer pickup</label></div>
        <fieldset style={{ border: 0, padding: 0, margin: '10px 0' }}><legend className="label" style={{ fontWeight: 600, fontSize: '.9rem' }}>Regional specialties</legend>
          <div className="pill-list">{regions.data?.map((r) => <label key={r.slug} className="check"><input type="checkbox" checked={f.regions.includes(r.slug)} onChange={(e) => set('regions', e.target.checked ? [...f.regions, r.slug] : f.regions.filter((x) => x !== r.slug))} />{r.name}</label>)}</div></fieldset>
        <Field label="Store policies (optional)" hint="For example how you handle substitutions or pickup times."><Textarea value={f.policies ?? ''} onChange={(e) => set('policies', e.target.value)} maxLength={3000} /></Field>
        <Button type="submit" busy={save.busy}>Save store</Button></form></Card>);
}

type Day = { on: boolean; opens: string; closes: string };
function HoursForm() {
  const { storeId } = useVendor(); const toast = useToast();
  const h = useApi<{ dow: number; opens: string; closes: string }[]>(`/vendor/stores/${storeId}/hours`);
  const [days, setDays] = useState<Day[]>(DAYS.map(() => ({ on: false, opens: '09:00', closes: '18:00' }))); const [multi, setMulti] = useState(false);
  useEffect(() => {
    if (!h.data) return; const d: Day[] = DAYS.map(() => ({ on: false, opens: '09:00', closes: '18:00' }));
    const seen = new Set<number>(); let m = false;
    for (const r of h.data) { if (seen.has(r.dow)) { m = true; continue; } seen.add(r.dow); d[r.dow] = { on: true, opens: r.opens, closes: r.closes }; }
    setDays(d); setMulti(m);
  }, [h.data]);
  const save = useAction(async () => {
    await put(`/vendor/stores/${storeId}/hours`, { hours: days.flatMap((d, i) => (d.on ? [{ dow: i, opens: d.opens, closes: d.closes }] : [])) }); toast('Opening hours saved.'); h.reload();
  });
  const up = (i: number, p: Partial<Day>) => setDays(days.map((d, j) => (j === i ? { ...d, ...p } : d)));
  return (<Card><h2>Opening hours</h2><p className="muted small">Customers can only check out while you are open (store timezone: Calgary).</p>
    {multi && <Notice tone="warn">Some days have more than one opening window. Saving here keeps only the first window of each day.</Notice>}
    {save.error && <Notice tone="error">{save.error}</Notice>}
    {h.loading && !h.data ? <Loading /> : <form onSubmit={(e) => { e.preventDefault(); save.run(); }}>
      {days.map((d, i) => (<div key={i} className="week-row"><label className="check"><input type="checkbox" checked={d.on} onChange={(e) => up(i, { on: e.target.checked })} aria-label={`Open on ${DAYS[i]}`} />{DAYS[i]}</label>
        <Input type="time" value={d.opens} disabled={!d.on} onChange={(e) => up(i, { opens: e.target.value })} aria-label={`${DAYS[i]} opens`} /><Input type="time" value={d.closes} disabled={!d.on} onChange={(e) => up(i, { closes: e.target.value })} aria-label={`${DAYS[i]} closes`} />
        <span className="muted small">{d.on ? '' : 'Closed'}</span></div>))}
      <Button type="submit" busy={save.busy}>Save hours</Button></form>}</Card>);
}
