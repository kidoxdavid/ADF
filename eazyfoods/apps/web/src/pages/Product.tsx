import { Link, useParams } from 'react-router-dom';
import { money, packLabel } from '../api';
import { useApi } from '../hooks';
import { ErrorBox, Loading, Tile } from '../components';

type P = {
  name: string; brand: string | null; category: string | null; description: string | null; pack_size: string | null; pack_unit: string | null; sold_by: string;
  ingredients: string | null; allergens: string[] | null; storage_info: string | null; manufacturer: string | null;
  countries: { name: string; kind: string }[]; aliases: string[];
  offers: { store_slug: string; store_name: string; is_open: boolean; is_test_data: boolean; price_cents: number; compare_at_cents: number | null; in_stock: boolean }[];
};

export function ProductPage() {
  const { slug } = useParams();
  const { data: p, loading, error } = useApi<P>(`/products/${slug}`);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!p) return null;
  const culinary = p.countries.filter((c) => c.kind === 'culinary').map((c) => c.name);
  const made = p.countries.filter((c) => c.kind === 'manufacturing').map((c) => c.name);
  return (
    <article className="product-page">
      <Tile name={p.name} />
      <div>
        {p.brand && <span className="eyebrow">{p.brand}</span>}
        <h1>{p.name}</h1>
        <p className="muted">{packLabel(p)}{p.sold_by === 'weight' ? ' · sold by weight; final price depends on the weighed amount' : ''}</p>
        {p.description && <p>{p.description}</p>}
        {p.aliases.length > 0 && <p className="small">Also known as: {p.aliases.join(', ')}</p>}
        <dl className="facts">
          {culinary.length > 0 && <><dt>Culinary tradition</dt><dd>{culinary.join(', ')}</dd></>}
          {made.length > 0 && <><dt>Made in</dt><dd>{made.join(', ')}</dd></>}
          {p.ingredients && <><dt>Ingredients</dt><dd>{p.ingredients}</dd></>}
          <dt>Allergens</dt>
          <dd>{p.allergens === null ? 'Not supplied. Check the package before eating if you have allergies.' : p.allergens.length ? `Contains: ${p.allergens.join(', ')}` : 'None declared'}</dd>
          {p.storage_info && <><dt>Storage</dt><dd>{p.storage_info}</dd></>}
        </dl>
        <h2>Available from</h2>
        <ul className="offers" role="list">
          {p.offers.map((o) => (
            <li key={o.store_slug} className="row between">
              <div><Link to={`/s/${o.store_slug}`}><strong>{o.store_name}</strong></Link> {o.is_test_data && <span className="chip demo">Demo store</span>}
                <div className="small muted">{o.is_open ? 'Open now' : 'Closed now'}</div></div>
              <div className="right">
                <strong>{money(o.price_cents)}</strong>{o.compare_at_cents && <s className="muted small"> {money(o.compare_at_cents)}</s>}
                <div className={`small ${o.in_stock ? 'okc' : 'warnc'}`}>{o.in_stock ? 'In stock' : 'Out of stock'}</div>
              </div>
            </li>
          ))}
        </ul>
        <p className="notice">Online ordering opens soon. Prices and stock shown are what each store has listed.</p>
      </div>
    </article>
  );
}
