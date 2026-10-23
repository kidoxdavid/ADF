import { Link } from 'react-router-dom';
import { money, packLabel, post } from '../api';
import { useCart } from '../cart';
import { useAuth } from '../auth';
import { useToast } from '../toast';
import { Badge, Button, Empty, Loading, Notice, Stepper } from '../ui';
import { ProductArt } from '../art';

export function CartPage() {
  const { me } = useAuth();
  const { cart, guest, loading, setQty, replace, count } = useCart();
  const toast = useToast();

  if (!me) {
    if (!guest.length) return <Empty title="Your basket is empty"><p>Find something you love.</p><Link to="/search" className="btn primary">Browse products</Link></Empty>;
    const byStore = new Map<string, typeof guest>();
    guest.forEach((g) => byStore.set(g.store_name, [...(byStore.get(g.store_name) ?? []), g]));
    return (
      <>
        <h1>Your basket</h1>
        <Notice>Sign in to check out. We will keep these items in your basket. Prices and stock are checked again when you check out.</Notice>
        {[...byStore.entries()].map(([name, items]) => (
          <section key={name} className="panel"><h2 style={{ fontSize: '1.2rem' }}>{name}</h2>
            {items.map((g) => (
              <div key={g.offer_id} className="line" style={{ gridTemplateColumns: '1fr auto' }}>
                <div><strong>{g.name}</strong><div className="muted small">{g.pack} · {money(g.unit_price_cents)}</div></div>
                <Stepper value={g.quantity} label={g.name} onChange={(n) => setQty(g, n)} />
              </div>))}
          </section>))}
        <Link to="/signin?next=/cart" className="btn primary lg">Sign in to check out</Link>
      </>
    );
  }

  if (loading && !cart) return <Loading />;
  if (!cart || !cart.stores.length) return <Empty title="Your basket is empty"><p>Find something you love.</p><Link to="/search" className="btn primary">Browse products</Link></Empty>;

  const priceChanged = cart.stores.some((s) => s.items.some((i) => i.price_changed));
  const blockers = cart.stores.flatMap((s) => s.items.filter((i) => i.unavailable || i.short));
  return (
    <>
      <h1>Your basket</h1>
      <div className="cart2">
      <div>
      {cart.separate_deliveries && <Notice tone="warn"><strong>{cart.stores.length} stores, {cart.stores.length} deliveries.</strong> Each store prepares and delivers its own part of your order, with its own delivery fee and arrival time. You will see the fee for each before you pay.</Notice>}
      {priceChanged && <Notice tone="warn">Some prices changed since you added them. <Button variant="secondary" size="sm" onClick={async () => replace(await post('/cart/acknowledge-prices'))}>Accept new prices</Button></Notice>}
      {blockers.length > 0 && <Notice tone="error">Some items are unavailable or low in stock. Fix them below to continue.</Notice>}
      {cart.stores.map((s) => (
        <section key={s.slug} className="panel" aria-label={s.name}>
          <div className="row between"><h2 style={{ fontSize: '1.2rem', margin: 0 }}><Link to={`/s/${s.slug}`} style={{ color: 'inherit', textDecoration: 'none' }}>{s.name}</Link></h2>
            <span className="row">{s.is_test_data && <Badge tone="demo">Demo</Badge>}<Badge tone={s.is_open ? 'ok' : 'warn'}>{s.is_open ? 'Open' : 'Closed'}</Badge></span></div>
          {!s.is_open && <p className="small warnc">Closed now: you can check out once it opens.</p>}
          {s.items.map((i) => (
            <div key={i.offer_id} className="line">
              <div className="pimg-s"><ProductArt name={i.name} brand={i.brand} size={packLabel(i)} /></div>
              <div>
                <Link to={`/p/${i.slug}`} style={{ color: 'inherit', textDecoration: 'none' }}><strong>{i.name}</strong></Link>
                <div className="muted small">{packLabel(i)} · {money(i.unit_price_cents)}{i.price_changed && <> <Badge tone="warn">was {money(i.previous_price_cents)}</Badge></>}</div>
                {i.unavailable && <div className="small warnc">Not available from this store. <button className="link" onClick={() => setQty({ offer_id: i.offer_id, slug: i.slug, name: i.name, unit_price_cents: i.unit_price_cents, store_name: s.name, store_slug: s.slug, pack: '' }, 0)}>Remove</button></div>}
                {i.short && <div className="small warnc">Only {i.available} left. <button className="link" onClick={() => setQty({ offer_id: i.offer_id, slug: i.slug, name: i.name, unit_price_cents: i.unit_price_cents, store_name: s.name, store_slug: s.slug, pack: '' }, i.available)}>Reduce to {i.available}</button></div>}
              </div>
              <div className="right">
                {!i.unavailable && <Stepper value={i.quantity} max={Math.max(i.available, i.quantity)} label={i.name} onChange={(n) => setQty({ offer_id: i.offer_id, slug: i.slug, name: i.name, unit_price_cents: i.unit_price_cents, store_name: s.name, store_slug: s.slug, pack: '' }, n)} />}
                <div className="price" style={{ marginTop: 4 }}>{money(i.unit_price_cents * i.quantity)}</div>
              </div>
            </div>
          ))}
          <div className="summary-row"><span>Items from {s.name}</span><strong>{money(s.subtotal_cents)}</strong></div>
          {s.min_order_cents && s.subtotal_cents < s.min_order_cents && <p className="small warnc">This store has a {money(s.min_order_cents)} minimum order. Add {money(s.min_order_cents - s.subtotal_cents)} more.</p>}
        </section>
      ))}
      </div>
      <aside className="panel">
        <div className="summary-row total"><span>Subtotal ({count} item{count === 1 ? '' : 's'})</span><span>{money(cart.subtotal_cents)}</span></div>
        <p className="small muted">Delivery fees, GST and any discount code are shown at checkout, per store, before you pay.</p>
        <Link to="/checkout" className={`btn cta lg wide ${blockers.length ? 'disabled' : ''}`} aria-disabled={blockers.length > 0} onClick={(e) => blockers.length && e.preventDefault()}>Proceed to checkout</Link>
        <div style={{ marginTop: 8 }}><Button variant="ghost" size="sm" onClick={async () => { replace(await (await import('../api')).del('/cart')); toast('Basket cleared'); }}>Clear basket</Button></div>
      </aside>
      </div>
    </>
  );
}
