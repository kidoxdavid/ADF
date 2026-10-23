import { useSearchParams } from 'react-router-dom';
import { type ProductCard, type Region } from '../api';
import { useApi } from '../hooks';
import { Empty, ErrorBox, Loading, Button, Select, Field } from '../ui';
import { ProductGrid } from '../cards';

type Result = { total: number; page: number; page_size: number; results: ProductCard[]; suggestions?: { message: string; regions: { slug: string; name: string }[] } };

export function SearchPage() {
  const [sp, setSp] = useSearchParams();
  const { data, loading, error, reload } = useApi<Result>(`/search?${sp.toString()}`);
  const regions = useApi<Region[]>('/regions');
  const cats = useApi<{ slug: string; name: string }[]>('/categories');
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); n.delete('page'); setSp(n); };
  const q = sp.get('q');
  const desktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches;
  const region = regions.data?.find((r) => r.slug === sp.get('region'));
  return (
    <div className="layout">
      <details className="filters" open={desktop}>
        <summary>Filters &amp; sorting</summary>
        <Field label="Region"><Select value={sp.get('region') ?? ''} onChange={(e) => set('region', e.target.value)}><option value="">All regions</option>{regions.data?.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}</Select></Field>
        {region && <Field label="Country"><Select value={sp.get('country') ?? ''} onChange={(e) => set('country', e.target.value)}><option value="">All in {region.name}</option>{region.countries.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</Select></Field>}
        <Field label="Category"><Select value={sp.get('category') ?? ''} onChange={(e) => set('category', e.target.value)}><option value="">All categories</option>{cats.data?.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</Select></Field>
        <Field label="Sort by"><Select value={sp.get('sort') ?? 'relevance'} onChange={(e) => set('sort', e.target.value)}><option value="relevance">Best match</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="name">Name</option></Select></Field>
        <label className="check"><input type="checkbox" checked={sp.get('in_stock') === '1'} onChange={(e) => set('in_stock', e.target.checked ? '1' : '')} /> In stock only</label>
      </details>
      <section aria-live="polite">
        <h1 style={{ fontSize: '1.7rem' }}>{q ? `Results for “${q}”` : region ? region.name : 'Browse products'}</h1>
        {region?.description && <p className="muted">{region.description}</p>}
        {loading && <Loading />}
        {error && <ErrorBox message={error} retry={reload} />}
        {data && <p className="muted">{data.total} product{data.total === 1 ? '' : 's'}</p>}
        {data && data.total > 0 && <ProductGrid products={data.results} />}
        {data && data.total === 0 && (
          <Empty title="Nothing found">
            <p>{data.suggestions?.message}</p>
            <div className="row wrap" style={{ justifyContent: 'center' }}>{data.suggestions?.regions.map((r) => <Button key={r.slug} variant="secondary" size="sm" onClick={() => setSp({ region: r.slug })}>{r.name}</Button>)}</div>
          </Empty>
        )}
        {data && data.total > data.page_size && (
          <div className="row" style={{ marginTop: 14 }}>
            <Button variant="secondary" disabled={data.page <= 1} onClick={() => { const n = new URLSearchParams(sp); n.set('page', String(data.page - 1)); setSp(n); }}>Previous</Button>
            <Button variant="secondary" disabled={data.page * data.page_size >= data.total} onClick={() => { const n = new URLSearchParams(sp); n.set('page', String(data.page + 1)); setSp(n); }}>Next</Button>
          </div>
        )}
      </section>
    </div>
  );
}
