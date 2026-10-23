import { useRef, useState } from 'react';
import { api, centsToDollars, dollarsToCents, money, patch, post, put, fmtDate } from '../../api';
import type { Region } from '../../api';
import { useAction, useApi, useDebounced } from '../../hooks';
import { useToast } from '../../toast';
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Field, ImageUpload, Input, Loading, Modal, Notice, PageHeader, Select, Tabs, Textarea, formValues } from '../../ui';
import { StoreSelect, useVendor } from './Shared';

type Offer = { product_id: string; name: string; slug: string; price_cents: number; compare_at_cents: number | null; is_active: boolean; stock_on_hand: number; stock_reserved: number; available: number; low_stock: boolean };

export default function Inventory() {
  const { storeId } = useVendor();
  const [tab, setTab] = useState('list');
  return (
    <>
      <PageHeader title="Inventory" sub="Your prices and stock. Every stock change is recorded." />
      <StoreSelect />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'list', label: 'My products' }, { id: 'add', label: 'Add from catalogue' }, { id: 'suggest', label: 'Suggest new product' }, { id: 'csv', label: 'CSV import' }]} />
      {tab === 'list' && <List key={storeId} />}{tab === 'add' && <AddFromCatalogue key={storeId} />}{tab === 'suggest' && <Suggest />}{tab === 'csv' && <CsvImport key={storeId} />}
    </>
  );
}

function List() {
  const { storeId } = useVendor(); const toast = useToast();
  const { data, loading, error, reload } = useApi<Offer[]>(`/vendor/stores/${storeId}/offers`);
  const [edit, setEdit] = useState<Offer | null>(null); const [stock, setStock] = useState<Offer | null>(null); const [hist, setHist] = useState<Offer | null>(null);
  const [q, setQ] = useState('');
  const toggle = async (o: Offer) => { try { await put(`/vendor/stores/${storeId}/offers/${o.product_id}`, { price_cents: o.price_cents, compare_at_cents: o.compare_at_cents, is_active: !o.is_active }); reload(); } catch (e: any) { toast(e.message, 'error'); } };
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  const rows = (data ?? []).filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
  return (<>
    <Field label="Filter products"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a product name" /></Field>
    <DataTable rows={rows} rowKey={(r) => r.product_id} empty={<>You have not listed anything yet. Use “Add from catalogue”.</>} columns={[
      { key: 'name', header: 'Product', render: (o) => <strong>{o.name}</strong> },
      { key: 'price', header: 'Price', render: (o) => <>{money(o.price_cents)}{o.compare_at_cents ? <s className="muted small"> {money(o.compare_at_cents)}</s> : null}</> },
      { key: 'stock', header: 'On hand / reserved', render: (o) => `${o.stock_on_hand} / ${o.stock_reserved}` },
      { key: 'avail', header: 'Available', render: (o) => <>{o.available} {o.available <= 0 ? <Badge tone="danger">Out of stock</Badge> : o.low_stock ? <Badge tone="warn">Low</Badge> : null}</> },
      { key: 'active', header: 'Shown to customers', render: (o) => <label className="check"><input type="checkbox" checked={o.is_active} onChange={() => toggle(o)} aria-label={`Show ${o.name} to customers`} />{o.is_active ? 'Yes' : 'Hidden'}</label> },
      { key: 'act', header: '', render: (o) => <div className="row wrap"><Button size="sm" variant="secondary" onClick={() => setEdit(o)}>Price</Button><Button size="sm" variant="secondary" onClick={() => setStock(o)}>Stock</Button><Button size="sm" variant="ghost" onClick={() => setHist(o)}>History</Button></div> },
    ]} />
    {edit && <PriceModal o={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    {stock && <StockModal o={stock} onClose={() => setStock(null)} onDone={() => { setStock(null); reload(); }} />}
    {hist && <HistoryModal o={hist} onClose={() => setHist(null)} />}
  </>);
}

function PriceModal({ o, onClose, onDone }: { o: Offer; onClose: () => void; onDone: () => void }) {
  const { storeId } = useVendor(); const toast = useToast();
  const a = useAction(async (v: Record<string, string>) => {
    await put(`/vendor/stores/${storeId}/offers/${o.product_id}`, { price_cents: dollarsToCents(v.price), compare_at_cents: v.compare ? dollarsToCents(v.compare) : null, is_active: o.is_active });
    toast('Price saved.'); onDone();
  });
  return (<Modal open onClose={onClose} title={`Price: ${o.name}`}>
    <form onSubmit={(e) => a.run(formValues(e))}>{a.error && <Notice tone="error">{a.error}</Notice>}
      <Field label="Price (CAD)"><Input name="price" type="number" step="0.01" min="0.01" required defaultValue={centsToDollars(o.price_cents)} inputMode="decimal" /></Field>
      <Field label="Compare-at price (optional)" hint="A higher “was” price shown crossed out. Must be above the price."><Input name="compare" type="number" step="0.01" min="0.01" defaultValue={o.compare_at_cents ? centsToDollars(o.compare_at_cents) : ''} inputMode="decimal" /></Field>
      <div className="row end"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" busy={a.busy}>Save price</Button></div></form></Modal>);
}

function StockModal({ o, onClose, onDone }: { o: Offer; onClose: () => void; onDone: () => void }) {
  const { storeId } = useVendor(); const toast = useToast();
  const a = useAction(async (v: Record<string, string>) => {
    await post(`/vendor/stores/${storeId}/offers/${o.product_id}/stock`, { delta: Number(v.delta), reason: v.reason, note: v.note || undefined }); toast('Stock updated.'); onDone();
  });
  return (<Modal open onClose={onClose} title={`Stock: ${o.name}`}>
    <p className="muted">On hand {o.stock_on_hand}, reserved for open orders {o.stock_reserved}. Use a negative number to remove stock.</p>
    <form onSubmit={(e) => a.run(formValues(e))}>{a.error && <Notice tone="error">{a.error}</Notice>}
      <Field label="Change (+ or −)"><Input name="delta" type="number" step="1" required inputMode="numeric" placeholder="e.g. 12 or -2" /></Field>
      <Field label="Reason"><Select name="reason" defaultValue="receive"><option value="receive">Received stock</option><option value="correction">Count correction</option><option value="damage">Damaged</option><option value="expired">Expired</option><option value="return">Returned</option></Select></Field>
      <Field label="Note (optional)"><Input name="note" maxLength={300} /></Field>
      <div className="row end"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" busy={a.busy}>Update stock</Button></div></form></Modal>);
}

function HistoryModal({ o, onClose }: { o: Offer; onClose: () => void }) {
  const { storeId } = useVendor();
  const h = useApi<{ delta: number; reason: string; note: string | null; resulting_on_hand: number; created_at: string; actor: string | null }[]>(`/vendor/stores/${storeId}/offers/${o.product_id}/adjustments`);
  return (<Modal open onClose={onClose} title={`History: ${o.name}`}>
    {h.loading ? <Loading /> : h.error ? <ErrorBox message={h.error} /> :
      <DataTable rows={h.data ?? []} rowKey={(r) => r.created_at + r.delta + r.resulting_on_hand} empty="No changes recorded." columns={[
        { key: 'when', header: 'When', render: (r) => fmtDate(r.created_at) }, { key: 'delta', header: 'Change', render: (r) => (r.delta > 0 ? `+${r.delta}` : r.delta) },
        { key: 'reason', header: 'Reason', render: (r) => r.reason + (r.note ? ` — ${r.note}` : '') }, { key: 'res', header: 'On hand after', render: (r) => r.resulting_on_hand }, { key: 'actor', header: 'By', render: (r) => r.actor ?? 'System' }]} />}
  </Modal>);
}

type CatHit = { id: string; slug: string; name: string; brand: string | null; pack_size: string | null; pack_unit: string | null; already_listed: boolean };
function AddFromCatalogue() {
  const { storeId } = useVendor(); const toast = useToast();
  const [q, setQ] = useState(''); const dq = useDebounced(q, 300);
  const res = useApi<CatHit[]>(dq.trim().length >= 1 ? `/vendor/catalogue/search?q=${encodeURIComponent(dq.trim())}&storeId=${storeId}` : null);
  const [pick, setPick] = useState<CatHit | null>(null);
  const a = useAction(async (v: Record<string, string>) => {
    await put(`/vendor/stores/${storeId}/offers/${pick!.id}`, { price_cents: dollarsToCents(v.price), is_active: true });
    if (Number(v.stock) > 0) await post(`/vendor/stores/${storeId}/offers/${pick!.id}/stock`, { delta: Number(v.stock), reason: 'receive', note: 'Initial stock' });
    toast(`${pick!.name} is listed.`); setPick(null); res.reload();
  });
  return (<>
    <Field label="Search the shared catalogue" hint="Search by name, brand, barcode or a known alternative name."><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. garri, shito, berbere" /></Field>
    {res.loading && <Loading />}{res.error && <ErrorBox message={res.error} />}
    {res.data && <DataTable rows={res.data} rowKey={(r) => r.id} empty={<>No match. Try another spelling, or <em>Suggest new product</em>.</>} columns={[
      { key: 'name', header: 'Product', render: (r) => <><strong>{r.name}</strong> <span className="muted small">{r.brand ?? ''} {r.pack_size ? `${Number(r.pack_size)} ${r.pack_unit ?? ''}` : ''}</span></> },
      { key: 'a', header: '', render: (r) => r.already_listed ? <Badge tone="ok">Already listed</Badge> : <Button size="sm" onClick={() => setPick(r)}>List this</Button> }]} />}
    {pick && <Modal open onClose={() => setPick(null)} title={`List ${pick.name}`}>
      <form onSubmit={(e) => a.run(formValues(e))}>{a.error && <Notice tone="error">{a.error}</Notice>}
        <Field label="Your price (CAD)"><Input name="price" type="number" step="0.01" min="0.01" required inputMode="decimal" /></Field>
        <Field label="Stock on hand"><Input name="stock" type="number" min="0" step="1" defaultValue="0" required inputMode="numeric" /></Field>
        <div className="row end"><Button type="button" variant="ghost" onClick={() => setPick(null)}>Cancel</Button><Button type="submit" busy={a.busy}>List product</Button></div></form></Modal>}
  </>);
}

function Suggest() {
  const toast = useToast();
  const regions = useApi<Region[]>('/regions'); const cats = useApi<{ slug: string; name: string }[]>('/categories');
  const [img, setImg] = useState<string | null>(null); const [countries, setCountries] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const all = Array.from(new Map((regions.data ?? []).flatMap((r) => r.countries).map((c) => [c.slug, c])).values()).sort((a, b) => a.name.localeCompare(b.name));
  const a = useAction(async (v: Record<string, string>) => {
    await post('/vendor/products/suggest', { name: v.name, brand: v.brand || undefined, category_slug: v.category || undefined, description: v.description || undefined, pack_size: v.pack_size ? Number(v.pack_size) : undefined,
      pack_unit: v.pack_unit || undefined, barcode: v.barcode || undefined, ingredients: v.ingredients || undefined, sold_by: v.sold_by, country_slugs: countries, image_url: img });
    toast('Suggestion sent for review.'); setDone(true);
  });
  if (done) return <Notice tone="ok">Thank you. Our catalogue team will review your product. Once approved you can list it with your own price and stock. <button className="link" onClick={() => { setDone(false); setImg(null); setCountries([]); }}>Suggest another</button></Notice>;
  return (<Card><p className="muted">Can’t find a product in the catalogue? Suggest it. It stays hidden from customers until our team approves it.</p>
    <form onSubmit={(e) => a.run(formValues(e))}>{a.error && <Notice tone="error">{a.error}</Notice>}
      <ImageUpload value={img} onChange={setImg} label="Photo" />
      <div className="form-grid"><Field label="Product name"><Input name="name" required minLength={2} /></Field><Field label="Brand (optional)"><Input name="brand" /></Field>
        <Field label="Category"><Select name="category" defaultValue=""><option value="">Choose…</option>{cats.data?.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</Select></Field>
        <Field label="Sold by"><Select name="sold_by" defaultValue="unit"><option value="unit">Unit / pack</option><option value="weight">Weight</option></Select></Field>
        <Field label="Pack size"><Input name="pack_size" type="number" step="0.001" min="0" inputMode="decimal" /></Field><Field label="Unit (g, kg, ml…)"><Input name="pack_unit" maxLength={20} /></Field>
        <Field label="Barcode (optional)"><Input name="barcode" maxLength={32} /></Field></div>
      <Field label="Description"><Textarea name="description" maxLength={1500} /></Field><Field label="Ingredients (only if printed on the pack)"><Textarea name="ingredients" maxLength={1000} /></Field>
      <fieldset style={{ border: 0, padding: 0 }}><legend className="label" style={{ fontWeight: 600, fontSize: '.9rem' }}>Culinary tradition (countries)</legend>
        <div className="pill-list">{all.map((c) => <label key={c.slug} className="check"><input type="checkbox" checked={countries.includes(c.slug)} onChange={(e) => setCountries(e.target.checked ? [...countries, c.slug] : countries.filter((x) => x !== c.slug))} />{c.name}</label>)}</div></fieldset>
      <Button type="submit" busy={a.busy}>Send suggestion</Button></form></Card>);
}

type Imp = { dry_run: boolean; total_rows: number; succeeded: number; failed: number; errors: { row: number; message: string }[] };
function CsvImport() {
  const { storeId } = useVendor(); const toast = useToast();
  const [csv, setCsv] = useState(''); const [res, setRes] = useState<Imp | null>(null); const file = useRef<HTMLInputElement>(null);
  const hist = useApi<{ id: string; total_rows: number; succeeded: number; failed: number; errors: { row: number; message: string }[]; created_at: string }[]>(`/vendor/stores/${storeId}/imports`);
  const run = useAction(async (dry: boolean) => {
    const r = await post<Imp>(`/vendor/stores/${storeId}/import`, { csv, dry_run: dry }); setRes(r);
    if (!dry) { toast(`Imported ${r.succeeded} row(s).`); hist.reload(); }
  });
  const template = async () => { const t = await api<string>('/vendor/import-template'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = 'eazyfoods-import-template.csv'; a.click(); };
  void patch;
  return (<>
    <Card><p>Update many products at once. Each row needs <strong>price</strong>, <strong>stock</strong> and one of <strong>barcode</strong>, <strong>sku</strong> or <strong>slug</strong> (up to 2,000 rows). Always check first with a dry run.</p>
      <div className="row wrap"><Button variant="secondary" size="sm" onClick={template}>Download template</Button>
        <Button variant="secondary" size="sm" onClick={() => file.current?.click()}>Choose CSV file</Button>
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setCsv(await f.text()); setRes(null); } e.target.value = ''; }} /></div>
      <Field label="CSV contents"><Textarea className="csv-box" value={csv} onChange={(e) => { setCsv(e.target.value); setRes(null); }} placeholder="barcode,sku,slug,price,stock,active" /></Field>
      {run.error && <Notice tone="error">{run.error}</Notice>}
      <div className="row wrap"><Button variant="secondary" disabled={!csv.trim()} busy={run.busy} onClick={() => run.run(true)}>Check (dry run)</Button>
        <Button disabled={!csv.trim() || !res?.dry_run || res.succeeded === 0} busy={run.busy} onClick={() => run.run(false)}>Import {res?.dry_run ? `${res.succeeded} valid row(s)` : ''}</Button></div>
      {res && <div style={{ marginTop: 12 }}><Notice tone={res.failed ? 'warn' : 'ok'}><strong>{res.dry_run ? 'Dry run: nothing was changed.' : 'Import finished.'}</strong> {res.succeeded} of {res.total_rows} row(s) are valid{res.failed ? `, ${res.failed} need fixing` : ''}.</Notice>
        {res.errors.length > 0 && <DataTable rows={res.errors} rowKey={(r) => String(r.row)} columns={[{ key: 'row', header: 'Row' }, { key: 'message', header: 'Problem' }]} />}</div>}</Card>
    <h2>Import history</h2>
    {hist.loading ? <Loading /> : <DataTable rows={hist.data ?? []} rowKey={(r) => r.id} empty="No imports yet." columns={[{ key: 'w', header: 'When', render: (r) => fmtDate(r.created_at) }, { key: 't', header: 'Rows', render: (r) => r.total_rows }, { key: 's', header: 'Imported', render: (r) => r.succeeded },
      { key: 'f', header: 'Failed', render: (r) => (r.failed ? <details><summary>{r.failed} failed</summary>{r.errors.map((e) => <div key={e.row} className="small">Row {e.row}: {e.message}</div>)}</details> : '0') }]} />}
  </>);
}
export { Empty };
