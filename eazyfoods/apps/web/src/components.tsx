import { Link } from 'react-router-dom';
import { money, packLabel, type ProductCard, type StoreCard } from './api';

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <p className="muted" role="status" aria-live="polite">{label}…</p>;
}
export function ErrorBox({ message }: { message: string }) {
  return <div className="notice error" role="alert"><strong>Something went wrong.</strong> {message}</div>;
}
export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children}</div>;
}

// No product photography exists yet, so we show an honest placeholder instead of stock imagery.
export function Tile({ name }: { name: string }) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const initials = name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join('');
  return <div className="tile" style={{ background: `hsl(${hue} 35% 88%)`, color: `hsl(${hue} 45% 25%)` }} aria-hidden="true">{initials}</div>;
}

export function ProductGrid({ products }: { products: ProductCard[] }) {
  return (
    <ul className="grid" role="list">
      {products.map((p) => (
        <li key={p.slug}>
          <Link to={`/p/${p.slug}`} className="card product">
            <Tile name={p.name} />
            <div className="card-body">
              {p.brand && <span className="eyebrow">{p.brand}</span>}
              <h3>{p.name}</h3>
              <span className="muted small">{packLabel(p)}</span>
              {p.matched_alias && <span className="chip">Also known as “{p.matched_alias}”</span>}
              <div className="row between">
                <strong>{money(p.min_price)}{p.store_count && p.store_count > 1 ? <span className="muted small"> from</span> : null}</strong>
                {!p.in_stock && <span className="chip warn">Out of stock</span>}
              </div>
              {p.store_count ? <span className="muted small">{p.store_count} store{p.store_count > 1 ? 's' : ''}</span> : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function StoreList({ stores }: { stores: StoreCard[] }) {
  return (
    <ul className="grid stores" role="list">
      {stores.map((s) => (
        <li key={s.slug}>
          <Link to={`/s/${s.slug}`} className="card store">
            <div className="card-body">
              <h3>{s.name}</h3>
              <span className="muted small">{s.city}{s.min_order_cents ? ` · min. order ${money(s.min_order_cents)}` : ''}</span>
              <div className="row wrap">
                <span className={`chip ${s.is_open ? 'ok' : 'warn'}`}>{s.is_open ? 'Open now' : 'Closed now'}</span>
                {s.regions.map((r) => <span key={r.slug} className="chip">{r.name}</span>)}
                {s.is_test_data && <span className="chip demo">Demo store</span>}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
