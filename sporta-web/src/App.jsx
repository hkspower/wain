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

function Loading() {
  return <div className="flex min-h-[40vh] items-center justify-center text-slate-400">…</div>
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
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}
