import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, del, money, packLabel, put } from '../api';
import { useApi } from '../hooks';
import { useAuth } from '../auth';
import { usePlace } from '../place';
import { ProductArt, Stars } from '../art';
import { Badge, Button, ErrorBox, Loading, Notice } from '../ui';
import { AddToBasket, BasketBar, Price, Shelf, type Card } from '../cards';
import { IconShield, IconTruck } from '../icons';

type Offer = { store_slug: string; store_name: string; is_open: boolean; is_test_data: boolean; offer_id: string; price_cents: number; compare_at_cents: number | null; on_promotion: boolean; in_stock: boolean; available: number };
type P = {
  name: string; brand: string | null; category: string | null; category_slug: string | null; description: string | null; pack_size: string | null; pack_unit: string | null; sold_by: string; ingredients: string | null; allergens: string[] | null;
  storage_info: string | null; manufacturer: string | null; countries: { name: string; kind: string }[]; aliases: string[]; images: { url: string; alt: string }[]; offers: Offer[];
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
  const related = useApi<Card[]>(`/products/${slug}/related`);
  const { place, setOpen } = usePlace();
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { setSel(null); window.scrollTo({ top: 0 }); }, [slug]);
  useEffect(() => {
    const session = (() => { try { return sessionStorage.getItem('ez_sid') ?? (sessionStorage.setItem('ez_sid', crypto.randomUUID()), sessionStorage.getItem('ez_sid')); } catch { return undefined; } })();
    const sp = new URLSearchParams(location.search);
    api('/events', { method: 'POST', json: { type: 'product_view', product_slug: slug, session_id: session ?? undefined, utm_source: sp.get('utm_source') ?? undefined, utm_campaign: sp.get('utm_campaign') ?? undefined } }).catch(() => {});
  }, [slug]);
  useEffect(() => { if (p) document.title = `${p.name} – EAZyfoods`; return () => { document.title = 'EAZyfoods – African groceries from local stores'; }; }, [p]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!p) return null;

  const pack = packLabel(p);
  const best = [...p.offers].sort((a, b) => Number(b.in_stock) - Number(a.in_stock) || a.price_cents - b.price_cents)[0];
  const cur = p.offers.find((o) => o.offer_id === sel) ?? best;
  const culinary = p.countries.filter((c) => c.kind === 'culinary').map((c) => c.name);
  const made = p.countries.filter((c) => c.kind === 'manufacturing').map((c) => c.name);
  const mk = (o: Offer) => ({ offer_id: o.offer_id, slug: slug!, name: p.name, unit_price_cents: o.price_cents, store_name: o.store_name, store_slug: o.store_slug, pack, available: o.available, in_stock: o.in_stock });
  const off = cur?.compare_at_cents && cur.compare_at_cents > cur.price_cents ? Math.round((1 - cur.price_cents / cur.compare_at_cents) * 100) : 0;
  return (
    <article>
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">Home</Link><span>›</span>{p.category && <><Link to={`/search?category=${p.category_slug}`}>{p.category}</Link><span>›</span></>}{p.name}</nav>
      <div className="pdp">
        <div className="pdp-gallery">
          <div className="pdp-main">{p.images[0] ? <img src={p.images[0].url} alt={p.images[0].alt} /> : <ProductArt name={p.name} brand={p.brand} category={p.category} size={pack} />}</div>
          {!p.images[0] && <p className="pdp-note">Illustration of the pack. Stores add real photos.</p>}
        </div>

        <div>
          {p.brand && <Link to={`/search?q=${encodeURIComponent(p.brand)}`} className="brandlink">{p.brand}</Link>}
          <h1>{p.name}</h1>
          <div className="row wrap"><Stars value={reviews.data?.average} count={reviews.data?.count} />{reviews.data && reviews.data.average == null && reviews.data.count > 0 && <span className="muted small">Ratings show after 3 verified reviews</span>}<Heart slug={slug!} /></div>
          <hr style={{ margin: '10px 0' }} />
          <p className="muted small" style={{ margin: '2px 0 10px' }}>{pack}{p.sold_by === 'weight' ? ' · sold by weight; the store weighs your item and any difference is refunded' : ''}. Prices exclude GST where it applies.</p>
          {p.description && <p>{p.description}</p>}
          {p.aliases.length > 0 && <p className="small">Also known as: <strong>{p.aliases.join(', ')}</strong></p>}
          <dl className="facts">
            {culinary.length > 0 && <><dt>Culinary tradition</dt><dd>{culinary.join(', ')}</dd></>}
            {made.length > 0 && <><dt>Made in</dt><dd>{made.join(', ')}</dd></>}
            {p.manufacturer && <><dt>Manufacturer</dt><dd>{p.manufacturer}</dd></>}
            {p.ingredients && <><dt>Ingredients</dt><dd>{p.ingredients}</dd></>}
            <dt>Allergens</dt><dd>{p.allergens === null ? 'Not supplied. Check the package if you have allergies.' : p.allergens.length ? `Contains: ${p.allergens.join(', ')}` : 'None declared'}</dd>
            {p.storage_info && <><dt>Storage</dt><dd>{p.storage_info}</dd></>}
          </dl>
        </div>

        <aside className="buybox" aria-label="Buy">
          {cur ? <>
            <div className="row between"><Price cents={cur.price_cents} className={`big ${cur.on_promotion ? 'sale' : ''}`} />{off > 0 && <Badge tone="danger">−{off}%</Badge>}</div>
            <div className={`stock ${cur.in_stock ? '' : 'out'}`}>{cur.in_stock ? (cur.available <= 5 ? `Only ${cur.available} left` : 'In stock') : 'Out of stock'}</div>
            <label className="small"><span className="muted">Sold by</span>
              <select className="input" value={cur.offer_id} onChange={(e) => setSel(e.target.value)}>
                {p.offers.map((o) => <option key={o.offer_id} value={o.offer_id}>{o.store_name} — {money(o.price_cents)}{o.in_stock ? '' : ' (out of stock)'}</option>)}
              </select></label>
            <div className="ship"><IconTruck width={18} height={18} style={{ verticalAlign: -4 }} /> {place?.serviceable ? <>Delivers to <b>{place.fsa}</b> in about {place.eta_minutes} min · {money(place.fee_cents)} per store</> : place ? <>Not delivering to {place.fsa} yet</> : <button className="link" onClick={() => setOpen(true)}>Enter postal code to see delivery</button>}</div>
            {!cur.is_open && <Notice tone="warn">{cur.store_name} is closed now. You can add it, but you can only check out while it is open.</Notice>}
            <AddToBasket cta size="lg" offer={mk(cur)} />
            <div className="small muted"><IconShield width={16} height={16} style={{ verticalAlign: -3 }} /> Pay securely. We never see your card number. <Link to="/pages/refund-policy">Refund policy</Link></div>
            {cur.is_test_data && <Badge tone="demo">Demo store</Badge>}
          </> : <Notice tone="warn">No store is currently selling this.</Notice>}
        </aside>
      </div>

      {p.offers.length > 1 && (
        <section className="block"><h2>Compare {p.offers.length} stores</h2>
          <table className="compare"><thead><tr><th>Store</th><th>Price</th><th>Availability</th><th /></tr></thead>
            <tbody>{[...p.offers].sort((a, b) => a.price_cents - b.price_cents).map((o) => (
              <tr key={o.offer_id} className={o.offer_id === best?.offer_id ? 'best' : ''}>
                <td data-l="Store"><Link to={`/s/${o.store_slug}`}><strong>{o.store_name}</strong></Link> {o.is_test_data && <Badge tone="demo">Demo</Badge>}<div className="small muted">{o.is_open ? 'Open now' : 'Closed now'}</div></td>
                <td data-l="Price"><span className={o.on_promotion ? 'pr sale' : 'pr'} style={{ fontWeight: 800 }}>{money(o.price_cents)}</span>{o.compare_at_cents && <s className="was"> {money(o.compare_at_cents)}</s>}{o.offer_id === best?.offer_id && <> <Badge tone="ok">Lowest</Badge></>}</td>
                <td data-l="Availability">{o.in_stock ? (o.available <= 5 ? `Only ${o.available} left` : 'In stock') : 'Out of stock'}</td>
                <td><AddToBasket size="sm" offer={mk(o)} /></td></tr>))}</tbody></table>
        </section>
      )}

      {reviews.data && reviews.data.average !== null && (
        <section className="block"><h2>Customer reviews</h2><p><Stars value={reviews.data.average} /> <strong>{reviews.data.average}</strong> out of 5 · {reviews.data.count} verified purchases</p>
          {reviews.data.reviews.filter((r) => r.body).map((r, i) => <div key={i} className="panel"><Stars value={r.rating} /> <span className="muted small">{r.first_name} · verified purchase</span><p style={{ margin: '4px 0 0' }}>{r.body}</p></div>)}</section>
      )}
      <Shelf title="You might also like" items={related.data ?? []} />
      <BasketBar />
    </article>
  );
}
