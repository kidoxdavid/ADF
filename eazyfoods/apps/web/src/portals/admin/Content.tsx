import { useState } from 'react';
import { api, fmtDate } from '../../api';
import { useAction, useApi } from '../../hooks';
import { useToast } from '../../toast';
import { Badge, Button, Card, Field, Input, Loading, Modal, Notice, PageHeader, Select, StatusBadge, Tabs, Textarea } from '../../ui';
import { DataTable, Fetch, Need, lines, post, put, useForm } from './common';

export function Content() {
  const [tab, setTab] = useState('home');
  return (
    <Need perm={['content.manage']} what="managing content">
      <PageHeader title="Content" sub="Homepage text, policy pages, email templates and recipes." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'home', label: 'Homepage' }, { id: 'pages', label: 'Pages & policies' }, { id: 'templates', label: 'Email templates' }, { id: 'recipes', label: 'Recipes' }]} />
      {tab === 'home' ? <Home /> : tab === 'pages' ? <Pages /> : tab === 'templates' ? <Templates /> : <Recipes />}
    </Need>
  );
}

function Home() {
  const toast = useToast();
  return (
    <Fetch path="/content/home">{(c: any, reload) => <HomeForm c={c} toast={toast} reload={reload} />}</Fetch>
  );
}
function HomeForm({ c, toast, reload }: { c: any; toast: (s: string, k?: 'ok' | 'error') => void; reload: () => void }) {
  const h = useForm({ title: c.home_hero?.title ?? '', subtitle: c.home_hero?.subtitle ?? '' });
  const a = useForm({ text: c.announcement?.text ?? '', active: !!c.announcement?.active });
  const sh = useAction(async () => { await put('/admin/content/home_hero', h.v); toast('Homepage text saved'); reload(); });
  const sa = useAction(async () => { await put('/admin/content/announcement', a.v); toast('Announcement saved'); reload(); });
  return (
    <>
      <Card><h3>Homepage headline</h3>{sh.error && <Notice tone="error">{sh.error}</Notice>}
        <Field label="Headline"><Textarea value={h.v.title} onChange={h.set('title')} style={{ minHeight: 70 }} /></Field>
        <Field label="Sub-headline"><Textarea value={h.v.subtitle} onChange={h.set('subtitle')} /></Field>
        <Button busy={sh.busy} onClick={() => sh.run()}>Save</Button></Card>
      <Card><h3>Announcement bar</h3>{sa.error && <Notice tone="error">{sa.error}</Notice>}
        <p className="small muted">Shown at the very top of the shop. Only make claims you can stand behind.</p>
        <Field label="Text"><Input maxLength={200} value={a.v.text} onChange={a.set('text')} /></Field>
        <label className="check"><input type="checkbox" checked={a.v.active} onChange={a.set('active')} />Show it</label>
        <Button busy={sa.busy} onClick={() => sa.run()}>Save</Button></Card>
    </>
  );
}

function Pages() {
  const toast = useToast();
  const [edit, setEdit] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const f = useForm({ slug: '', title: '', body: '', status: 'published', needs_legal_review: false });
  const open = async (slug: string | null) => {
    if (!slug) { f.setV({ slug: '', title: '', body: '', status: 'draft', needs_legal_review: false }); setIsNew(true); setEdit(''); return; }
    const p = await api<any>(`/admin/pages/${slug}`); f.setV({ slug, title: p.title, body: p.body, status: p.status, needs_legal_review: p.needs_legal_review }); setIsNew(false); setEdit(slug);
  };
  const save = useAction(async (reload: () => void) => { await put(`/admin/pages/${f.v.slug}`, { title: f.v.title, body: f.v.body, status: f.v.status, needs_legal_review: f.v.needs_legal_review }); toast('Page saved'); setEdit(null); reload(); });
  return (
    <Fetch path="/admin/pages">{(rows: any[], reload) => (
      <>
        <div className="row end" style={{ marginTop: 0, marginBottom: 10 }}><Button onClick={() => open(null)}>New page</Button></div>
        <DataTable rows={rows} rowKey={(r) => r.slug} onRowClick={(r) => open(r.slug)}
          columns={[{ key: 't', header: 'Page', render: (r) => <><strong>{r.title}</strong><div className="small muted">/pages/{r.slug}</div></> }, { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'l', header: 'Legal', render: (r) => (r.needs_legal_review ? <Badge tone="danger">Needs legal review</Badge> : <span className="muted">—</span>) }, { key: 'u', header: 'Updated', render: (r) => fmtDate(r.updated_at) }]} />
        <Modal open={edit !== null} onClose={() => setEdit(null)} title={isNew ? 'New page' : 'Edit page'}>
          {save.error && <Notice tone="error">{save.error}</Notice>}
          {f.v.needs_legal_review && <div className="legal">This page is flagged as needing legal review before launch. Do not publish it as final until a qualified professional has approved it.</div>}
          {isNew && <Field label="Address (slug)" hint="lowercase letters, numbers and dashes"><Input value={f.v.slug} onChange={f.set('slug')} /></Field>}
          <Field label="Title"><Input value={f.v.title} onChange={f.set('title')} /></Field>
          <Field label="Body" hint="Use ## for headings; blank line between paragraphs."><Textarea style={{ minHeight: 240 }} value={f.v.body} onChange={f.set('body')} /></Field>
          <div className="form-grid"><Field label="Status"><Select value={f.v.status} onChange={f.set('status')}><option value="published">Published</option><option value="draft">Draft</option></Select></Field></div>
          <label className="check"><input type="checkbox" checked={f.v.needs_legal_review} onChange={f.set('needs_legal_review')} />Needs legal review before launch</label>
          <div className="row end"><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button busy={save.busy} disabled={!/^[a-z0-9-]+$/.test(f.v.slug) || f.v.title.length < 2 || !f.v.body} onClick={() => save.run(reload)}>Save page</Button></div>
        </Modal>
      </>
    )}</Fetch>
  );
}

const VARS: Record<string, string> = {
  order_confirmed: 'order_number, total, web_url', order_status: 'order_number, status, note, web_url', vendor_new_order: 'order_number, web_url', refund_processed: 'order_number, amount',
  substitution_proposed: 'order_number, web_url', password_reset: 'link', email_verify: 'link', vendor_approved: 'name, web_url',
};
function Templates() {
  const toast = useToast();
  const [edit, setEdit] = useState<any | null>(null);
  const f = useForm({ subject: '', body: '' });
  const save = useAction(async (reload: () => void) => { await put(`/admin/templates/${edit.key}`, f.v); toast('Template saved'); setEdit(null); reload(); });
  return (
    <Fetch path="/admin/templates">{(rows: any[], reload) => (
      <>
        <DataTable rows={rows} rowKey={(r) => r.key} onRowClick={(r) => { setEdit(r); f.setV({ subject: r.subject, body: r.body }); }}
          columns={[{ key: 'k', header: 'Template', render: (r) => <strong>{r.key.replace(/_/g, ' ')}</strong> }, { key: 's', header: 'Subject' }, { key: 'u', header: 'Updated', render: (r) => fmtDate(r.updated_at) }]} />
        <Modal open={!!edit} onClose={() => setEdit(null)} title={`Template: ${edit?.key ?? ''}`}>
          {save.error && <Notice tone="error">{save.error}</Notice>}
          <p className="small muted">Available variables: {(VARS[edit?.key] ?? 'see the current text').split(', ').map((v: string) => <code key={v} style={{ marginRight: 6 }}>{`{{${v}}}`}</code>)}</p>
          <Field label="Subject"><Input value={f.v.subject} onChange={f.set('subject')} /></Field>
          <Field label="Body"><Textarea style={{ minHeight: 200 }} value={f.v.body} onChange={f.set('body')} /></Field>
          <div className="row end"><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button busy={save.busy} onClick={() => save.run(reload)}>Save</Button></div>
        </Modal>
      </>
    )}</Fetch>
  );
}

type Ing = { label: string; quantity_text: string; product_slug: string; optional: boolean; alternative_slugs: string };
const blankIng = (): Ing => ({ label: '', quantity_text: '', product_slug: '', optional: false, alternative_slugs: '' });

function Recipes() {
  const toast = useToast();
  const tax = useApi<any>('/admin/taxonomy');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string>();
  const f = useForm({ title: '', summary: '', region_slug: '', country_slug: '', servings: '4', prep: '', cook: '', steps: '', safety: '', reviewed: false, status: 'draft' });
  const [ings, setIngs] = useState<Ing[]>([blankIng()]);
  const reset = () => { f.setV({ title: '', summary: '', region_slug: '', country_slug: '', servings: '4', prep: '', cook: '', steps: '', safety: '', reviewed: false, status: 'draft' }); setIngs([blankIng()]); setLoadErr(undefined); };
  const edit = async (r: any) => {
    reset(); setEditing(r.id); setOpen(true);
    try {
      const d = await api<any>(`/admin/recipes/${r.id}`);
      f.setV({ title: d.title, summary: d.summary ?? '', region_slug: d.region_slug ?? '', country_slug: d.country_slug ?? '', servings: String(d.servings), prep: d.prep_minutes ?? '', cook: d.cook_minutes ?? '', steps: d.steps.join('\n'), safety: d.food_safety_note ?? '', reviewed: d.reviewed, status: d.status });
      setIngs(d.ingredients.map((i: any) => ({ label: i.label, quantity_text: i.quantity_text ?? '', product_slug: i.product_slug ?? '', optional: i.optional, alternative_slugs: (i.alternative_slugs ?? []).join(', ') })));
    } catch { setLoadErr('Could not load this recipe for editing.'); }
  };
  const save = useAction(async (reload: () => void) => {
    const v = f.v;
    const body = { title: v.title, summary: v.summary || undefined, region_slug: v.region_slug || undefined, country_slug: v.country_slug || undefined, servings: Number(v.servings), prep_minutes: v.prep ? Number(v.prep) : undefined, cook_minutes: v.cook ? Number(v.cook) : undefined,
      steps: v.steps.split('\n').map((s) => s.trim()).filter(Boolean), food_safety_note: v.safety || undefined, reviewed: v.reviewed, status: v.status,
      ingredients: ings.filter((i) => i.label.trim()).map((i) => ({ label: i.label, quantity_text: i.quantity_text || undefined, product_slug: i.product_slug || undefined, optional: i.optional, alternative_slugs: lines(i.alternative_slugs) })) };
    if (editing) await put(`/admin/recipes/${editing}`, body); else await post('/admin/recipes', body);
    toast('Recipe saved'); setOpen(false); reload();
  });
  const setIng = (i: number, k: keyof Ing, val: any) => setIngs((s) => s.map((x, j) => (j === i ? { ...x, [k]: val } : x)));
  return (
    <Fetch path="/admin/recipes">{(rows: any[], reload) => (
      <>
        <Notice tone="warn">AI-generated recipe drafts must be reviewed by a person (check food safety and allergens) and marked “Reviewed” before the draft label is removed. Linked products come from the real catalogue; availability is never invented.</Notice>
        <div className="row end" style={{ marginTop: 0, marginBottom: 10 }}><Button onClick={() => { reset(); setEditing(null); setOpen(true); }}>New recipe</Button></div>
        <DataTable rows={rows} rowKey={(r) => r.id} onRowClick={edit}
          columns={[{ key: 't', header: 'Recipe', render: (r) => <strong>{r.title}</strong> }, { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'ai', header: 'Origin', render: (r) => (r.ai_generated ? <Badge tone="warn">AI draft</Badge> : 'Written by us') }, { key: 'r', header: 'Reviewed', render: (r) => (r.reviewed ? <Badge tone="ok">Reviewed</Badge> : <Badge tone="danger">Not reviewed</Badge>) }]} />
        <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit recipe' : 'New recipe'}>
          {tax.loading && <Loading />}
          {loadErr && <Notice tone="warn">{loadErr}</Notice>}
          {editing && <Notice tone="warn">Saving replaces all ingredients. Curated alternative products are not loaded here: re-enter them below or they will be removed.</Notice>}
          {save.error && <Notice tone="error">{save.error}</Notice>}
          <Field label="Title"><Input value={f.v.title} onChange={f.set('title')} /></Field>
          <Field label="Summary"><Input value={f.v.summary} onChange={f.set('summary')} /></Field>
          <div className="form-grid">
            <Field label="Region"><Select value={f.v.region_slug} onChange={f.set('region_slug')}><option value="">None</option>{(tax.data?.regions ?? []).map((r: any) => <option key={r.slug} value={r.slug}>{r.name}</option>)}</Select></Field>
            <Field label="Country"><Select value={f.v.country_slug} onChange={f.set('country_slug')}><option value="">None</option>{(tax.data?.countries ?? []).map((r: any) => <option key={r.slug} value={r.slug}>{r.name}</option>)}</Select></Field>
            <Field label="Servings"><Input inputMode="numeric" value={f.v.servings} onChange={f.set('servings')} /></Field>
            <Field label="Prep (min)"><Input inputMode="numeric" value={f.v.prep} onChange={f.set('prep')} /></Field>
            <Field label="Cook (min)"><Input inputMode="numeric" value={f.v.cook} onChange={f.set('cook')} /></Field>
          </div>
          <Field label="Steps (one per line)"><Textarea style={{ minHeight: 140 }} value={f.v.steps} onChange={f.set('steps')} /></Field>
          <Field label="Food safety note"><Input value={f.v.safety} onChange={f.set('safety')} /></Field>
          <h3>Ingredients</h3>
          {ings.map((i, n) => (
            <div key={n} className="panel" style={{ padding: 10 }}>
              <div className="form-grid"><Field label="Ingredient"><Input value={i.label} onChange={(e) => setIng(n, 'label', e.target.value)} /></Field><Field label="Quantity"><Input value={i.quantity_text} onChange={(e) => setIng(n, 'quantity_text', e.target.value)} /></Field>
                <Field label="Linked product slug" hint="Leave empty for pantry items"><Input value={i.product_slug} onChange={(e) => setIng(n, 'product_slug', e.target.value)} /></Field>
                <Field label="Curated alternatives (slugs)"><Input value={i.alternative_slugs} onChange={(e) => setIng(n, 'alternative_slugs', e.target.value)} /></Field></div>
              <div className="row between"><label className="check"><input type="checkbox" checked={i.optional} onChange={(e) => setIng(n, 'optional', e.target.checked)} />Optional</label><Button size="sm" variant="ghost" onClick={() => setIngs((s) => s.filter((_, j) => j !== n))}>Remove</Button></div>
            </div>))}
          <Button variant="secondary" size="sm" onClick={() => setIngs((s) => [...s, blankIng()])}>Add ingredient</Button>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <Field label="Status"><Select value={f.v.status} onChange={f.set('status')}><option value="draft">Draft (hidden)</option><option value="published">Published</option></Select></Field></div>
          <label className="check"><input type="checkbox" checked={f.v.reviewed} onChange={f.set('reviewed')} />A person has reviewed this recipe (food safety, allergens)</label>
          <div className="row end"><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button busy={save.busy} disabled={f.v.title.length < 2 || !f.v.steps.trim() || !ings.some((i) => i.label.trim())} onClick={() => save.run(reload)}>Save recipe</Button></div>
        </Modal>
      </>
    )}</Fetch>
  );
}
