import { lazy, Suspense, type ReactNode } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import { CartProvider } from './cart';
import { ToastProvider } from './toast';
import { Footer, Header, TabBar } from './shell';
import { Empty, Loading } from './ui';
import { RequireAuth } from './guard';
import { Home } from './pages/Home';
import { SearchPage } from './pages/Search';
import { ProductPage } from './pages/Product';
import { StorePage, StoresPage } from './pages/Store';
import { CollectionPage } from './pages/Collection';
import { CartPage } from './pages/Cart';
import { CheckoutPage } from './pages/Checkout';
import { OrdersPage, OrderPage } from './pages/Orders';
import { AccountPage } from './pages/Account';
import { SignIn, Register, Forgot, Reset, Verify } from './pages/Auth';
import { RecipesPage, RecipePage } from './pages/Recipes';
import { ContentPage } from './pages/ContentPage';

const Vendor = lazy(() => import('./portals/vendor'));
const Admin = lazy(() => import('./portals/admin'));
const Driver = lazy(() => import('./portals/driver'));

const Site = ({ children }: { children: ReactNode }) => (
  <>
    <a className="skip" href="#main">Skip to content</a>
    <Header />
    <main id="main" className="wrap">{children}</main>
    <Footer />
    <TabBar />
  </>
);

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <CartProvider>
          <Suspense fallback={<div className="wrap"><Loading /></div>}>
            <Routes>
              <Route path="/vendor/*" element={<RequireAuth><Vendor /></RequireAuth>} />
              <Route path="/admin/*" element={<RequireAuth><Admin /></RequireAuth>} />
              <Route path="/driver/*" element={<RequireAuth><Driver /></RequireAuth>} />
              <Route path="*" element={
                <Site>
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/search" element={<SearchPage />} />
                    <Route path="/stores" element={<StoresPage />} />
                    <Route path="/s/:slug" element={<StorePage />} />
                    <Route path="/c/:slug" element={<CollectionPage />} />
                    <Route path="/p/:slug" element={<ProductPage />} />
                    <Route path="/recipes" element={<RecipesPage />} />
                    <Route path="/recipes/:slug" element={<RecipePage />} />
                    <Route path="/cart" element={<CartPage />} />
                    <Route path="/checkout" element={<RequireAuth><CheckoutPage /></RequireAuth>} />
                    <Route path="/orders" element={<RequireAuth><OrdersPage /></RequireAuth>} />
                    <Route path="/orders/:id" element={<RequireAuth><OrderPage /></RequireAuth>} />
                    <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
                    <Route path="/signin" element={<SignIn />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/forgot" element={<Forgot />} />
                    <Route path="/reset" element={<Reset />} />
                    <Route path="/verify" element={<Verify />} />
                    <Route path="/pages/:slug" element={<ContentPage />} />
                    <Route path="*" element={<Empty title="Page not found"><Link to="/">Back to the shop</Link></Empty>} />
                  </Routes>
                </Site>
              } />
            </Routes>
          </Suspense>
        </CartProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
