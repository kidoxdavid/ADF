import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { money, packLabel, post, type ProductCard, type StoreCard } from './api';
import { Badge, Thumb } from './ui';

const seen = new Set<string>();
/** Count one impression per sponsored placement per page view. Measured, never estimated. */
export function useAdImpression(id: string | null | undefined) {
  useEffect(() => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    post(`/ads/${id}/event`, { type: 'impression' }).catch(() => {});
  }, [id]);
}

export function ProductGrid({ products }: { products: ProductCard[] }) {
  return (
    <ul className="cards" role="list">
      {products.map((p) => <li key={p.slug}><ProductCardView p={p} /></li>)}
    </ul>
  );
}

function ProductCardView({ p }: { p: ProductCard }) {
  useAdImpression(p.sponsored_campaign_id);
  const click = () => { if (p.sponsored_campaign_id) post(`/ads/${p.sponsored_campaign_id}/event`, { type: 'click' }).catch(() => {}); };
  return (
    <Link to={`/p/${p.slug}`} className="card" onClick={click}>
      <Thumb name={p.name} url={p.image_url} />
      <div className="card-body">
        {p.sponsored_campaign_id && <span className="sponsor">Sponsored</span>}
        {p.brand && <span className="eyebrow">{p.brand}</span>}
        <h3>{p.name}</h3>
        <span className="muted small">{packLabel(p)}</span>
        {p.matched_alias && <Badge>Also known as “{p.matched_alias}”</Badge>}
        <div className="row between" style={{ marginTop: 'auto' }}>
          <span className="price">{(p.store_count ?? 0) > 1 && <span className="muted small" style={{ fontWeight: 500 }}>from </span>}{money(p.min_price)}</span>
          {!p.in_stock && <Badge tone="danger">Out of stock</Badge>}
        </div>
        {p.store_count ? <span className="muted small">{p.store_count} store{p.store_count > 1 ? 's' : ''}</span> : null}
      </div>
    </Link>
  );
}

export function StoreList({ stores }: { stores: StoreCard[] }) {
  return (
    <ul className="cards stores" role="list">
      {stores.map((s) => (
        <li key={s.slug}>
          <Link to={`/s/${s.slug}`} className="card">
            <div className="card-body" style={{ padding: 14 }}>
              <h3>{s.name}</h3>
              <span className="muted small">{s.city}{s.min_order_cents ? ` · min. order ${money(s.min_order_cents)}` : ''}</span>
              <div className="row wrap" style={{ marginTop: 6 }}>
                <Badge tone={s.is_open ? 'ok' : 'warn'}>{s.is_open ? 'Open now' : 'Closed now'}</Badge>
                {s.regions.map((r) => <Badge key={r.slug}>{r.name}</Badge>)}
                {s.is_test_data && <Badge tone="demo">Demo store</Badge>}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Fires `onVisible` once when the element scrolls into view. */
export function useOnVisible(cb: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { cb(); io.disconnect(); } });
    io.observe(el); return () => io.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

import { useCart } from './cart';
import { Button, Stepper } from './ui';
import { Link as RLink } from 'react-router-dom';

export type OfferInfo = { offer_id: string; slug: string; name: string; unit_price_cents: number; store_name: string; store_slug: string; pack: string; available: number; in_stock: boolean };

/** Add button that turns into a stepper once the item is in the basket. Quantity is capped at what the store has. */
export function AddToBasket({ offer, size }: { offer: OfferInfo; size?: 'sm' | 'lg' }) {
  const { qtyOf, setQty } = useCart();
  const q = qtyOf(offer.offer_id);
  if (!offer.in_stock) return <Button variant="secondary" size={size} disabled>Out of stock</Button>;
  if (q === 0) return <Button size={size} onClick={() => setQty(offer, 1)} aria-label={`Add ${offer.name} from ${offer.store_name} to basket`}>Add</Button>;
  return <Stepper value={q} max={Math.min(99, offer.available)} label={`${offer.name} from ${offer.store_name}`} onChange={(n) => setQty(offer, Math.max(0, n))} />;
}

export function BasketBar() {
  const { count, cart, guest } = useCart();
  if (!count) return null;
  const subtotal = cart ? cart.subtotal_cents : guest.reduce((a, g) => a + g.unit_price_cents * g.quantity, 0);
  return (
    <div className="sticky-bar" role="region" aria-label="Basket summary">
      <span><strong>{count}</strong> item{count === 1 ? '' : 's'} · <strong>{money(subtotal)}</strong></span>
      <RLink to="/cart" className="btn primary">View basket</RLink>
    </div>
  );
}
