import { del, fmtDate, dollarsToCents, money, post } from '../../api';
import { useAction, useApi } from '../../hooks';
import { useToast } from '../../toast';
import { Button, Card, Confirm, DataTable, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, StatusBadge, formValues } from '../../ui';
import { StoreSelect, useVendor } from './Shared';

type Promo = { id: string; name: string; regular_price_cents: number; sale_price_cents: number; starts_at: string; ends_at: string; state: string };
const localIso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function Promotions() {
  const { storeId } = useVendor(); const toast = useToast();
  const promos = useApi<Promo[]>(`/vendor/stores/${storeId}/promotions`);
  const offers = useApi<{ product_id: string; name: string; price_cents: number }[]>(`/vendor/stores/${storeId}/offers`);
  const create = useAction(async (v: Record<string, string>, form: HTMLFormElement) => {
    await post(`/vendor/stores/${storeId}/promotions`, { product_id: v.product, sale_price_cents: dollarsToCents(v.price), starts_at: new Date(v.starts).toISOString(), ends_at: new Date(v.ends).toISOString() });
    toast('Promotion scheduled.'); form.reset(); promos.reload();
  });
  const now = new Date();
  return (<>
    <PageHeader title="Promotions" sub="Schedule a sale price. Customers see the lower price automatically while it runs." />
    <StoreSelect />
    <Card><h2>New promotion</h2>
      <form onSubmit={(e) => { const f = e.currentTarget; create.run(formValues(e), f); }}>
        {create.error && <Notice tone="error">{create.error}</Notice>}
        <div className="form-grid">
          <Field label="Product"><Select name="product" required defaultValue=""><option value="" disabled>Choose a product you list…</option>{offers.data?.map((o) => <option key={o.product_id} value={o.product_id}>{o.name} ({money(o.price_cents)})</option>)}</Select></Field>
          <Field label="Sale price (CAD)" hint="Must be lower than your regular price."><Input name="price" type="number" step="0.01" min="0.01" required inputMode="decimal" /></Field>
          <Field label="Starts"><Input name="starts" type="datetime-local" required defaultValue={localIso(now)} /></Field>
          <Field label="Ends"><Input name="ends" type="datetime-local" required defaultValue={localIso(new Date(now.getTime() + 7 * 864e5))} /></Field></div>
        <Button type="submit" busy={create.busy}>Schedule promotion</Button></form></Card>
    <h2>Your promotions</h2>
    {promos.loading && !promos.data ? <Loading /> : promos.error ? <ErrorBox message={promos.error} retry={promos.reload} /> :
      <DataTable rows={promos.data ?? []} rowKey={(r) => r.id} empty="No promotions yet." columns={[
        { key: 'name', header: 'Product', render: (r) => <strong>{r.name}</strong> }, { key: 'reg', header: 'Regular', render: (r) => money(r.regular_price_cents) }, { key: 'sale', header: 'Sale', render: (r) => money(r.sale_price_cents) },
        { key: 'when', header: 'Runs', render: (r) => `${fmtDate(r.starts_at)} → ${fmtDate(r.ends_at)}` }, { key: 'state', header: 'Status', render: (r) => <StatusBadge status={r.state} /> },
        { key: 'a', header: '', render: (r) => ['active', 'scheduled'].includes(r.state) ? <Confirm size="sm" variant="secondary" message="Cancel this promotion? The regular price applies straight away." onConfirm={async () => { await del(`/vendor/stores/${storeId}/promotions/${r.id}`).then(() => { toast('Promotion cancelled.'); promos.reload(); }, (e) => toast(e.message, 'error')); }}>Cancel</Confirm> : null }]} />}
  </>);
}
