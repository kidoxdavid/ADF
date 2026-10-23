import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, del, money, packLabel, post, put } from '../api';
import { useApi } from '../hooks';
import { useAuth } from '../auth';
import { Badge, Button, ErrorBox, Loading, Notice, Thumb } from '../ui';
import { AddToBasket, BasketBar } from '../cards';

type P = {
  name: string; brand: string | null; category: string | null; description: string | null; pack_size: string | null; pack_unit: string | null; sold_by: string;
  ingredients: string | null; allergens: string[] | null; storage_info: string | null; manufacturer: string | null; dietary: Record<string, boolean>;
  countries: { name: string; kind: string }[]; aliases: string[]; images: { url: string; alt: string }[];
  offers: { store_slug: string; store_name: string; is_open: boolean; is_test_data: boolean; offer_id: string; price_cents: number; compare_at_cents: number | null; on_promotion: boolean; in_stock: boolean; available: number }[];
};
type Reviews = { count: number; average: number | null; reviews: { rating: number; body: string | null; created_at: string; first_name: string }[] };

function Heart({ slug }: { slug: string }) {
  const { me } = useAuth();
  const fav = useApi<{ favourite: boolean }>(me ? `/favourites/${slug}` : null);
  if (!me) return <Link to={`/signin?next=/p/${slug}`} className="btn ghost sm">♡ Save</Link>;
  const on = fav.data?.favourite;
  return <Button variant="ghost" size="sm" aria-pressed={!!on} onClick={async () => { await (on ? del(`/favourites/${slug}`) : put(`/favourites/${slug}`)); fav.reload(); }}>{on ? '♥ Saved' : '♡ Save'}</Button>;
}

export function ProductPage() {
  const { slug } = useParams();
  const { data: p, loading, error, reload } = useApi<P>(`/products/${slug}`);
  const reviews = useApi<Reviews>(`/products/${slug}/reviews`);
  useEffect(() => {
    const session = (() => { try { return sessionStorage.getItem('ez_sid') ?? (sessionStorage.setItem('ez_sid', crypto.randomUUID()), sessionStorage.getItem('ez_sid')); } catch { return undefined; } })();
    const sp = new URLSearchParams(location.search);
    api('/events', { method: 'POST', json: { type: 'product_view', product_slug: slug, session_id: session ?? undefined, utm_source: sp.get('utm_source') ?? undefined, utm_campaign: sp.get('utm_campaign') ?? undefined } }).catch(() => {});
  }, [slug]);
  useEffect(() => { if (p) document.title = `${p.name} – EAZyfoods`; return () => { document.title = 'EAZyfoods – African groceries from local stores'; }; }, [p]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!p) return null;
  const culinary = p.countries.filter((c) => c.kind === 'culinary').map((c) => c.name);
  const made = p.countries.filter((c) => c.kind === 'manufacturing').map((c) => c.name);
  const pack = packLabel(p);
  return (
    <article className="product-page">
      <div><Thumb name={p.name} url={p.images[0]?.url} /></div>
      <div>
        <div className="row between">{p.brand ? <span className="eyebrow">{p.brand}</span> : <span />}<Heart slug={slug!} /></div>
        <h1>{p.name}</h1>
        <p className="muted">{pack}{p.sold_by === 'weight' ? ' · sold by weight: the store weighs your item and any difference is refunded' : ''}</p>
        {p.description && <p>{p.description}</p>}
        {p.aliases.length > 0 && <p className="small">Also known as: {p.aliases.join(', ')}</p>}
        <dl className="facts">
          {culinary.length > 0 && <><dt>Culinary tradition</dt><dd>{culinary.join(', ')}</dd></>}
          {made.length > 0 && <><dt>Made in</dt><dd>{made.join(', ')}</dd></>}
          {p.manufacturer && <><dt>Manufacturer</dt><dd>{p.manufacturer}</dd></>}
          {p.ingredients && <><dt>Ingredients</dt><dd>{p.ingredients}</dd></>}
          <dt>Allergens</dt>
          <dd>{p.allergens === null ? 'Not supplied. Check the package if you have allergies.' : p.allergens.length ? `Contains: ${p.allergens.join(', ')}` : 'None declared'}</dd>
          {p.storage_info && <><dt>Storage</dt><dd>{p.storage_info}</dd></>}
        </dl>
        <h2>Available from</h2>
        {p.offers.length === 0 && <Notice tone="warn">No store is currently selling this.</Notice>}
        <div>
          {p.offers.map((o) => (
            <div key={o.store_slug} className="offer-row">
              <div>
                <Link to={`/s/${o.store_slug}`}><strong>{o.store_name}</strong></Link> {o.is_test_data && <Badge tone="demo">Demo store</Badge>}
                <div className="small muted">{o.is_open ? 'Open now' : 'Closed now'} · {o.in_stock ? (o.available <= 5 ? `Only ${o.available} left` : 'In stock') : 'Out of stock'}</div>
              </div>
              <div className="row">
                <span className="price"><span className={o.on_promotion ? 'sale' : ''}>{money(o.price_cents)}</span>{o.compare_at_cents && <s>{money(o.compare_at_cents)}</s>}</span>
                <AddToBasket offer={{ offer_id: o.offer_id, slug: slug!, name: p.name, unit_price_cents: o.price_cents, store_name: o.store_name, store_slug: o.store_slug, pack, available: o.available, in_stock: o.in_stock }} />
              </div>
            </div>
          ))}
        </div>
        {reviews.data && reviews.data.average !== null && (
          <section><h2>Reviews</h2><p><strong>{reviews.data.average}</strong> out of 5 · {reviews.data.count} verified purchases</p>
            {reviews.data.reviews.filter((r) => r.body).map((r, i) => <div key={i} className="panel"><strong>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</strong> <span className="muted small">{r.first_name} · verified purchase</span><p style={{ margin: '4px 0 0' }}>{r.body}</p></div>)}</section>
        )}
        {reviews.data && reviews.data.average === null && reviews.data.count > 0 && <p className="muted small">Ratings appear once at least 3 customers who bought this have reviewed it.</p>}
        <BasketBar />
      </div>
    </article>
  );
}
