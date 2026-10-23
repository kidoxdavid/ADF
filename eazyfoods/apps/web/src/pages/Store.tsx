import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { money, type StoreCard } from '../api';
import { useApi } from '../hooks';
import { StoreBanner, StoreMark } from '../art';
import { Badge, ErrorBox, Loading, Notice } from '../ui';
import { BasketBar, ProductGrid, StoreList, type Card } from '../cards';
import { IconPin } from '../icons';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type SP = Card & { offer_id: string; price_cents: number; compare_at_cents: number | null; on_promotion: boolean; available: number; category: string | null; category_slug: string | null };
type S = {
  name: string; description: string; address_line: string | null; city: string; province: string; postal_code: string | null; phone: string | null; is_open: boolean; min_order_cents: number | null; is_test_data: boolean;
  logo_url: string | null; cover_url: string | null; policies: string | null; offers_delivery: boolean; offers_pickup: boolean; ordering_paused: boolean;
  hours: { dow: number; opens: string; closes: string }[]; regions: { slug: string; name: string }[]; products: SP[];
};
type Reviews = { count: number; average: number | null };

export function StoresPage() {
  const { data, loading, error, reload } = useApi<StoreCard[]>('/stores');
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  return <><h1>Stores</h1><p className="muted">Independent African grocers, each with its own prices and stock.</p>{data && <StoreList stores={data} />}</>;
}

export function StorePage() {
  const { slug } = useParams();
  const { data: s, loading, error, reload } = useApi<S>(`/stores/${slug}`);
  const rev = useApi<Reviews>(`/stores/${slug}/reviews`);
  const [cat, setCat] = useState<string>('');
  const cats = useMemo(() => { const m = new Map<string, string>(); s?.products.forEach((p) => p.category_slug && m.set(p.category_slug, p.category ?? p.category_slug)); return [...m.entries()]; }, [s]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!s) return null;
  const items: Card[] = s.products.filter((p) => !cat || p.category_slug === cat).map((p) => ({ ...p, min_price: p.price_cents, was_price: p.compare_at_cents, in_stock: p.available > 0, on_sale: p.on_promotion, store_count: 1, store_name: s.name, store_slug: slug!, available: p.available }));
  return (
    <>
      <div className="shead">
        <div className="shead-cover">{s.cover_url ? <img src={s.cover_url} alt="" /> : <StoreBanner name={s.name} />}</div>
        <div className="shead-body">
          {s.logo_url ? <img className="logo-img" src={s.logo_url} alt="" width={64} height={64} style={{ borderRadius: '50%', objectFit: 'cover' }} /> : <StoreMark name={s.name} size={64} />}
          <div className="grow"><h1>{s.name}</h1>
            <div className="row wrap"><Badge tone={s.is_open ? 'ok' : 'warn'}>{s.is_open ? 'Open now' : 'Closed now'}</Badge>{s.regions.map((r) => <Link key={r.slug} to={`/search?region=${r.slug}&store=${slug}`}><Badge>{r.name}</Badge></Link>)}{s.offers_pickup && <Badge tone="info">Pickup available</Badge>}{rev.data?.average != null && <Badge tone="info">★ {rev.data.average} ({rev.data.count})</Badge>}{s.is_test_data && <Badge tone="demo">Demo store</Badge>}</div></div>
        </div>
        <div className="shead-meta small muted"><IconPin width={16} height={16} style={{ verticalAlign: -3 }} /> {[s.address_line, s.city, s.province, s.postal_code].filter(Boolean).join(', ')}{s.phone ? ` · ${s.phone}` : ''}{s.min_order_cents ? ` · Minimum order ${money(s.min_order_cents)}` : ''}</div>
      </div>
      {s.is_test_data && <Notice tone="warn">Demo store with invented data for development. It is not a real business.</Notice>}
      {s.ordering_paused && <Notice tone="warn">This store has paused online orders for now.</Notice>}
      {!s.is_open && !s.ordering_paused && <Notice>This store is closed right now. You can fill your basket, but you can only check out while it is open.</Notice>}
      <p style={{ marginTop: 14 }}>{s.description}</p>
      <details><summary style={{ cursor: 'pointer', minHeight: 32 }}>Opening hours{s.policies ? ' and store policies' : ''}</summary>
        <ul role="list" style={{ paddingLeft: 18 }}>{s.hours.map((h, i) => <li key={i}>{DAYS[h.dow]} {h.opens.slice(0, 5)}–{h.closes.slice(0, 5)}</li>)}</ul>{s.policies && <p>{s.policies}</p>}</details>
      <div className="catchips" role="group" aria-label="Departments in this store">
        <button className={!cat ? 'on' : ''} onClick={() => setCat('')}>All ({s.products.length})</button>
        {cats.map(([k, n]) => <button key={k} className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{n}</button>)}
      </div>
      <ProductGrid products={items} />
      <BasketBar />
    </>
  );
}
