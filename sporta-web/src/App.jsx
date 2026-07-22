import { Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import Home from './pages/Home'
import About from './pages/About'
import Services from './pages/Services'
import Contact from './pages/Contact'
import AdminApp from './admin/AdminApp'

export default function App() {
  return (
    <Routes>
      {/* Admin panel — standalone, no marketing chrome */}
      <Route path="/admin/*" element={<AdminApp />} />
      {/* Public marketing site */}
      <Route path="/*" element={<PublicSite />} />
    </Routes>
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
