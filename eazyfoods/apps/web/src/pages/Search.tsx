import { useSearchParams } from 'react-router-dom';
import { type ProductCard, type Region } from '../api';
import { useApi } from '../hooks';
import { Empty, ErrorBox, Loading, ProductGrid } from '../components';

type Result = { total: number; page: number; page_size: number; results: ProductCard[]; suggestions?: { message: string; regions: { slug: string; name: string }[] } };

export function SearchPage() {
  const [sp, setSp] = useSearchParams();
  const qs = sp.toString();
  const { data, loading, error } = useApi<Result>(`/search?${qs}`);
  const regions = useApi<Region[]>('/regions');
  const cats = useApi<{ slug: string; name: string }[]>('/categories');
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); n.delete('page'); setSp(n); };
  const q = sp.get('q');

  return (
    <div className="layout">
      <details className="filters" open={typeof window !== 'undefined' && window.matchMedia('(min-width: 800px)').matches}>
        <summary>Filters &amp; sorting</summary>
        <label>Region
          <select value={sp.get('region') ?? ''} onChange={(e) => set('region', e.target.value)}>
            <option value="">All regions</option>
            {regions.data?.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
          </select>
        </label>
        <label>Category
          <select value={sp.get('category') ?? ''} onChange={(e) => set('category', e.target.value)}>
            <option value="">All categories</option>
            {cats.data?.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </label>
        <label>Sort by
          <select value={sp.get('sort') ?? 'relevance'} onChange={(e) => set('sort', e.target.value)}>
            <option value="relevance">Best match</option><option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option><option value="name">Name</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={sp.get('in_stock') === '1'} onChange={(e) => set('in_stock', e.target.checked ? '1' : '')} /> In stock only</label>
      </details>
      <section aria-live="polite">
        <h1 className="h2">{q ? `Results for “${q}”` : 'Browse products'}</h1>
        {loading && <Loading />}
        {error && <ErrorBox message={error} />}
        {data && <p className="muted">{data.total} product{data.total === 1 ? '' : 's'}</p>}
        {data && data.total > 0 && <ProductGrid products={data.results} />}
        {data && data.total === 0 && (
          <Empty title="Nothing found">
            <p>{data.suggestions?.message}</p>
            <div className="row wrap">{data.suggestions?.regions.map((r) => <button key={r.slug} className="chip btn" onClick={() => setSp({ region: r.slug })}>{r.name}</button>)}</div>
          </Empty>
        )}
        {data && data.total > data.page_size && (
          <div className="row">
            <button disabled={data.page <= 1} onClick={() => set('page', String(data.page - 1))}>Previous</button>
            <button disabled={data.page * data.page_size >= data.total} onClick={() => { const n = new URLSearchParams(sp); n.set('page', String(data.page + 1)); setSp(n); }}>Next</button>
          </div>
        )}
      </section>
    </div>
  );
}
