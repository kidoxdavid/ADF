import { Link } from 'react-router-dom';
import { type Region, type StoreCard } from '../api';
import { useApi } from '../hooks';
import { ProductArt } from '../art';
import { Shelf, StoreList, type Card } from '../cards';
import { HeroCarousel, type Slide } from '../carousel';
import { ErrorBox, Loading, Notice } from '../ui';
import { IconShield, IconStore, IconSwap, IconTruck, IconBook } from '../icons';
import { post } from '../api';
import { useAdImpression } from '../cards';

type Search = { results: Card[] };
const REGION_COLOURS: [string, string][] = [['#0f5a3a', '#1f8f5b'], ['#a3470f', '#e08a1e'], ['#254e8f', '#4a86d4'], ['#7a2e5d', '#b4508a'], ['#136f63', '#2bb3a1'], ['#8c2f39', '#d4564a']];

function RegionQuad({ r }: { r: Region }) {
  const { data } = useApi<Search>(`/search?region=${r.slug}&in_stock=1`);
  const items = data?.results.slice(0, 4) ?? [];
  if (data && !items.length) return null;
  return (
    <Link to={`/search?region=${r.slug}`} className="quad">
      <h3>Shop {r.name} groceries</h3>
      <div className="quad-grid">{(items.length ? items : Array.from({ length: 4 }, () => null)).map((p, i) => <div key={i}>{p ? <ProductArt name={p.name} brand={p.brand} category={p.category_slug ?? p.category} /> : null}</div>)}</div>
      <span className="go">See all {r.name.split(' ')[0]} products</span>
    </Link>
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

function CollectionShelf({ slug }: { slug: string }) {
  const { data } = useApi<{ collection: { title: string; subtitle: string }; products: Card[] }>(`/collections/${slug}`);
  if (!data?.products.length) return null;
  return <Shelf title={data.collection.title} subtitle={data.collection.subtitle} to={`/c/${slug}`} items={data.products} />;
}

export function Home() {
  const content = useApi<{ home_hero?: { title: string; subtitle: string } }>('/content/home');
  const regions = useApi<Region[]>('/regions');
  const stores = useApi<StoreCard[]>('/stores');
  const cols = useApi<{ slug: string }[]>('/collections');
  const deals = useApi<Card[]>('/deals');
  const fresh = useApi<Card[]>('/new-arrivals');
  const cats = useApi<{ slug: string; name: string }[]>('/categories');
  const recipes = useApi<{ slug: string; title: string; summary: string }[]>('/recipes');
  const featured = useApi<Search>('/search?in_stock=1&sort=price_desc');
  const eastSearch = useApi<Search>(`/search?region=${regions.data?.[1]?.slug ?? 'east-africa'}&in_stock=1`);
  const hero = content.data?.home_hero;
  const east = regions.data?.[1];

  // Build the slides only once every feed has settled, so they appear together and in a fixed order. Building them as data
  // arrives made the first-to-load slide (e.g. the red deals slide) flash and then jump when the welcome slide was inserted.
  const ready = !featured.loading && !deals.loading && !regions.loading && !eastSearch.loading && !recipes.loading && !content.loading;
  const slides: Slide[] = [];
  if (ready && featured.data) slides.push({ id: 'welcome', from: '#0b3a24', to: '#1d7a4c', eyebrow: 'Calgary · African groceries', title: (hero?.title ?? 'African groceries, from the stores you trust.').replace('\n', ' '), text: hero?.subtitle ?? 'Compare each store’s own price and stock, then have it delivered.', cta: { to: '/search', label: 'Start shopping' }, art: featured.data.results });
  if (ready && deals.data?.length) slides.push({ id: 'deals', from: '#b8260f', to: '#f0701f', eyebrow: 'Weekly deals', title: 'Save on pantry staples this week', text: 'Live promotions from local stores, priced as you’ll pay.', cta: { to: '/deals', label: 'Shop deals' }, art: deals.data });
  if (ready && east && eastSearch.data?.results.length) slides.push({ id: 'east', from: '#7a3a0b', to: '#d98b1f', eyebrow: east.name, title: `Discover ${east.name.replace(' Africa', '')} African ingredients`, text: east.countries.slice(0, 4).map((c) => c.name).join(' · '), cta: { to: `/search?region=${east.slug}`, label: `Shop ${east.name}` }, art: eastSearch.data.results });
  if (ready && recipes.data?.length && featured.data) slides.push({ id: 'cook', from: '#3b2a6b', to: '#7a4bb8', eyebrow: 'Cook tonight', title: recipes.data[0].title, text: 'Add the ingredients that are in stock to your basket in one tap.', cta: { to: `/recipes`, label: 'See recipes' }, art: [...featured.data.results].reverse() });

  return (
    <>
      {slides.length ? <HeroCarousel slides={slides} /> : ready ? null : <div className="hero-skel" aria-hidden="true" />}
      {stores.data?.some((s) => s.is_test_data) && <Notice tone="warn"><strong>Development data.</strong> Stores marked “Demo store” are invented for testing and are not real businesses. Product pictures are illustrations until stores upload photos.</Notice>}
      <HomeBanner />
      {regions.error && <ErrorBox message={regions.error} retry={regions.reload} />}
      <div className="quads">{regions.data?.slice(0, 4).map((r) => <RegionQuad key={r.slug} r={r} />)}</div>

      <Shelf title="Today’s deals" subtitle="Live promotions — the price shown is what you pay" to="/deals" items={deals.data ?? []} />

      <section className="block" aria-labelledby="dept-h">
        <h2 id="dept-h">Shop by department</h2>
        <ul className="depts" role="list">{cats.data?.map((c) => <CatTile key={c.slug} slug={c.slug} name={c.name} />)}</ul>
      </section>

      {cols.data?.slice(0, 2).map((c) => <CollectionShelf key={c.slug} slug={c.slug} />)}
      <Shelf title="New arrivals" subtitle="Just added to the catalogue" to="/new" items={fresh.data ?? []} />
      {cols.data?.slice(2, 4).map((c) => <CollectionShelf key={c.slug} slug={c.slug} />)}

      <section className="block" aria-labelledby="stores-h">
        <div className="shelf-head"><h2 id="stores-h">Stores near you</h2><Link to="/stores" className="seeall">All stores</Link></div>
        {stores.loading && <Loading />}{stores.error && <ErrorBox message={stores.error} retry={stores.reload} />}
        {stores.data && <StoreList stores={stores.data} />}
      </section>

      {!!recipes.data?.length && (
        <section className="block" aria-labelledby="rec-h">
          <div className="shelf-head"><div><h2 id="rec-h">Cook something tonight</h2><p className="muted">Recipes linked to what’s in stock.</p></div><Link to="/recipes" className="seeall">All recipes</Link></div>
          <ul className="recipe-tiles" role="list">{recipes.data.slice(0, 4).map((r, i) => <li key={r.slug}><Link to={`/recipes/${r.slug}`} className="rtile" style={{ background: `linear-gradient(135deg, ${REGION_COLOURS[i % 6][0]}, ${REGION_COLOURS[i % 6][1]})` }}><h3>{r.title}</h3><p>{r.summary}</p></Link></li>)}</ul>
        </section>
      )}

      <div className="trust">
        <div><IconStore /><span><b>Local African grocers</b>Real stores, each with its own stock and prices.</span></div>
        <div><IconSwap /><span><b>Compare stores</b>See every store’s price side by side.</span></div>
        <div><IconTruck /><span><b>Delivery you can see</b>Fees and times shown per store before you pay.</span></div>
        <div><IconShield /><span><b>Help when it goes wrong</b>Report a problem and we’ll make it right. <Link to="/pages/refund-policy">Policy</Link></span></div>
      </div>
      <span hidden><IconBook /></span>
    </>
  );
}

function CatTile({ slug, name }: { slug: string; name: string }) {
  const { data } = useApi<Search>(`/search?category=${slug}&in_stock=1`);
  const p = data?.results[0];
  if (data && !p) return null;
  return <li><Link to={`/search?category=${slug}`} className="dept"><div>{p && <ProductArt name={p.name} brand={p.brand} category={p.category_slug ?? p.category} />}</div>{name.replace(' & ', ' & ')}</Link></li>;
}
