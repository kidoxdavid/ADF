import { Link, useSearchParams } from 'react-router-dom';
import { money, type Region } from '../api';
import { useApi } from '../hooks';
import { Button, Empty, ErrorBox, Loading, Select } from '../ui';
import { ProductGrid, type Card } from '../cards';

type Facet = { slug: string; name: string; n: number };
type Result = { total: number; page: number; page_size: number; results: Card[]; suggestions?: { message: string; regions: { slug: string; name: string }[] }; facets?: { categories: Facet[]; regions: Facet[]; stores: Facet[]; price: { min: number; max: number } } };
const PRICE_BANDS: [string, number | null, number | null][] = [['Under $5', null, 499], ['$5 to $10', 500, 1000], ['$10 to $20', 1000, 2000], ['$20 & above', 2000, null]];

export function SearchPage() {
  const [sp, setSp] = useSearchParams();
  const { data, loading, error, reload } = useApi<Result>(`/search?${sp.toString()}`);
  const regions = useApi<Region[]>('/regions');
  const cats = useApi<{ slug: string; name: string }[]>('/categories');
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); n.delete('page'); setSp(n); };
  const q = sp.get('q');
  const desktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches;
  const region = regions.data?.find((r) => r.slug === sp.get('region'));
  const cat = cats.data?.find((c) => c.slug === sp.get('category'));
  const country = region?.countries.find((c) => c.slug === sp.get('country'));
  const store = data?.facets?.stores.find((s) => s.slug === sp.get('store'));
  const title = q ? `Results for “${q}”` : cat?.name ?? (country ? country.name : region?.name) ?? 'All products';
  const active: [string, string, string][] = [];
  if (region) active.push(['region', region.name, 'region']); if (country) active.push(['country', country.name, 'country']); if (cat) active.push(['category', cat.name, 'category']);
  if (store) active.push(['store', store.name, 'store']); if (sp.get('in_stock')) active.push(['in_stock', 'In stock only', 'in_stock']);
  if (sp.get('min_price') || sp.get('max_price')) active.push(['price', PRICE_BANDS.find((b) => String(b[1] ?? '') === (sp.get('min_price') ?? '') && String(b[2] ?? '') === (sp.get('max_price') ?? ''))?.[0] ?? 'Price range', 'price']);
  const clear = (key: string) => { const n = new URLSearchParams(sp); if (key === 'price') { n.delete('min_price'); n.delete('max_price'); } else n.delete(key); if (key === 'region') n.delete('country'); n.delete('page'); setSp(n); };
  const band = (b: (typeof PRICE_BANDS)[number]) => { const n = new URLSearchParams(sp); n.delete('page'); b[1] == null ? n.delete('min_price') : n.set('min_price', String(b[1])); b[2] == null ? n.delete('max_price') : n.set('max_price', String(b[2])); setSp(n); };
  const bandOn = (b: (typeof PRICE_BANDS)[number]) => String(b[1] ?? '') === (sp.get('min_price') ?? '') && String(b[2] ?? '') === (sp.get('max_price') ?? '');

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">Home</Link>{region && <><span>›</span><Link to={`/search?region=${region.slug}`}>{region.name}</Link></>}{cat && <><span>›</span>{cat.name}</>}</nav>
      <div className="layout">
        <details className="facets" open={desktop}>
          <summary>Filters</summary>
          {data?.facets && <>
            {data.facets.regions.length > 0 && <div className="facet"><h3>Region</h3><ul>{data.facets.regions.map((f) => <li key={f.slug}><button className={sp.get('region') === f.slug ? 'on' : ''} onClick={() => set('region', sp.get('region') === f.slug ? null : f.slug)}><span>{f.name}</span><small>{f.n}</small></button></li>)}</ul></div>}
            {region && <div className="facet"><h3>Country</h3><ul>{region.countries.map((c) => <li key={c.slug}><button className={sp.get('country') === c.slug ? 'on' : ''} onClick={() => set('country', sp.get('country') === c.slug ? null : c.slug)}><span>{c.name}</span></button></li>)}</ul></div>}
            <div className="facet"><h3>Department</h3><ul>{data.facets.categories.map((f) => <li key={f.slug}><button className={sp.get('category') === f.slug ? 'on' : ''} onClick={() => set('category', sp.get('category') === f.slug ? null : f.slug)}><span>{f.name}</span><small>{f.n}</small></button></li>)}</ul></div>
            <div className="facet"><h3>Store</h3><ul>{data.facets.stores.map((f) => <li key={f.slug}><button className={sp.get('store') === f.slug ? 'on' : ''} onClick={() => set('store', sp.get('store') === f.slug ? null : f.slug)}><span>{f.name}</span><small>{f.n}</small></button></li>)}</ul></div>
            <div className="facet"><h3>Price</h3><ul>{PRICE_BANDS.map((b) => <li key={b[0]}><button className={bandOn(b) ? 'on' : ''} onClick={() => (bandOn(b) ? (() => { const n = new URLSearchParams(sp); n.delete('min_price'); n.delete('max_price'); setSp(n); })() : band(b))}><span>{b[0]}</span></button></li>)}</ul></div>
          </>}
          <div className="facet"><label className="check"><input type="checkbox" checked={sp.get('in_stock') === '1'} onChange={(e) => set('in_stock', e.target.checked ? '1' : null)} /> In stock only</label></div>
        </details>
        <section aria-live="polite">
          <div className="toolbar">
            <div><h1>{title}</h1>{data && <span className="muted small">{data.total} product{data.total === 1 ? '' : 's'}{data.facets ? ` · ${money(data.facets.price.min)} – ${money(data.facets.price.max)}` : ''}</span>}</div>
            <label className="row small">Sort by <Select value={sp.get('sort') ?? 'relevance'} onChange={(e) => set('sort', e.target.value)} aria-label="Sort by"><option value="relevance">Best match</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="name">Name</option></Select></label>
          </div>
          {active.length > 0 && <div className="chips">{active.map(([k, label, key]) => <button key={k} className="chip-x" onClick={() => clear(key)} aria-label={`Remove filter ${label}`}>{label} ✕</button>)}</div>}
          {region?.description && <p className="muted">{region.description}</p>}
          {loading && <Loading />}{error && <ErrorBox message={error} retry={reload} />}
          {data && data.total > 0 && <ProductGrid products={data.results} />}
          {data && data.total === 0 && (
            <Empty title="Nothing found"><p>{data.suggestions?.message}</p>
              <div className="row wrap" style={{ justifyContent: 'center' }}>{data.suggestions?.regions.map((r) => <Button key={r.slug} variant="secondary" size="sm" onClick={() => setSp({ region: r.slug })}>{r.name}</Button>)}</div></Empty>
          )}
          {data && data.total > data.page_size && (
            <div className="row" style={{ marginTop: 14, justifyContent: 'center' }}>
              <Button variant="secondary" disabled={data.page <= 1} onClick={() => { const n = new URLSearchParams(sp); n.set('page', String(data.page - 1)); setSp(n); window.scrollTo({ top: 0 }); }}>Previous</Button>
              <span className="muted">Page {data.page} of {Math.ceil(data.total / data.page_size)}</span>
              <Button variant="secondary" disabled={data.page * data.page_size >= data.total} onClick={() => { const n = new URLSearchParams(sp); n.set('page', String(data.page + 1)); setSp(n); window.scrollTo({ top: 0 }); }}>Next</Button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
