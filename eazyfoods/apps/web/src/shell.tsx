import { useState, type FormEvent } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApi } from './hooks';
import { useAuth } from './auth';
import { useCart } from './cart';
import { IconBasket, IconHome, IconOrders, IconSearch, IconUser } from './icons';
import type { Region } from './api';

export function Header() {
  const nav = useNavigate();
  const loc = useLocation();
  const { me, logout, isStaff, isVendor, has } = useAuth();
  const { count } = useCart();
  const [q, setQ] = useState('');
  const regions = useApi<Region[]>('/regions');
  const content = useApi<{ announcement?: { text: string; active: boolean } }>('/content/home');
  const active = loc.pathname === '/search' ? new URLSearchParams(loc.search).get('region') : null;
  const submit = (e: FormEvent) => { e.preventDefault(); nav(`/search?q=${encodeURIComponent(q)}`); };
  const ann = content.data?.announcement;
  return (
    <>
      {ann?.active && ann.text && <div className="announce" role="note">{ann.text}</div>}
      <header className="site-header">
        <div className="wrap bar">
          <Link to="/" className="logo" aria-label="EAZyfoods home">EAZy<span>foods</span></Link>
          <form onSubmit={submit} role="search" className="searchbar">
            <label className="sr-only" htmlFor="q">Search products, brands and stores</label>
            <input id="q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search garri, shito, berbere, pondu…" autoComplete="off" enterKeyHint="search" />
            <button className="btn primary" type="submit" aria-label="Search"><IconSearch /></button>
          </form>
          <div className="account-links">
            <span className="desktop-only">
              {isVendor && <Link to="/vendor">Vendor portal</Link>}
              {has('driver') && <Link to="/driver">Driver</Link>}
              {isStaff && <Link to="/admin">Admin</Link>}
              <Link to="/recipes">Recipes</Link>
              {me ? <><Link to="/orders">Orders</Link><Link to="/account">{me.full_name.split(' ')[0]}</Link></> : null}
            </span>
            <Link to="/cart" className="icon-btn" aria-label={`Basket, ${count} item${count === 1 ? '' : 's'}`}><IconBasket />{count > 0 && <span className="count" style={{ position: 'absolute', top: 2, right: 0, margin: 0 }}>{count}</span>}</Link>
            {!me && <Link to="/signin" className="btn secondary sm">Sign in</Link>}
            {me && <button className="link desktop-only" onClick={logout}>Sign out</button>}
          </div>
        </div>
        <nav className="wrap region-nav" aria-label="Shop by region">
          {regions.data?.map((r) => <Link key={r.slug} to={`/search?region=${r.slug}`} className={active === r.slug ? 'active' : ''} aria-current={active === r.slug ? 'page' : undefined}>{r.name}</Link>)}
          <Link to="/stores">Stores</Link><Link to="/recipes">Recipes</Link>
        </nav>
      </header>
    </>
  );
}

export function TabBar() {
  const { count } = useCart();
  const { me } = useAuth();
  const tab = (to: string, label: string, Icon: typeof IconHome, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}><Icon /><span>{label}</span></NavLink>
  );
  return (
    <nav className="tabbar" aria-label="Main">
      {tab('/', 'Shop', IconHome, true)}
      {tab('/search', 'Search', IconSearch)}
      <NavLink to="/cart" className={({ isActive }) => (isActive ? 'active' : '')}><IconBasket /><span>Basket</span>{count > 0 && <span className="count">{count}</span>}</NavLink>
      {tab('/orders', 'Orders', IconOrders)}
      {tab(me ? '/account' : '/signin', me ? 'Account' : 'Sign in', IconUser)}
    </nav>
  );
}

export function Footer() {
  const pages = useApi<{ slug: string; title: string }[]>('/pages');
  return (
    <footer className="site-footer">
      <div className="wrap">
        <strong className="display">EAZyfoods</strong> · African groceries from local stores, starting in Calgary, Alberta.
        <nav aria-label="Help and policies">{pages.data?.map((p) => <Link key={p.slug} to={`/pages/${p.slug}`}>{p.title}</Link>)}<Link to="/vendor">Sell on EAZyfoods</Link><Link to="/driver">Drive with us</Link></nav>
        <p className="small muted">Prices and availability are set by each store. Questions? Open any order and choose “Report a problem”.</p>
      </div>
    </footer>
  );
}
