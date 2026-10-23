import { Link } from 'react-router-dom';
import { type Region, type StoreCard } from '../api';
import { useApi } from '../hooks';
import { ErrorBox, Loading, ProductGrid, StoreList } from '../components';
import type { ProductCard } from '../api';

function CollectionRow({ slug }: { slug: string }) {
  const { data } = useApi<{ collection: { title: string; subtitle: string }; products: ProductCard[] }>(`/collections/${slug}`);
  if (!data || !data.products.length) return null;
  return (
    <section aria-labelledby={`h-${slug}`}>
      <div className="row between"><h2 id={`h-${slug}`}>{data.collection.title}</h2><Link to={`/c/${slug}`}>See all</Link></div>
      <p className="muted">{data.collection.subtitle}</p>
      <ProductGrid products={data.products.slice(0, 4)} />
    </section>
  );
}

export function Home() {
  const regions = useApi<Region[]>('/regions');
  const stores = useApi<StoreCard[]>('/stores');
  const cols = useApi<{ slug: string }[]>('/collections');
  return (
    <>
      <section className="hero">
        <h1>African groceries,<br />from the stores you trust.</h1>
        <p>Browse Calgary’s African grocers by region. Compare each store’s own price and stock before you choose.</p>
      </section>
      <section aria-labelledby="regions-h">
        <h2 id="regions-h">Shop by region</h2>
        {regions.loading && <Loading />}
        {regions.error && <ErrorBox message={regions.error} />}
        <ul className="regions-grid" role="list">
          {regions.data?.map((r) => (
            <li key={r.slug}>
              <Link to={`/search?region=${r.slug}`} className="card region">
                <h3>{r.name}</h3>
                <span className="muted small">{r.countries.slice(0, 4).map((c) => c.name).join(', ')}{r.countries.length > 4 ? ` +${r.countries.length - 4} more` : ''}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {cols.data?.slice(0, 3).map((c) => <CollectionRow key={c.slug} slug={c.slug} />)}
      <section aria-labelledby="stores-h">
        <h2 id="stores-h">Stores</h2>
        {stores.loading && <Loading />}
        {stores.error && <ErrorBox message={stores.error} />}
        {stores.data && <StoreList stores={stores.data} />}
      </section>
    </>
  );
}
