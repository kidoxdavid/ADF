import { useParams } from 'react-router-dom';
import { money, packLabel, type StoreCard } from '../api';
import { useApi } from '../hooks';
import { ErrorBox, Loading, StoreList, Tile } from '../components';
import { Link } from 'react-router-dom';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type S = {
  name: string; description: string; address_line: string | null; city: string; province: string; postal_code: string | null; phone: string | null;
  is_open: boolean; min_order_cents: number | null; is_test_data: boolean; hours: { dow: number; opens: string; closes: string }[]; regions: { slug: string; name: string }[];
  products: { slug: string; name: string; brand: string | null; pack_size: string | null; pack_unit: string | null; price_cents: number; compare_at_cents: number | null; in_stock: boolean }[];
};

export function StorePage({ list }: { list?: boolean }) {
  const { slug } = useParams();
  const stores = useApi<StoreCard[]>(list ? '/stores' : null);
  const store = useApi<S>(list ? null : `/stores/${slug}`);
  if (list) {
    if (stores.loading) return <Loading />;
    if (stores.error) return <ErrorBox message={stores.error} />;
    return <><h1>Stores</h1>{stores.data && <StoreList stores={stores.data} />}</>;
  }
  if (store.loading) return <Loading />;
  if (store.error) return <ErrorBox message={store.error} />;
  const s = store.data;
  if (!s) return null;
  return (
    <>
      <h1>{s.name}</h1>
      {s.is_test_data && <p className="notice">Demo store with invented data for development. It is not a real business.</p>}
      <div className="row wrap">
        <span className={`chip ${s.is_open ? 'ok' : 'warn'}`}>{s.is_open ? 'Open now' : 'Closed now'}</span>
        {s.regions.map((r) => <span key={r.slug} className="chip">{r.name}</span>)}
      </div>
      <p>{s.description}</p>
      <p className="small muted">{[s.address_line, s.city, s.province, s.postal_code].filter(Boolean).join(', ')}{s.phone ? ` · ${s.phone}` : ''}{s.min_order_cents ? ` · Minimum order ${money(s.min_order_cents)}` : ''}</p>
      <details><summary>Opening hours</summary>
        <ul role="list">{s.hours.map((h, i) => <li key={i}>{DAYS[h.dow]} {h.opens.slice(0, 5)}–{h.closes.slice(0, 5)}</li>)}</ul>
      </details>
      <h2>Products ({s.products.length})</h2>
      <ul className="grid" role="list">
        {s.products.map((p) => (
          <li key={p.slug}><Link to={`/p/${p.slug}`} className="card product"><Tile name={p.name} />
            <div className="card-body">{p.brand && <span className="eyebrow">{p.brand}</span>}<h3>{p.name}</h3><span className="muted small">{packLabel(p)}</span>
              <div className="row between"><strong>{money(p.price_cents)}</strong>{!p.in_stock && <span className="chip warn">Out of stock</span>}</div></div></Link></li>
        ))}
      </ul>
    </>
  );
}
