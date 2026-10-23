import { useState, type FormEvent } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, type Region } from './api';
import { useApi, useMe } from './hooks';
import { Home } from './pages/Home';
import { SearchPage } from './pages/Search';
import { CollectionPage } from './pages/Collection';
import { ProductPage } from './pages/Product';
import { StorePage } from './pages/Store';
import { AuthPage } from './pages/Auth';
import { Empty } from './components';

function Header({ me, onLogout }: { me: ReturnType<typeof useMe>['me']; onLogout: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const regions = useApi<Region[]>('/regions');
  const loc = useLocation();
  const activeRegion = loc.pathname === '/search' ? new URLSearchParams(loc.search).get('region') : null;
  const submit = (e: FormEvent) => { e.preventDefault(); nav(`/search?q=${encodeURIComponent(q)}`); };
  return (
    <header className="site-header">
      <div className="wrap bar">
        <Link to="/" className="logo" aria-label="EAZyfoods home">EAZy<span>foods</span></Link>
        <form onSubmit={submit} role="search" className="searchbar">
          <label className="sr-only" htmlFor="q">Search products, brands and stores</label>
          <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search garri, shito, berbere, pondu…" autoComplete="off" />
          <button type="submit">Search</button>
        </form>
        <div className="account">
          {me ? (<><span className="small">Hi, {me.full_name.split(' ')[0]}</span><button className="link" onClick={onLogout}>Sign out</button></>)
              : <NavLink to="/account">Sign in</NavLink>}
        </div>
      </div>
      <nav className="wrap regions" aria-label="Shop by region">
        {regions.data?.map((r) => <Link key={r.slug} to={`/search?region=${r.slug}`} className={activeRegion === r.slug ? 'active' : ''} aria-current={activeRegion === r.slug ? 'page' : undefined}>{r.name}</Link>)}
        <NavLink to="/stores">Stores</NavLink>
      </nav>
    </header>
  );
}

export function App() {
  const { me, reload } = useMe();
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); reload(); };
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <Header me={me} onLogout={logout} />
      <main id="main" className="wrap">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/stores" element={<StorePage list />} />
          <Route path="/c/:slug" element={<CollectionPage />} />
          <Route path="/p/:slug" element={<ProductPage />} />
          <Route path="/s/:slug" element={<StorePage />} />
          <Route path="/account" element={<AuthPage onDone={reload} />} />
          <Route path="*" element={<Empty title="Page not found"><Link to="/">Back to the shop</Link></Empty>} />
        </Routes>
      </main>
      <footer className="site-footer">
        <div className="wrap">
          <strong>EAZyfoods</strong> · African groceries from local stores, starting in Calgary, Alberta.
          <p className="small muted">Prices and availability are set by each store. Checkout is not open yet.</p>
        </div>
      </footer>
    </>
  );
}
