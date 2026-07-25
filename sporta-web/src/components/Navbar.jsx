import { useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { useCart } from '../lib/cart'
import SearchOverlay from './SearchOverlay'
import CartDrawer from './CartDrawer'
import { useWishlist } from '../lib/wishlist'
import { useTheme } from '../lib/theme'

export default function Navbar() {
  const { t, lang, toggle } = useLang()
  const { count } = useCart()
  const { count: wishCount } = useWishlist()
  const { theme, toggle: toggleTheme } = useTheme()
  const [searchOpen, setSearchOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  // Prefetch route chunks on hover so the next click renders instantly.
  const links = [
    { to: '/', label: t.nav.home },
    { to: '/shop', label: t.nav.shop, prefetch: () => import('../pages/Shop') },
    { to: '/about', label: t.nav.about, prefetch: () => import('../pages/About') },
    { to: '/contact', label: t.nav.contact, prefetch: () => import('../pages/Contact') },
  ]

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-ink/95 text-white backdrop-blur">
      {/* Announcement bar */}
      <p className="bg-brand px-4 py-1.5 text-center text-xs font-semibold text-white">
        {t.ann}
      </p>
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        {/* language toggle (left) */}
        <button
          onClick={toggle}
          className="flex items-center gap-1 rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white/90 hover:border-brand hover:text-brand"
        >
          🌐 {lang === 'en' ? 'AR' : 'EN'}
        </button>

        {/* logo (center) — official mark, white variant for dark header */}
        <NavLink to="/" aria-label="Sporta — home">
          <img src="/logo-white.png" alt="Sporta Sports Wear" width="132" height="41" className="h-8 w-auto md:h-9" />
        </NavLink>

        {/* actions (right) */}
        <div className="flex items-center gap-4">
          <button onClick={() => setCartOpen(true)} className="relative" aria-label={t.nav.cart}>
            <span className="text-xl">🛍️</span>
            {count > 0 && (
              <span className="absolute -end-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
                {count}
              </span>
            )}
          </button>
          <Link to="/wishlist" className="relative hidden text-xl sm:inline" aria-label="Wishlist">
            🤍
            {wishCount > 0 && (
              <span className="absolute -end-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
                {wishCount}
              </span>
            )}
          </Link>
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t.theme.light : t.theme.dark}
            className="text-lg transition hover:scale-110"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button
            onClick={() => setSearchOpen(true)}
            aria-label={t.search.title}
            className="text-xl transition hover:scale-110"
          >
            🔍
          </button>
        </div>
      </nav>
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />

      {/* secondary nav row */}
      <div className="border-t border-white/5">
        <ul className="mx-auto flex max-w-7xl items-center justify-center gap-6 px-4 py-2 text-sm font-semibold">
          {links.map((l) => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                end={l.to === '/'}
                onMouseEnter={l.prefetch}
                className={({ isActive }) =>
                  `transition hover:text-brand ${isActive ? 'text-brand' : 'text-white/80'}`
                }
              >
                {l.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </header>
  )
}
