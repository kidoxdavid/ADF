import { useState } from 'react';

import { useAction } from '../../hooks';
import { useToast } from '../../toast';
import { Badge, Button, Card, Field, Input, Modal, Notice, PageHeader, Select, Tabs, Textarea } from '../../ui';
import { CheckList, DataTable, Fetch, Need, lines, patch, post, put, useForm } from './common';

export function Taxonomy() {
  const [tab, setTab] = useState('regions');
  return (
    <Need perm={['catalog.manage']} what="managing the taxonomy">
      <PageHeader title="Taxonomy" sub="Regions, countries, categories and collections are data. Change them here, no code needed." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'regions', label: 'Regions' }, { id: 'countries', label: 'Countries' }, { id: 'categories', label: 'Categories' }, { id: 'collections', label: 'Collections' }]} />
      <Fetch path="/admin/taxonomy">{(t: any, reload) => (
        tab === 'regions' ? <Regions t={t} reload={reload} /> : tab === 'countries' ? <Countries t={t} reload={reload} /> : tab === 'categories' ? <Categories t={t} reload={reload} /> : <Collections t={t} reload={reload} />
      )}</Fetch>
    </Need>
  );
}

function Regions({ t, reload }: { t: any; reload: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState<any | null>(null);
  const f = useForm({ name: '', description: '', sort_order: '100', is_active: true });
  const [countries, setCountries] = useState<string[]>([]);
  const open = (r: any | null) => { setEdit(r ?? {}); f.setV({ name: r?.name ?? '', description: r?.description ?? '', sort_order: String(r?.sort_order ?? 100), is_active: r?.is_active ?? true }); setCountries(r?.countries ?? []); };
  const save = useAction(async () => {
    if (edit?.id) await patch(`/admin/regions/${edit.id}`, { name: f.v.name, description: f.v.description || null, is_active: f.v.is_active, sort_order: Number(f.v.sort_order), countries });
    else await post('/admin/regions', { name: f.v.name, description: f.v.description || undefined, sort_order: Number(f.v.sort_order), countries });
    toast('Region saved'); setEdit(null); reload();
  });
  return (
    <>
      <div className="row end" style={{ marginTop: 0, marginBottom: 10 }}><Button onClick={() => open(null)}>New region</Button></div>
      <DataTable rows={t.regions} rowKey={(r: any) => r.id} onRowClick={open} empty="No regions."
        columns={[{ key: 'name', header: 'Region', render: (r: any) => <strong>{r.name}</strong> }, { key: 'active', header: 'Shown', render: (r: any) => (r.is_active ? <Badge tone="ok">Active</Badge> : <Badge>Hidden</Badge>) },
          { key: 'sort', header: 'Order', render: (r: any) => r.sort_order }, { key: 'c', header: 'Countries', render: (r: any) => `${r.countries.length}` }]} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name}` : 'New region'}>
        {save.error && <Notice tone="error">{save.error}</Notice>}
        <Field label="Name"><Input value={f.v.name} onChange={f.set('name')} /></Field>
        <Field label="Description"><Textarea value={f.v.description} onChange={f.set('description')} /></Field>
        <Field label="Display order"><Input inputMode="numeric" value={f.v.sort_order} onChange={f.set('sort_order')} /></Field>
        {edit?.id && <label className="check"><input type="checkbox" checked={f.v.is_active} onChange={f.set('is_active')} />Shown to shoppers</label>}
        <p className="small muted">A country may belong to several regions (for example Cameroon in both West and Central Africa).</p>
        <CheckList options={t.countries.map((c: any) => ({ value: c.slug, label: c.name }))} value={countries} onChange={setCountries} />
        <div className="row end"><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button busy={save.busy} disabled={f.v.name.length < 2} onClick={() => save.run()}>Save</Button></div>
      </Modal>
    </>
  );
}

function Countries({ t, reload }: { t: any; reload: () => void }) {
  const toast = useToast();
  const f = useForm({ name: '', iso2: '' });
  const add = useAction(async () => { await post('/admin/countries', { name: f.v.name, iso2: f.v.iso2 || undefined }); f.setV({ name: '', iso2: '' }); toast('Country added'); reload(); });
  return (
    <>
      <Card><h3>Add a country</h3>{add.error && <Notice tone="error">{add.error}</Notice>}
        <div className="form-grid"><Field label="Name"><Input value={f.v.name} onChange={f.set('name')} /></Field><Field label="ISO code (2 letters, optional)"><Input maxLength={2} value={f.v.iso2} onChange={f.set('iso2')} /></Field></div>
        <Button busy={add.busy} disabled={f.v.name.length < 2} onClick={() => add.run()}>Add country</Button></Card>
      <DataTable rows={t.countries} rowKey={(c: any) => c.id} columns={[{ key: 'name', header: 'Country' }, { key: 'iso2', header: 'ISO' }, { key: 'slug', header: 'Slug' }]} />
    </>
  );
}

function Categories({ t, reload }: { t: any; reload: () => void }) {
  const toast = useToast();
  const f = useForm({ name: '', parent: '' });
  const add = useAction(async () => { await post('/admin/categories', { name: f.v.name, parent_slug: f.v.parent || undefined }); f.setV({ name: '', parent: '' }); toast('Category added'); reload(); });
  const byId = new Map<string, any>(t.categories.map((c: any) => [c.id, c]));
  return (
    <>
      <Card><h3>Add a category</h3>{add.error && <Notice tone="error">{add.error}</Notice>}
        <div className="form-grid"><Field label="Name"><Input value={f.v.name} onChange={f.set('name')} /></Field>
          <Field label="Parent (optional)"><Select value={f.v.parent} onChange={f.set('parent')}><option value="">Top level</option>{t.categories.filter((c: any) => !c.parent_id).map((c: any) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</Select></Field></div>
        <Button busy={add.busy} disabled={f.v.name.length < 2} onClick={() => add.run()}>Add category</Button></Card>
      <DataTable rows={t.categories} rowKey={(c: any) => c.id} columns={[{ key: 'name', header: 'Category', render: (c: any) => <strong>{c.name}</strong> }, { key: 'parent', header: 'Parent', render: (c: any) => byId.get(c.parent_id)?.name ?? '' }, { key: 'slug', header: 'Slug' }]} />
    </>
  );
}

function Collections({ t, reload }: { t: any; reload: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState<any | null>(null);
  const f = useForm({ title: '', subtitle: '', region_slug: '', category_slug: '', products: '', sort_order: '100', is_active: true });
  const open = (c: any | null) => { setEdit(c ?? {}); f.setV({ title: c?.title ?? '', subtitle: c?.subtitle ?? '', region_slug: c?.region_slug ?? '', category_slug: c?.category_slug ?? '', products: (c?.manual_products ?? []).join('\n'), sort_order: String(c?.sort_order ?? 100), is_active: c?.is_active ?? true }); };
  const save = useAction(async () => {
    const body = { title: f.v.title, subtitle: f.v.subtitle || null, region_slug: f.v.region_slug || null, category_slug: f.v.category_slug || null, product_slugs: lines(f.v.products), sort_order: Number(f.v.sort_order), is_active: f.v.is_active };
    if (edit?.id) await put(`/admin/collections/${edit.id}`, body); else await post('/admin/collections', body);
    toast('Collection saved'); setEdit(null); reload();
  });
  return (
    <>
      <div className="row end" style={{ marginTop: 0, marginBottom: 10 }}><Button onClick={() => open(null)}>New collection</Button></div>
      <DataTable rows={t.collections} rowKey={(c: any) => c.id} onRowClick={open} empty="No collections."
        columns={[{ key: 'title', header: 'Collection', render: (c: any) => <><strong>{c.title}</strong><div className="small muted">{c.subtitle}</div></> },
          { key: 'rule', header: 'Contents', render: (c: any) => (c.manual_products.length ? `${c.manual_products.length} hand-picked` : `Rule: ${[c.region_slug, c.category_slug].filter(Boolean).join(' + ') || 'none'}`) },
          { key: 'a', header: 'Shown', render: (c: any) => (c.is_active ? <Badge tone="ok">Active</Badge> : <Badge>Hidden</Badge>) }]} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit collection' : 'New collection'}>
        {save.error && <Notice tone="error">{save.error}</Notice>}
        <Field label="Title"><Input value={f.v.title} onChange={f.set('title')} /></Field>
        <Field label="Subtitle"><Input value={f.v.subtitle} onChange={f.set('subtitle')} /></Field>
        <p className="small muted">Hand-picked products win. If none are listed, the region and/or category rule fills the collection automatically.</p>
        <Field label="Product slugs (one per line)"><Textarea value={f.v.products} onChange={f.set('products')} placeholder="garri-white" /></Field>
        <div className="form-grid">
          <Field label="Region rule"><Select value={f.v.region_slug} onChange={f.set('region_slug')}><option value="">None</option>{t.regions.map((r: any) => <option key={r.slug} value={r.slug}>{r.name}</option>)}</Select></Field>
          <Field label="Category rule"><Select value={f.v.category_slug} onChange={f.set('category_slug')}><option value="">None</option>{t.categories.map((r: any) => <option key={r.slug} value={r.slug}>{r.name}</option>)}</Select></Field>
          <Field label="Display order"><Input inputMode="numeric" value={f.v.sort_order} onChange={f.set('sort_order')} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.v.is_active} onChange={f.set('is_active')} />Shown to shoppers</label>
        <div className="row end"><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button busy={save.busy} disabled={f.v.title.length < 2} onClick={() => save.run()}>Save</Button></div>
      </Modal>
    </>
  );
}
