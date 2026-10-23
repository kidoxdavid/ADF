import { Link } from 'react-router-dom';
import { type ProductCard, type Region, type StoreCard } from '../api';
import { useApi } from '../hooks';
import { ErrorBox, Loading, Notice } from '../ui';
import { ProductGrid, StoreList, useAdImpression } from '../cards';
import { post } from '../api';

function CollectionRow({ slug }: { slug: string }) {
  const { data } = useApi<{ collection: { title: string; subtitle: string }; products: ProductCard[] }>(`/collections/${slug}`);
  if (!data || !data.products.length) return null;
  return (
    <section aria-labelledby={`h-${slug}`}>
      <div className="row between"><h2 id={`h-${slug}`}>{data.collection.title}</h2><Link to={`/c/${slug}`}>See all</Link></div>
      <p className="muted" style={{ marginTop: 0 }}>{data.collection.subtitle}</p>
      <ProductGrid products={data.products.slice(0, 5)} />
    </section>
  );
}

function HomeBanner() {
  const { data } = useApi<{ id: string; title: string; body: string | null; image_url: string | null; store: { slug: string } | null }[]>('/ads?placement=home_banner');
  const ad = data?.[0];
  useAdImpression(ad?.id);
  if (!ad) return null;
  return (
    <Link to={ad.store ? `/s/${ad.store.slug}` : '/stores'} className="banner" onClick={() => post(`/ads/${ad.id}/event`, { type: 'click' }).catch(() => {})}>
      {ad.image_url && <img src={ad.image_url} alt="" />}
      <div><span className="sponsor">Sponsored</span><h3 style={{ margin: '4px 0 2px' }}>{ad.title}</h3>{ad.body && <span className="muted">{ad.body}</span>}</div>
    </Link>
  );
}

export function Home() {
  const content = useApi<{ home_hero?: { title: string; subtitle: string } }>('/content/home');
  const regions = useApi<Region[]>('/regions');
  const stores = useApi<StoreCard[]>('/stores');
  const cols = useApi<{ slug: string }[]>('/collections');
  const recipes = useApi<{ slug: string; title: string; summary: string }[]>('/recipes');
  const hero = content.data?.home_hero;
  return (
    <>
      <section className="hero">
        <h1>{hero?.title ?? 'African groceries, from the stores you trust.'}</h1>
        <p>{hero?.subtitle ?? 'Browse Calgary’s African grocers by region. Compare each store’s own price and stock, then have it delivered.'}</p>
        <div className="row wrap"><Link to="/search" className="btn primary lg">Browse products</Link><Link to="/stores" className="btn secondary lg">See stores</Link></div>
      </section>
      <HomeBanner />
      {stores.data?.some((s) => s.is_test_data) && <Notice tone="warn"><strong>Development data.</strong> Stores marked “Demo store” are invented for testing and are not real businesses. No real orders can be placed.</Notice>}
      <section aria-labelledby="regions-h">
        <h2 id="regions-h">Shop by region</h2>
        {regions.loading && <Loading />}
        {regions.error && <ErrorBox message={regions.error} retry={regions.reload} />}
        <ul className="cards regions" role="list">
          {regions.data?.map((r) => (
            <li key={r.slug}>
              <Link to={`/search?region=${r.slug}`} className="card region">
                <h3>{r.name}</h3>
                <span className="muted small">{r.countries.slice(0, 3).map((c) => c.name).join(', ')}{r.countries.length > 3 ? ` +${r.countries.length - 3} more` : ''}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {cols.data?.slice(0, 3).map((c) => <CollectionRow key={c.slug} slug={c.slug} />)}
      <section aria-labelledby="stores-h">
        <div className="row between"><h2 id="stores-h">Stores near you</h2><Link to="/stores">All stores</Link></div>
        {stores.loading && <Loading />}
        {stores.error && <ErrorBox message={stores.error} retry={stores.reload} />}
        {stores.data && <StoreList stores={stores.data} />}
      </section>
      {!!recipes.data?.length && (
        <section aria-labelledby="rec-h">
          <div className="row between"><h2 id="rec-h">Cook something</h2><Link to="/recipes">All recipes</Link></div>
          <ul className="cards stores" role="list">
            {recipes.data.slice(0, 3).map((r) => <li key={r.slug}><Link to={`/recipes/${r.slug}`} className="card"><div className="card-body" style={{ padding: 14 }}><h3>{r.title}</h3><span className="muted small">{r.summary}</span></div></Link></li>)}
          </ul>
        </section>
      )}
      <section aria-labelledby="trust-h">
        <h2 id="trust-h">How shopping here works</h2>
        <div className="grid cols-3">
          <div className="panel"><h3>Each store sets its own price</h3><p className="muted">You see every store’s price and stock side by side before you choose.</p></div>
          <div className="panel"><h3>One delivery per store</h3><p className="muted">If your basket spans stores, each store delivers separately. We show the fee for each before you pay.</p></div>
          <div className="panel"><h3>If something’s wrong</h3><p className="muted">Report a missing or damaged item from your order. You are never charged for an unapproved replacement. <Link to="/pages/refund-policy">Read the policy</Link>.</p></div>
        </div>
      </section>
    </>
  );
}
