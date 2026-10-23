import { useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { money, packLabel, type StoreCard } from '../api';
import { useApi } from '../hooks';
import { Badge, ErrorBox, Loading, Notice, Thumb } from '../ui';
import { AddToBasket, BasketBar, StoreList } from '../cards';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type S = {
  name: string; description: string; address_line: string | null; city: string; province: string; postal_code: string | null; phone: string | null;
  is_open: boolean; min_order_cents: number | null; is_test_data: boolean; logo_url: string | null; cover_url: string | null; policies: string | null; offers_delivery: boolean; offers_pickup: boolean; ordering_paused: boolean;
  hours: { dow: number; opens: string; closes: string }[]; regions: { slug: string; name: string }[];
  products: { slug: string; name: string; brand: string | null; pack_size: string | null; pack_unit: string | null; offer_id: string; price_cents: number; compare_at_cents: number | null; on_promotion: boolean; image_url: string | null; in_stock: boolean; available: number }[];
};
type Reviews = { count: number; average: number | null };

export function StoresPage() {
  const { data, loading, error, reload } = useApi<StoreCard[]>('/stores');
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  return <><h1>Stores</h1>{data && <StoreList stores={data} />}</>;
}

export function StorePage() {
  const { slug } = useParams();
  const { data: s, loading, error, reload } = useApi<S>(`/stores/${slug}`);
  const rev = useApi<Reviews>(`/stores/${slug}/reviews`);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!s) return null;
  return (
    <>
      {s.cover_url && <div className="store-hero"><img src={s.cover_url} alt="" /></div>}
      <div className="row top" style={{ marginTop: 12 }}>
        {s.logo_url && <img src={s.logo_url} alt="" width={56} height={56} style={{ borderRadius: 10, objectFit: 'cover' }} />}
        <div><h1 style={{ marginBottom: 4 }}>{s.name}</h1>
          <div className="row wrap">
            <Badge tone={s.is_open ? 'ok' : 'warn'}>{s.is_open ? 'Open now' : 'Closed now'}</Badge>
            {s.regions.map((r) => <Link key={r.slug} to={`/search?region=${r.slug}&store=${slug}`}><Badge>{r.name}</Badge></Link>)}
            {s.offers_pickup && <Badge>Pickup available</Badge>}
            {rev.data?.average != null && <Badge tone="info">★ {rev.data.average} ({rev.data.count})</Badge>}
          </div>
        </div>
      </div>
      {s.is_test_data && <Notice tone="warn">Demo store with invented data for development. It is not a real business.</Notice>}
      {s.ordering_paused && <Notice tone="warn">This store has paused online orders for now.</Notice>}
      {!s.is_open && !s.ordering_paused && <Notice>This store is closed right now. You can fill your basket, but you can only check out while it is open.</Notice>}
      <p>{s.description}</p>
      <p className="small muted">{[s.address_line, s.city, s.province, s.postal_code].filter(Boolean).join(', ')}{s.phone ? ` · ${s.phone}` : ''}{s.min_order_cents ? ` · Minimum order ${money(s.min_order_cents)}` : ''}</p>
      <details><summary style={{ cursor: 'pointer', minHeight: 32 }}>Opening hours{s.policies ? ' and store policies' : ''}</summary>
        <ul role="list" style={{ paddingLeft: 18 }}>{s.hours.map((h, i) => <li key={i}>{DAYS[h.dow]} {h.opens.slice(0, 5)}–{h.closes.slice(0, 5)}</li>)}</ul>
        {s.policies && <p>{s.policies}</p>}
      </details>
      <h2>Products ({s.products.length})</h2>
      <ul className="cards" role="list">
        {s.products.map((p) => (
          <li key={p.slug}>
            <div className="card">
              <Link to={`/p/${p.slug}`} tabIndex={-1} aria-hidden="true" style={{ textDecoration: 'none', color: 'inherit' }}><Thumb name={p.name} url={p.image_url} /></Link>
              <div className="card-body">
                {p.brand && <span className="eyebrow">{p.brand}</span>}
                <Link to={`/p/${p.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}><h3>{p.name}</h3></Link>
                <span className="muted small">{packLabel(p)}</span>
                <span className="price"><span className={p.on_promotion ? 'sale' : ''}>{money(p.price_cents)}</span>{p.compare_at_cents && <s>{money(p.compare_at_cents)}</s>}</span>
                <div style={{ marginTop: 'auto', paddingTop: 6 }}>
                  <AddToBasket size="sm" offer={{ offer_id: p.offer_id, slug: p.slug, name: p.name, unit_price_cents: p.price_cents, store_name: s.name, store_slug: slug!, pack: packLabel(p), available: p.available, in_stock: p.in_stock }} />
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <BasketBar />
    </>
  );
}
