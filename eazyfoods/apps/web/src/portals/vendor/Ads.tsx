import { useState } from 'react';
import { dollarsToCents, fmtDate, money, post } from '../../api';
import type { Region } from '../../api';
import { useAction, useApi } from '../../hooks';
import { useToast } from '../../toast';
import { Button, Card, DataTable, ErrorBox, Field, ImageUpload, Input, Loading, Notice, PageHeader, Select, StatusBadge, Textarea, formValues } from '../../ui';
import { StoreSelect, useVendor } from './Shared';

type Ad = { id: string; title: string; placement: string; status: string; review_note: string | null; cpc_cents: number; budget_cents: number; starts_at: string; ends_at: string; impressions: number; clicks: number; spent_cents: number };
const PLACEMENTS: Record<string, string> = { search_sponsored: 'Sponsored product in search results', home_banner: 'Home page banner', region_banner: 'Region banner', sponsored_store: 'Sponsored store' };
const localIso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function Ads() {
  const { storeId } = useVendor(); const toast = useToast();
  const ads = useApi<Ad[]>('/vendor/ads'); const offers = useApi<{ slug: string; name: string }[]>(`/vendor/stores/${storeId}/offers`); const regions = useApi<Region[]>('/regions');
  const [placement, setPlacement] = useState('search_sponsored'); const [img, setImg] = useState<string | null>(null);
  const create = useAction(async (v: Record<string, string>, form: HTMLFormElement) => {
    await post('/vendor/ads', { store_id: storeId, placement, product_slug: placement === 'search_sponsored' ? v.product : undefined, region_slug: placement === 'region_banner' && v.region ? v.region : undefined,
      title: v.title, body: v.body || undefined, image_url: img, cpc_cents: dollarsToCents(v.cpc), budget_cents: dollarsToCents(v.budget), starts_at: new Date(v.starts).toISOString(), ends_at: new Date(v.ends).toISOString() });
    toast('Campaign submitted for approval.'); setImg(null); form.reset(); ads.reload();
  });
  const now = new Date();
  return (<>
    <PageHeader title="Advertising" sub="Pay per click to be shown more prominently. Always labelled “Sponsored”." />
    <StoreSelect />
    <Notice>Every campaign is reviewed by EAZyfoods before it runs. You are charged per click up to your budget, never more. We report only what we measure — impressions, clicks and spend — and make no promise about sales.</Notice>
    <Card><h2>New campaign</h2>
      <form onSubmit={(e) => { const f = e.currentTarget; create.run(formValues(e), f); }}>
        {create.error && <Notice tone="error">{create.error}</Notice>}
        <div className="form-grid">
          <Field label="Where it appears"><Select value={placement} onChange={(e) => setPlacement(e.target.value)}>{Object.entries(PLACEMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          {placement === 'search_sponsored' && <Field label="Product to promote" hint="Only shown when it already matches what the shopper searched."><Select name="product" required defaultValue=""><option value="" disabled>Choose…</option>{offers.data?.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}</Select></Field>}
          {placement === 'region_banner' && <Field label="Region (optional)"><Select name="region" defaultValue=""><option value="">All regions</option>{regions.data?.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}</Select></Field>}
          <Field label="Headline"><Input name="title" required minLength={3} maxLength={80} /></Field>
          <Field label="Cost per click (CAD)"><Input name="cpc" type="number" step="0.01" min="0.01" required inputMode="decimal" defaultValue="0.50" /></Field>
          <Field label="Total budget (CAD)"><Input name="budget" type="number" step="0.01" min="0.01" required inputMode="decimal" defaultValue="25.00" /></Field>
          <Field label="Starts"><Input name="starts" type="datetime-local" required defaultValue={localIso(now)} /></Field>
          <Field label="Ends"><Input name="ends" type="datetime-local" required defaultValue={localIso(new Date(now.getTime() + 7 * 864e5))} /></Field></div>
        <Field label="Short text (optional)"><Textarea name="body" maxLength={200} style={{ minHeight: 64 }} /></Field>
        <ImageUpload value={img} onChange={setImg} label="Image" />
        <Button type="submit" busy={create.busy}>Submit for approval</Button></form></Card>
    <h2>Your campaigns</h2>
    {ads.loading && !ads.data ? <Loading /> : ads.error ? <ErrorBox message={ads.error} retry={ads.reload} /> :
      <DataTable rows={ads.data ?? []} rowKey={(r) => r.id} empty="No campaigns yet." columns={[
        { key: 't', header: 'Campaign', render: (r) => <><strong>{r.title}</strong><div className="muted small">{PLACEMENTS[r.placement]}</div>{r.review_note && <div className="small warnc">Reviewer: {r.review_note}</div>}</> },
        { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> }, { key: 'd', header: 'Dates', render: (r) => `${fmtDate(r.starts_at, { dateStyle: 'medium' })} → ${fmtDate(r.ends_at, { dateStyle: 'medium' })}` },
        { key: 'i', header: 'Impressions', render: (r) => r.impressions }, { key: 'c', header: 'Clicks', render: (r) => r.clicks },
        { key: 'sp', header: 'Spent / budget', render: (r) => `${money(r.spent_cents)} / ${money(r.budget_cents)}` }]} />}
  </>);
}
