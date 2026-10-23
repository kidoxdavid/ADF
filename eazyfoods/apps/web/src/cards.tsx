import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { money, packLabel, post, type StoreCard } from './api';
import { ProductArt, StoreBanner, StoreMark, Stars } from './art';
import { useCart } from './cart';
import { IconChevron, IconChevronL, IconMinus, IconPlus } from './icons';
import { Badge, Button, Stepper } from './ui';

export type Card = {
  slug: string; name: string; brand: string | null; pack_size: string | null; pack_unit: string | null; category?: string | null; category_slug?: string | null; image_url?: string | null;
  min_price: number; was_price?: number | null; in_stock: boolean; on_sale?: boolean; store_count?: number; matched_alias?: string | null;
  offer_id?: string | null; store_name?: string | null; store_slug?: string | null; available?: number | null; rating_avg?: number | null; rating_count?: number; sponsored_campaign_id?: string | null;
};

/** $12.99 shown retail-style: small dollar sign and cents, large dollars. */
export function Price({ cents, className = '' }: { cents: number; className?: string }) {
  const d = Math.floor(cents / 100), c = String(cents % 100).padStart(2, '0');
  return <span className={`pr ${className}`}><span className="sr-only">{money(cents)}</span><sup aria-hidden="true">$</sup><span aria-hidden="true">{d}</span><sup aria-hidden="true">{c}</sup></span>;
}

const seen = new Set<string>();
export function useAdImpression(id: string | null | undefined) {
  useEffect(() => { if (!id || seen.has(id)) return; seen.add(id); post(`/ads/${id}/event`, { type: 'impression' }).catch(() => {}); }, [id]);
}

export function QuickAdd({ p }: { p: Card }) {
  const { qtyOf, setQty } = useCart();
  if (!p.offer_id || !p.in_stock) return <Link to={`/p/${p.slug}`} className="btn secondary sm wide">{p.in_stock ? 'View' : 'Out of stock'}</Link>;
  const offer = { offer_id: p.offer_id, slug: p.slug, name: p.name, unit_price_cents: p.min_price, store_name: p.store_name ?? '', store_slug: p.store_slug ?? '', pack: packLabel(p) };
  const q = qtyOf(p.offer_id);
  if (q === 0) return <button className="addbtn" onClick={() => setQty(offer, 1)} aria-label={`Add ${p.name} from ${p.store_name} to basket`}><IconPlus width={18} height={18} /> Add</button>;
  return (
    <div className="addstep" role="group" aria-label={`Quantity of ${p.name}`}>
      <button aria-label={`Remove one ${p.name}`} onClick={() => setQty(offer, q - 1)}><IconMinus width={18} height={18} /></button>
      <span aria-live="polite">{q}</span>
      <button aria-label={`Add one ${p.name}`} disabled={q >= Math.min(99, p.available ?? 99)} onClick={() => setQty(offer, q + 1)}><IconPlus width={18} height={18} /></button>
    </div>
  );
}

export function ProductCard({ p }: { p: Card }) {
  useAdImpression(p.sponsored_campaign_id);
  const click = () => { if (p.sponsored_campaign_id) post(`/ads/${p.sponsored_campaign_id}/event`, { type: 'click' }).catch(() => {}); };
  const was = p.was_price && p.was_price > p.min_price ? p.was_price : null;
  const off = was ? Math.round((1 - p.min_price / was) * 100) : 0;
  return (
    <article className="pcard">
      <Link to={`/p/${p.slug}`} className="pimg" onClick={click} tabIndex={-1} aria-hidden="true">
        {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <ProductArt name={p.name} brand={p.brand} category={p.category_slug ?? p.category} size={packLabel(p)} />}
        {p.on_sale && off > 0 && <span className="ribbon">{off}% off</span>}
        {p.on_sale && off <= 0 && <span className="ribbon">Deal</span>}
        {!p.in_stock && <span className="ribbon grey">Out of stock</span>}
      </Link>
      <div className="pbody">
        {p.sponsored_campaign_id && <span className="sponsor">Sponsored</span>}
        <div className="prow">
          <Price cents={p.min_price} className={p.on_sale ? 'sale' : ''} />
          {was && <s className="was">{money(was)}</s>}
        </div>
        {(p.store_count ?? 1) > 1 && <span className="from">lowest of {p.store_count} stores</span>}
        <Link to={`/p/${p.slug}`} className="pname" onClick={click}>{p.name}</Link>
        <span className="pmeta">{[p.brand, packLabel(p)].filter(Boolean).join(' · ')}</span>
        {p.matched_alias && <Badge>Also known as “{p.matched_alias}”</Badge>}
        <Stars value={p.rating_avg} count={p.rating_count} />
        {p.store_name && <span className="psold">at {p.store_name}</span>}
        <div className="pact"><QuickAdd p={p} /></div>
      </div>
    </article>
  );
}

export function ProductGrid({ products }: { products: Card[] }) {
  return <ul className="pgrid" role="list">{products.map((p) => <li key={p.slug}><ProductCard p={p} /></li>)}</ul>;
}

/** Horizontally scrolling shelf with arrows on desktop and swipe on touch. */
export function Shelf({ title, subtitle, to, items, children }: { title: string; subtitle?: string; to?: string; items?: Card[]; children?: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ l: true, r: false });
  const upd = () => { const e = ref.current; if (e) setEdge({ l: e.scrollLeft < 4, r: e.scrollLeft + e.clientWidth >= e.scrollWidth - 4 }); };
  useEffect(() => { upd(); }, [items]);
  const go = (dir: number) => ref.current?.scrollBy({ left: dir * (ref.current.clientWidth * 0.85), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  if (items && !items.length) return null;
  return (
    <section className="shelf" aria-label={title}>
      <div className="shelf-head"><div><h2>{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}</div>{to && <Link to={to} className="seeall">See all <IconChevron width={16} height={16} /></Link>}</div>
      <div className="shelf-wrap">
        <button className="shelf-btn l" aria-label={`Scroll ${title} left`} disabled={edge.l} onClick={() => go(-1)}><IconChevronL /></button>
        <ul className="shelf-row" role="list" ref={ref} onScroll={upd}>{children ?? items!.map((p) => <li key={p.slug}><ProductCard p={p} /></li>)}</ul>
        <button className="shelf-btn r" aria-label={`Scroll ${title} right`} disabled={edge.r} onClick={() => go(1)}><IconChevron /></button>
      </div>
    </section>
  );
}

export function StoreTile({ s }: { s: StoreCard }) {
  return (
    <Link to={`/s/${s.slug}`} className="stile">
      <div className="stile-cover"><StoreBanner name={s.name} /></div>
      <div className="stile-body">
        <StoreMark name={s.name} size={44} />
        <div><h3>{s.name}</h3><span className="muted small">{s.city}{s.min_order_cents ? ` · $${(s.min_order_cents / 100).toFixed(0)} minimum` : ''}</span></div>
      </div>
      <div className="row wrap" style={{ padding: '0 14px 14px' }}>
        <Badge tone={s.is_open ? 'ok' : 'warn'}>{s.is_open ? 'Open now' : 'Closed now'}</Badge>
        {s.regions.slice(0, 2).map((r) => <Badge key={r.slug}>{r.name}</Badge>)}
        {s.is_test_data && <Badge tone="demo">Demo store</Badge>}
      </div>
    </Link>
  );
}
export function StoreList({ stores }: { stores: StoreCard[] }) {
  return <ul className="sgrid" role="list">{stores.map((s) => <li key={s.slug}><StoreTile s={s} /></li>)}</ul>;
}

export function BasketBar() {
  const { count, cart, guest } = useCart();
  if (!count) return null;
  const subtotal = cart ? cart.subtotal_cents : guest.reduce((a, g) => a + g.unit_price_cents * g.quantity, 0);
  return (
    <div className="sticky-bar" role="region" aria-label="Basket summary">
      <span><strong>{count}</strong> item{count === 1 ? '' : 's'} · <strong>{money(subtotal)}</strong></span>
      <Link to="/cart" className="btn cta">View basket</Link>
    </div>
  );
}

export type OfferInfo = { offer_id: string; slug: string; name: string; unit_price_cents: number; store_name: string; store_slug: string; pack: string; available: number; in_stock: boolean };
export function AddToBasket({ offer, size, cta }: { offer: OfferInfo; size?: 'sm' | 'lg'; cta?: boolean }) {
  const { qtyOf, setQty } = useCart();
  const q = qtyOf(offer.offer_id);
  if (!offer.in_stock) return <Button variant="secondary" size={size} disabled>Out of stock</Button>;
  if (q === 0) return <button className={`btn ${cta ? 'cta' : 'primary'} ${size ?? ''} wide`} onClick={() => setQty(offer, 1)} aria-label={`Add to basket: ${offer.name} from ${offer.store_name}`}>Add to basket</button>;
  return <Stepper value={q} max={Math.min(99, offer.available)} label={`${offer.name} from ${offer.store_name}`} onChange={(n) => setQty(offer, Math.max(0, n))} />;
}
export function useOnVisible(cb: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = ref.current; if (!el) return; const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { cb(); io.disconnect(); } }); io.observe(el); return () => io.disconnect(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}
