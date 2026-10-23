import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAction, useApi } from '../../hooks';
import { useToast } from '../../toast';
import { Badge, Button, Card, Field, ImageUpload, Input, Loading, Modal, Notice, PageHeader, Select, StatusBadge, Textarea } from '../../ui';
import { CheckList, DataTable, Fetch, Need, del, patch, post, put, useForm } from './common';

export function Catalogue() {
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const path = `/admin/products?${new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}) })}`;
  return (
    <Need perm={['catalog.manage']} what="managing the catalogue">
      <PageHeader title="Catalogue" sub="Shared products. Vendor suggestions arrive as Pending and stay hidden until you publish them." actions={<Button onClick={() => setCreating(true)}>New product</Button>} />
      <div className="filters-row">
        <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option><option value="pending">Pending review</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></Select></Field>
        <Field label="Search name"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. garri" /></Field>
      </div>
      <Fetch path={path}>{(rows: any[]) => (
        <DataTable rows={rows} rowKey={(r) => r.id} onRowClick={(r) => nav(`/admin/catalogue/${r.id}`)} empty="No products match."
          columns={[
            { key: 'name', header: 'Product', render: (r) => <><strong>{r.name}</strong><div className="small muted">{r.brand ?? 'No brand'} · {r.category ?? 'No category'}</div></> },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'by', header: 'Suggested by', render: (r) => r.suggested_by ?? '' },
            { key: 'offers', header: 'Store offers' },
            { key: 'images', header: 'Photos', render: (r) => (r.images ? r.images : <span className="muted">none</span>) },
          ]} />
      )}</Fetch>
      <NewProduct open={creating} onClose={() => setCreating(false)} />
    </Need>
  );
}

function NewProduct({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const f = useForm({ name: '', brand: '' });
  const create = useAction(async () => {
    const r = await post('/admin/products', { name: f.v.name, brand: f.v.brand || undefined, status: 'draft' });
    nav(`/admin/catalogue/${r.id}`);
  });
  return (
    <Modal open={open} onClose={onClose} title="New product">
      {create.error && <Notice tone="error">{create.error}</Notice>}
      <Field label="Product name"><Input value={f.v.name} onChange={f.set('name')} autoFocus /></Field>
      <Field label="Brand (optional)"><Input value={f.v.brand} onChange={f.set('brand')} /></Field>
      <p className="small muted">It is created as a draft. Add details, countries and photos on the next screen, then publish.</p>
      <div className="row end"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={create.busy} disabled={f.v.name.trim().length < 2} onClick={() => create.run()}>Create</Button></div>
    </Modal>
  );
}

type AllergenMode = 'unknown' | 'none' | 'list';

export function ProductEditor() {
  const { id } = useParams();
  return (
    <Need perm={['catalog.manage']} what="managing the catalogue">
      <Fetch path={`/admin/products/${id}`}>{(p: any, reload) => <Editor p={p} reload={reload} />}</Fetch>
    </Need>
  );
}

function Editor({ p, reload }: { p: any; reload: () => void }) {
  const toast = useToast();
  const tax = useApi<any>('/admin/taxonomy');
  const mode: AllergenMode = p.allergens == null ? 'unknown' : p.allergens.length ? 'list' : 'none';
  const f = useForm({
    name: p.name, brand: p.brand ?? '', category_slug: p.category_slug ?? '', description: p.description ?? '', sku: p.sku ?? '', barcode: p.barcode ?? '', sold_by: p.sold_by,
    pack_size: p.pack_size ?? '', pack_unit: p.pack_unit ?? '', ingredients: p.ingredients ?? '', storage_info: p.storage_info ?? '', manufacturer: p.manufacturer ?? '',
    tax_class: p.tax_class, status: p.status, seo_title: p.seo_title ?? '', seo_description: p.seo_description ?? '',
    allergen_mode: mode as AllergenMode, allergens: (p.allergens ?? []).join(', '),
  });
  const [culinary, setCulinary] = useState<string[]>(p.countries.filter((c: any) => c.kind === 'culinary').map((c: any) => c.slug));
  const [made, setMade] = useState<string[]>(p.countries.filter((c: any) => c.kind === 'manufacturing').map((c: any) => c.slug));
  const [alias, setAlias] = useState('');
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [alt, setAlt] = useState('');
  useEffect(() => { setAlt((a) => a || p.name); }, [p.name]);

  const save = useAction(async () => {
    const v = f.v;
    const allergens = v.allergen_mode === 'unknown' ? null : v.allergen_mode === 'none' ? [] : v.allergens.split(',').map((s: string) => s.trim()).filter(Boolean);
    await patch(`/admin/products/${p.id}`, {
      name: v.name, brand: v.brand || null, category_slug: v.category_slug || null, description: v.description || null, sku: v.sku || null, barcode: v.barcode || null, sold_by: v.sold_by,
      pack_size: v.pack_size === '' ? null : Number(v.pack_size), pack_unit: v.pack_unit || null, ingredients: v.ingredients || null, allergens, storage_info: v.storage_info || null,
      manufacturer: v.manufacturer || null, tax_class: v.tax_class, status: v.status, seo_title: v.seo_title || null, seo_description: v.seo_description || null,
    });
    await put(`/admin/products/${p.id}/countries`, { culinary, manufacturing: made });
    toast('Product saved'); reload();
  });
  const addAlias = useAction(async () => { await post(`/admin/products/${p.id}/aliases`, { alias, verified: false }); setAlias(''); toast('Alias added (not searchable until verified)'); reload(); });
  const setVerified = useAction(async (id: string, verified: boolean) => { await patch(`/admin/aliases/${id}`, { verified }); toast(verified ? 'Alias verified: now searchable' : 'Alias hidden from search'); reload(); });
  const rmAlias = useAction(async (id: string) => { await del(`/admin/aliases/${id}`); reload(); });
  const addImage = useAction(async () => { await post(`/admin/products/${p.id}/images`, { url: imgUrl, alt }); setImgUrl(null); toast('Photo added'); reload(); });
  const rmImage = useAction(async (id: string) => { await del(`/admin/product-images/${id}`); reload(); });

  const countries = (tax.data?.countries ?? []).map((c: any) => ({ value: c.slug, label: c.name }));
  const cats = tax.data?.categories ?? [];

  return (
    <>
      <PageHeader title={p.name} sub={<><StatusBadge status={p.status} /> · <Link to="/admin/catalogue">All products</Link>{p.suggested_by_vendor_id && <> · <Badge tone="info">Vendor suggestion</Badge></>}</>}
        actions={<Button busy={save.busy} onClick={() => save.run()}>Save changes</Button>} />
      {save.error && <Notice tone="error">{save.error}</Notice>}
      {p.status === 'pending' && <Notice tone="warn">Pending review. Check the details, then set Status to Published and save. Until then it is hidden from shoppers.</Notice>}

      <Card><h3>Details</h3>
        <div className="form-grid">
          <Field label="Name"><Input value={f.v.name} onChange={f.set('name')} /></Field>
          <Field label="Brand"><Input value={f.v.brand} onChange={f.set('brand')} /></Field>
          <Field label="Category"><Select value={f.v.category_slug} onChange={f.set('category_slug')}><option value="">None</option>{cats.map((c: any) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</Select></Field>
          <Field label="Status"><Select value={f.v.status} onChange={f.set('status')}><option value="draft">Draft</option><option value="pending">Pending</option><option value="published">Published</option><option value="archived">Archived</option></Select></Field>
          <Field label="Sold by"><Select value={f.v.sold_by} onChange={f.set('sold_by')}><option value="unit">Fixed unit / pack</option><option value="weight">Weight (price is per unit, final weight may vary)</option></Select></Field>
          <Field label="Pack size"><Input inputMode="decimal" value={f.v.pack_size} onChange={f.set('pack_size')} /></Field>
          <Field label="Pack unit" hint="g, kg, ml, L…"><Input value={f.v.pack_unit} onChange={f.set('pack_unit')} /></Field>
          <Field label="Tax class" hint="Zero-rated basic groceries vs standard-rated items. Confirm with your accountant."><Select value={f.v.tax_class} onChange={f.set('tax_class')}><option value="zero_rated">Zero-rated (0%)</option><option value="standard">Standard (GST)</option></Select></Field>
          <Field label="SKU"><Input value={f.v.sku} onChange={f.set('sku')} /></Field>
          <Field label="Barcode"><Input value={f.v.barcode} onChange={f.set('barcode')} /></Field>
          <Field label="Manufacturer"><Input value={f.v.manufacturer} onChange={f.set('manufacturer')} /></Field>
        </div>
        <Field label="Description"><Textarea value={f.v.description} onChange={f.set('description')} /></Field>
        <Field label="Ingredients"><Textarea value={f.v.ingredients} onChange={f.set('ingredients')} /></Field>
        <Field label="Storage and handling"><Input value={f.v.storage_info} onChange={f.set('storage_info')} /></Field>
      </Card>

      <Card><h3>Allergens</h3>
        <p className="small muted">“Not supplied” and “none” are different. Only choose “None declared” when the packaging or supplier says so. Customers see the difference.</p>
        <Field label="Allergen information"><Select value={f.v.allergen_mode} onChange={f.set('allergen_mode')}>
          <option value="unknown">Not supplied (unknown)</option><option value="none">None declared</option><option value="list">Contains…</option></Select></Field>
        {f.v.allergen_mode === 'list' && <Field label="Allergens (comma separated)" hint="e.g. fish, crustaceans, peanuts"><Input value={f.v.allergens} onChange={f.set('allergens')} /></Field>}
      </Card>

      <Card><h3>Countries</h3>
        <p className="small muted">Culinary tradition (where the dish or ingredient belongs) is not the same as where it was made. Don’t assume they match.</p>
        {tax.loading ? <Loading /> : <div className="grid cols-2">
          <div><strong>Culinary tradition</strong><CheckList options={countries} value={culinary} onChange={setCulinary} /></div>
          <div><strong>Made in</strong><CheckList options={countries} value={made} onChange={setMade} /></div>
        </div>}
        <p className="small muted">Saved with the “Save changes” button above.</p>
      </Card>

      <Card><h3>Search aliases</h3>
        <Notice tone="warn">Only <strong>verified</strong> aliases are searchable. Verify an alias only when it names the <em>same</em> product (a genuine alternative name or spelling). Never use an alias to link a different ingredient, especially where allergens or diets matter.</Notice>
        {(setVerified.error || addAlias.error) && <Notice tone="error">{setVerified.error ?? addAlias.error}</Notice>}
        <DataTable rows={p.aliases} rowKey={(a: any) => a.id} empty="No aliases yet."
          columns={[{ key: 'alias', header: 'Alias', render: (a: any) => <strong>{a.alias}</strong> }, { key: 'v', header: 'State', render: (a: any) => (a.verified ? <Badge tone="ok">Verified, searchable</Badge> : <Badge tone="warn">Unverified, hidden</Badge>) },
            { key: 'a', header: '', render: (a: any) => <div className="row wrap"><Button size="sm" variant={a.verified ? 'secondary' : 'primary'} onClick={() => setVerified.run(a.id, !a.verified)}>{a.verified ? 'Un-verify' : 'Verify'}</Button><Button size="sm" variant="ghost" onClick={() => rmAlias.run(a.id)}>Delete</Button></div> }]} />
        <div className="row wrap top" style={{ marginTop: 12 }}><div className="grow"><Field label="New alias"><Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="e.g. Gari" /></Field></div>
          <Button busy={addAlias.busy} disabled={alias.trim().length < 2} onClick={() => addAlias.run()} style={{ marginTop: 22 }}>Add</Button></div>
      </Card>

      <Card><h3>Photos</h3>
        <p className="small muted">Use real photos of the actual product. Each needs a short description for screen readers.</p>
        <div className="grid cols-3">{p.images.map((i: any) => (
          <div key={i.id} className="stack"><img src={i.url} alt={i.alt} style={{ borderRadius: 8, aspectRatio: '4/3', objectFit: 'cover' }} /><span className="small">{i.alt}</span><Button size="sm" variant="ghost" onClick={() => rmImage.run(i.id)}>Remove</Button></div>))}</div>
        {!p.images.length && <p className="muted">No photos yet. Shoppers see an initials tile.</p>}
        <hr />
        <ImageUpload value={imgUrl} onChange={setImgUrl} label="Photo" />
        {imgUrl && <><Field label="Description of the photo"><Input value={alt} onChange={(e) => setAlt(e.target.value)} /></Field>{addImage.error && <Notice tone="error">{addImage.error}</Notice>}<Button busy={addImage.busy} disabled={alt.length < 2} onClick={() => addImage.run()}>Attach photo</Button></>}
      </Card>

      <Card><h3>Search engine text (optional)</h3>
        <Field label="SEO title"><Input value={f.v.seo_title} onChange={f.set('seo_title')} /></Field>
        <Field label="SEO description"><Textarea value={f.v.seo_description} onChange={f.set('seo_description')} /></Field>
      </Card>
      <div className="row end"><Button size="lg" busy={save.busy} onClick={() => save.run()}>Save changes</Button></div>
    </>
  );
}
