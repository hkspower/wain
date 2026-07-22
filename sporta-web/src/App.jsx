import { Routes, Route } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import Home from './pages/Home'

// Route-level code splitting: the public site ships only Home + chrome up front.
// About/Services/Contact and the whole admin (incl. Supabase) load on demand.
const About = lazy(() => import('./pages/About'))
const Services = lazy(() => import('./pages/Services'))
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
        {/* Public marketing site */}
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
          <Route path="/about" element={<About />} />
          <Route path="/services" element={<Services />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}
