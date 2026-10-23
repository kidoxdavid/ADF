import { useParams } from 'react-router-dom';
import { useApi } from '../hooks';
import { Empty, ErrorBox, Loading } from '../ui';
import { ProductGrid } from '../cards';
import type { ProductCard } from '../api';

export function CollectionPage() {
  const { slug } = useParams();
  const { data, loading, error, reload } = useApi<{ collection: { title: string; subtitle: string }; products: ProductCard[] }>(`/collections/${slug}`);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!data) return null;
  return (<><h1>{data.collection.title}</h1><p className="muted">{data.collection.subtitle}</p>
    {data.products.length ? <ProductGrid products={data.products} /> : <Empty title="No products yet">Stores have not listed anything in this collection.</Empty>}</>);
}
