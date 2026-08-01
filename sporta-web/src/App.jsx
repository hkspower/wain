import { Routes, Route } from 'react-router-dom'
import { useLang } from './i18n/LanguageContext'
import { lazy, Suspense } from 'react'
import Navbar from './components/Navbar'
import ScrollManager from './components/ScrollManager'
import Footer from './components/Footer'
import PullToRefresh from './components/PullToRefresh'
import Home from './pages/Home'

// Route-level code splitting: the public site ships only Home + chrome up front.
const Shop = lazy(() => import('./pages/Shop'))
const ProductDetail = lazy(() => import('./pages/ProductDetail'))
const Cart = lazy(() => import('./pages/Cart'))
const Checkout = lazy(() => import('./pages/Checkout'))
const PaymentResult = lazy(() => import('./pages/PaymentResult'))
const About = lazy(() => import('./pages/About'))
const Contact = lazy(() => import('./pages/Contact'))
const AdminApp = lazy(() => import('./admin/AdminApp'))
const NotFound = lazy(() => import('./pages/NotFound'))
const Wishlist = lazy(() => import('./pages/Wishlist'))
const TrackOrder = lazy(() => import('./pages/TrackOrder'))
const Invoice = lazy(() => import('./pages/Invoice'))
const Returns = lazy(() => import('./pages/Returns'))
const Terms = lazy(() => import('./pages/Terms'))
const Privacy = lazy(() => import('./pages/Privacy'))

function Loading() {
  const { t } = useLang()
  return (
    <div className="mx-auto max-w-7xl px-4 py-16" role="status" aria-live="polite" aria-label={t.a11y.loading}>
      <div className="skeleton mb-6 h-8 w-48 rounded-xl" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card overflow-hidden">
            <div className="skeleton aspect-square w-full" />
            <div className="space-y-2 p-4">
              <div className="skeleton h-4 w-3/4 rounded" />
              <div className="skeleton h-3 w-1/2 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {/* Admin panel — standalone, no marketing chrome, lazy-loaded */}
        {/* The backends screen. It was /admin until the owner renamed it — a
            bookmark to the old path now lands on the 404 page, deliberately:
            there is no redirect, because the point of a name nobody guesses is
            defeated by a signpost pointing at it. */}
        <Route path="/backends/*" element={<AdminApp />} />
        {/* Public storefront */}
        <Route path="/*" element={<PublicSite />} />
      </Routes>
    </Suspense>
  )
}

function PublicSite() {
  const { t } = useLang()
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollManager />
      {/* Skip link. There are eight tab stops before the content on every page
          — language, logo, bag, wishlist, theme, search, then four nav links —
          and a keyboard or switch user had to walk all of them on every
          navigation. Visible only when focused, and it is the FIRST thing in the
          tab order, which is the only position that helps. */}
      <a href="#main" className="skip-link">
        {t.a11y.skip}
      </a>

      {/* Only renders inside an installed PWA, where there is no browser
          chrome and so no native pull-to-refresh. */}
      <PullToRefresh />

      <Navbar />
      <main id="main" tabIndex={-1} className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/product/:slug" element={<ProductDetail />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/payment/result" element={<PaymentResult />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/wishlist" element={<Wishlist />} />
          <Route path="/track" element={<TrackOrder />} />
          <Route path="/invoice/:trackId" element={<Invoice />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}
