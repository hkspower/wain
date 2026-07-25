import { Routes, Route } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
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
const Returns = lazy(() => import('./pages/Returns'))

function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16" role="status" aria-live="polite" aria-label="Loading">
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
        <Route path="/admin/*" element={<AdminApp />} />
        {/* Public storefront */}
        <Route path="/*" element={<PublicSite />} />
      </Routes>
    </Suspense>
  )
}

function PublicSite() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
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
          <Route path="/returns" element={<Returns />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}
