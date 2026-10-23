import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { money, type Region } from './api';
import { useApi } from './hooks';
import { useAuth } from './auth';
import { useCart } from './cart';
import { usePlace } from './place';
import { IconBasket, IconClose, IconHome, IconMenu, IconOrders, IconPin, IconSearch, IconUser } from './icons';
import { Button, Field, Input, Modal, Notice } from './ui';

function PlaceModal() {
  const { place, check, clear, open, setOpen } = usePlace();
  const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setBusy(true); setErr(undefined);
    try { await check(String(new FormData(e.currentTarget).get('postal'))); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Where should we deliver?">
      <p className="muted">Enter your postal code to see whether we deliver to you and what it costs. You choose your exact address at checkout.</p>
      <form onSubmit={submit} className="row top">
        <div className="grow"><Field label="Postal code"><Input name="postal" defaultValue={place?.postal ?? ''} placeholder="T2A 0A0" autoComplete="postal-code" required /></Field></div>
        <Button type="submit" busy={busy} style={{ marginTop: 26 }}>Check</Button>
      </form>
      {err && <Notice tone="error">{err}</Notice>}
      {place && (place.serviceable
        ? <Notice tone="ok"><strong>Yes, we deliver to {place.fsa}.</strong> {place.zone}: delivery fee {money(place.fee_cents)} per store{place.free_over_cents ? `, free when that store’s items come to ${money(place.free_over_cents)}+` : ''}, about {place.eta_minutes} minutes after the store confirms.</Notice>
        : <Notice tone="warn"><strong>We don’t deliver to {place.fsa} yet.</strong> You can still browse, and stores that offer pickup may be an option.</Notice>)}
      {place && <button className="link" onClick={clear}>Clear location</button>}
    </Modal>
  );
}

function Mega({ onClose }: { onClose: () => void }) {
  const regions = useApi<Region[]>('/regions');
  const cats = useApi<{ slug: string; name: string }[]>('/categories');
  const loc = useLocation();
  useEffect(() => { onClose(); }, [loc.pathname + loc.search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="mega-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mega" role="dialog" aria-label="All departments">
        <div className="mega-head"><strong>Shop EAZyfoods</strong><button className="icon-btn" onClick={onClose} aria-label="Close menu"><IconClose /></button></div>
        <div className="mega-cols">
          <div><h3>By region</h3><ul role="list">{regions.data?.map((r) => (
            <li key={r.slug}><Link to={`/search?region=${r.slug}`}>{r.name}</Link>
              <span className="mega-sub">{r.countries.slice(0, 5).map((c) => <Link key={c.slug} to={`/search?region=${r.slug}&country=${c.slug}`}>{c.name}</Link>)}</span></li>))}</ul></div>
          <div><h3>By department</h3><ul role="list">{cats.data?.map((c) => <li key={c.slug}><Link to={`/search?category=${c.slug}`}>{c.name}</Link></li>)}</ul></div>
          <div><h3>Discover</h3><ul role="list"><li><Link to="/deals">Weekly deals</Link></li><li><Link to="/new">New arrivals</Link></li><li><Link to="/recipes">Recipes</Link></li><li><Link to="/stores">All stores</Link></li></ul>
            <h3 style={{ marginTop: 18 }}>Partner with us</h3><ul role="list"><li><Link to="/vendor">Sell on EAZyfoods</Link></li><li><Link to="/driver">Drive with us</Link></li></ul></div>
        </div>
      </div>
    </div>
  );
}

export function Header() {
  const nav = useNavigate(); const loc = useLocation();
  const { me, logout, isStaff, isVendor, has } = useAuth();
  const { count, cart, guest } = useCart();
  const { place, setOpen } = usePlace();
  const [q, setQ] = useState(''); const [dept, setDept] = useState('');
  const [menu, setMenu] = useState(false);
  const regions = useApi<Region[]>('/regions');
  const cats = useApi<{ slug: string; name: string }[]>('/categories');
  const content = useApi<{ announcement?: { text: string; active: boolean } }>('/content/home');
  const active = loc.pathname === '/search' ? new URLSearchParams(loc.search).get('region') : null;
  const ann = content.data?.announcement;
  const subtotal = cart ? cart.subtotal_cents : guest.reduce((a, g) => a + g.unit_price_cents * g.quantity, 0);
  const submit = (e: FormEvent) => { e.preventDefault(); const p = new URLSearchParams(); if (q.trim()) p.set('q', q.trim()); if (dept) p.set('category', dept); nav(`/search?${p}`); };
  const closeMenu = useRef(() => setMenu(false)).current;
  return (
    <>
      {ann?.active && ann.text && <div className="announce" role="note">{ann.text}</div>}
      <header className="hdr">
        <div className="hdr-util"><div className="wrap">
          <span>Calgary, Alberta · African groceries from local stores</span>
          <span className="util-links"><Link to="/vendor">Sell on EAZyfoods</Link><Link to="/driver">Drive with us</Link><Link to="/pages/how-it-works">How it works</Link><Link to="/pages/faq">Help</Link></span>
        </div></div>
        <div className="hdr-main"><div className="wrap hdr-row">
          <button className="icon-btn menu-btn" aria-label="Open all departments" aria-expanded={menu} onClick={() => setMenu(true)}><IconMenu /></button>
          <Link to="/" className="logo" aria-label="EAZyfoods home">EAZy<span>foods</span></Link>
          <button className="deliver" onClick={() => setOpen(true)}>
            <IconPin width={22} height={22} /><span><small>Deliver to</small><b>{place ? `${place.fsa} ${place.serviceable ? '' : '(not yet)'}` : 'Choose location'}</b></span>
          </button>
          <form onSubmit={submit} role="search" className="hsearch">
            <label className="sr-only" htmlFor="dept">Department</label>
            <select id="dept" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All</option>{cats.data?.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select>
            <label className="sr-only" htmlFor="q">Search products, brands and stores</label>
            <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search garri, shito, berbere, pondu…" autoComplete="off" enterKeyHint="search" />
            <button type="submit" aria-label="Search"><IconSearch /></button>
          </form>
          <div className="hacct desktop-only">
            {me ? (<><Link to="/account"><small>Hello, {me.full_name.split(' ')[0]}</small><b>Account</b></Link><Link to="/orders"><small>Returns &</small><b>Orders</b></Link></>)
              : (<Link to="/signin"><small>Hello, sign in</small><b>Account</b></Link>)}
          </div>
          <Link to="/cart" className="hcart">
            <span className="sr-only">Basket, {count} item{count === 1 ? '' : 's'}</span><span className="hcart-ico"><IconBasket width={28} height={28} />{count > 0 && <span className="count">{count}</span>}</span>
            <span className="hcart-txt"><small>{count ? `${count} item${count === 1 ? '' : 's'}` : 'Basket'}</small><b>{count ? money(subtotal) : 'Empty'}</b></span>
          </Link>
        </div></div>
        <nav className="hdr-nav" aria-label="Shop"><div className="wrap hdr-navrow">
          <button className="alldept" onClick={() => setMenu(true)} aria-expanded={menu}><IconMenu width={18} height={18} /> All departments</button>
          {regions.data?.map((r) => <Link key={r.slug} to={`/search?region=${r.slug}`} className={active === r.slug ? 'active' : ''} aria-current={active === r.slug ? 'page' : undefined}>{r.name}</Link>)}
          <Link to="/deals" className="hot">Deals</Link><Link to="/new">New</Link><Link to="/recipes">Recipes</Link><Link to="/stores">Stores</Link>
          <span className="grow" />
          <span className="desktop-only navr">{isVendor && <Link to="/vendor">Vendor portal</Link>}{has('driver') && <Link to="/driver">Driver</Link>}{isStaff && <Link to="/admin">Admin</Link>}{me && <button className="link" onClick={logout}>Sign out</button>}</span>
        </div></nav>
      </header>
      {menu && <Mega onClose={closeMenu} />}
      <PlaceModal />
    </>
  );
}

export function TabBar() {
  const { count } = useCart(); const { me } = useAuth();
  const tab = (to: string, label: string, Icon: typeof IconHome, end = false) => <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}><Icon /><span>{label}</span></NavLink>;
  return (
    <nav className="tabbar" aria-label="Main">
      {tab('/', 'Shop', IconHome, true)}{tab('/search', 'Browse', IconSearch)}
      <NavLink to="/cart" className={({ isActive }) => (isActive ? 'active' : '')}><IconBasket /><span>Basket</span>{count > 0 && <span className="count">{count}</span>}</NavLink>
      {tab('/orders', 'Orders', IconOrders)}{tab(me ? '/account' : '/signin', me ? 'Account' : 'Sign in', IconUser)}
    </nav>
  );
}

export function Footer() {
  const pages = useApi<{ slug: string; title: string }[]>('/pages');
  const regions = useApi<Region[]>('/regions');
  return (
    <footer className="ftr">
      <button className="totop" onClick={() => window.scrollTo({ top: 0 })}>Back to top</button>
      <div className="wrap ftr-cols">
        <div><h3>Shop</h3><ul role="list">{regions.data?.map((r) => <li key={r.slug}><Link to={`/search?region=${r.slug}`}>{r.name}</Link></li>)}<li><Link to="/deals">Weekly deals</Link></li><li><Link to="/new">New arrivals</Link></li><li><Link to="/stores">Stores</Link></li></ul></div>
        <div><h3>Help</h3><ul role="list">{pages.data?.filter((p) => ['how-it-works', 'delivery-policy', 'refund-policy', 'faq'].includes(p.slug)).map((p) => <li key={p.slug}><Link to={`/pages/${p.slug}`}>{p.title}</Link></li>)}<li><Link to="/orders">Your orders</Link></li></ul></div>
        <div><h3>Work with us</h3><ul role="list"><li><Link to="/vendor">Sell on EAZyfoods</Link></li><li><Link to="/driver">Drive with us</Link></li></ul></div>
        <div><h3>Legal</h3><ul role="list">{pages.data?.filter((p) => ['privacy', 'terms'].includes(p.slug)).map((p) => <li key={p.slug}><Link to={`/pages/${p.slug}`}>{p.title}</Link></li>)}</ul></div>
      </div>
      <div className="ftr-base"><div className="wrap"><strong className="logo">EAZy<span>foods</span></strong><span>African groceries from local stores, starting in Calgary, Alberta. Prices and availability are set by each store.</span></div></div>
    </footer>
  );
}
