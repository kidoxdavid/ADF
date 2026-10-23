import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { money, post } from '../api';
import { useAuth } from '../auth';
import { useCart } from '../cart';
import { useAction, useApi } from '../hooks';
import { Badge, Button, Empty, ErrorBox, Loading, Notice } from '../ui';

export function RecipesPage() {
  const [sp, setSp] = useSearchParams();
  const regions = useApi<{ slug: string; name: string }[]>('/regions');
  const { data, loading, error, reload } = useApi<{ slug: string; title: string; summary: string; servings: number; prep_minutes: number | null; cook_minutes: number | null; region: string | null; country: string | null }[]>(`/recipes${sp.get('region') ? `?region=${sp.get('region')}` : ''}`);
  return (
    <>
      <h1>Recipes</h1>
      <p className="muted">Cook with ingredients you can buy here. We only add what is genuinely in stock.</p>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <Button size="sm" variant={sp.get('region') ? 'secondary' : 'primary'} onClick={() => setSp({})}>All</Button>
        {regions.data?.map((r) => <Button key={r.slug} size="sm" variant={sp.get('region') === r.slug ? 'primary' : 'secondary'} onClick={() => setSp({ region: r.slug })}>{r.name}</Button>)}
      </div>
      {loading && <Loading />}{error && <ErrorBox message={error} retry={reload} />}
      {data && !data.length && <Empty title="No recipes here yet" />}
      <ul className="cards stores" role="list">{data?.map((r) => <li key={r.slug}><Link to={`/recipes/${r.slug}`} className="card"><div className="card-body" style={{ padding: 14 }}><h3>{r.title}</h3><span className="muted small">{r.summary}</span><span className="small">{[r.country ?? r.region, `${r.servings} servings`, r.cook_minutes ? `${(r.prep_minutes ?? 0) + r.cook_minutes} min` : null].filter(Boolean).join(' · ')}</span></div></Link></li>)}</ul>
    </>
  );
}

type Recipe = { title: string; summary: string; region: string | null; country: string | null; servings: number; prep_minutes: number | null; cook_minutes: number | null; steps: string[]; food_safety_note: string | null; reviewed: boolean; ai_generated: boolean;
  ingredients: { label: string; quantity_text: string | null; optional: boolean; product_slug: string | null; product_name: string | null; available_from: { price_cents: number; store_name: string } | null; alternatives: { slug: string; name: string; note: string | null }[] }[] };

export function RecipePage() {
  const { slug } = useParams(); const { me } = useAuth(); const { refresh } = useCart();
  const { data: r, loading, error, reload } = useApi<Recipe>(`/recipes/${slug}`);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!r) return null;
  const buyable = r.ingredients.filter((i) => i.product_slug);
  return (
    <article className="prose">
      <h1>{r.title}</h1>
      <p className="muted">{[r.country ?? r.region, `Serves ${r.servings}`, r.prep_minutes != null ? `Prep ${r.prep_minutes} min` : null, r.cook_minutes != null ? `Cook ${r.cook_minutes} min` : null].filter(Boolean).join(' · ')}</p>
      <p>{r.summary}</p>
      {!r.reviewed && <Notice tone="warn"><strong>Draft recipe{r.ai_generated ? ', written with AI assistance' : ''} and not yet reviewed by a person.</strong> Check ingredient labels for allergens. Availability and prices below come from real store listings.</Notice>}
      <h2>Ingredients</h2>
      <ul>
        {r.ingredients.map((i, k) => (
          <li key={k}>{i.quantity_text ? `${i.quantity_text} ` : ''}{i.label}{i.optional && <span className="muted"> (optional)</span>}
            {i.product_slug && (i.available_from ? <span> · <Link to={`/p/${i.product_slug}`}>buy: {money(i.available_from.price_cents)} at {i.available_from.store_name}</Link></span> : <span> · <Badge tone="warn">not in stock right now</Badge>{i.alternatives.map((a) => <span key={a.slug}> Try <Link to={`/p/${a.slug}`}>{a.name}</Link>{a.note ? ` (${a.note})` : ''}.</span>)}</span>)}
          </li>
        ))}
      </ul>
      {buyable.length > 0 && (
        me ? <AddAllInner slug={slug!} onDone={refresh} /> : <p><Link to={`/signin?next=/recipes/${slug}`} className="btn primary">Sign in to add ingredients to your basket</Link></p>
      )}
      <h2>Method</h2>
      <ol className="recipe-steps">{r.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      {r.food_safety_note && <Notice><strong>Food safety:</strong> {r.food_safety_note}</Notice>}
    </article>
  );
}

function AddAllInner({ slug, onDone }: { slug: string; onDone: () => void }) {
  const [out, setOut] = useState<{ added: string[]; missing: string[] } | null>(null);
  const act = useAction(async () => { const r = await post<{ added: string[]; missing: string[] }>(`/recipes/${slug}/to-cart`, {}); setOut(r); onDone(); });
  return (
    <div className="panel">
      <Button onClick={() => act.run()} busy={act.busy}>Add available ingredients to my basket</Button>
      <p className="small muted">One pack of each ingredient that is in stock, from the cheapest store. Quantities are for you to adjust in the basket.</p>
      {act.error && <ErrorBox message={act.error} />}
      {out && <Notice tone="ok">Added: {out.added.join(', ') || 'nothing'}. {out.missing.length ? `Not available right now: ${out.missing.join(', ')}.` : ''} <Link to="/cart">View basket</Link></Notice>}
    </div>
  );
}
