import { useEffect, useRef, useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { useCart } from '../lib/cart'
import SearchOverlay from './SearchOverlay'
import CartDrawer from './CartDrawer'
import { useWishlist } from '../lib/wishlist'
import { useTheme } from '../lib/theme'
import { IconBag, IconHeart, IconSearch, IconSun, IconMoon, IconGlobe } from './icons'

export default function Navbar() {
  const { t, lang, toggle } = useLang()
  const { count } = useCart()
  const { count: wishCount } = useWishlist()
  const { theme, toggle: toggleTheme } = useTheme()
  const [searchOpen, setSearchOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)

  // Auto-hide on scroll down, reveal on scroll up. Three stacked rows —
  // announcement, logo bar, nav — are 135px, a fifth of an iPhone SE screen,
  // held permanently. Giving it back while someone is scrolling a product grid
  // is the single biggest space win available on a phone. It reveals the
  // instant they scroll up, so nothing is ever more than a flick away, and the
  // translate is confined to phone widths by CSS.
  const [hidden, setHidden] = useState(false)
  const lastY = useRef(0)
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      // Ignore the rubber-band overscroll region and tiny jitters.
      if (y < 120) setHidden(false)
      else if (Math.abs(y - lastY.current) > 8) setHidden(y > lastY.current)
      lastY.current = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  // Prefetch route chunks on hover so the next click renders instantly.
  const links = [
    { to: '/', label: t.nav.home },
    { to: '/shop', label: t.nav.shop, prefetch: () => import('../pages/Shop') },
    { to: '/about', label: t.nav.about, prefetch: () => import('../pages/About') },
    { to: '/contact', label: t.nav.contact, prefetch: () => import('../pages/Contact') },
  ]

  return (
    <header className={`app-header ${hidden ? 'is-hidden' : ''} sticky top-0 z-30 border-b border-white/10 bg-ink/95 text-white backdrop-blur`}>
      {/* Announcement bar */}
      <p className="bg-brand px-4 py-1.5 text-center text-[11px] font-semibold text-white sm:text-xs">
        {t.ann}
      </p>
      {/* Tighter on phones: at the old padding the three header rows ate 138px,
          21% of an iPhone SE viewport, before any content appeared. */}
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-3 py-2 sm:px-4 sm:py-3">
        {/* language toggle (left) */}
        <button
          onClick={toggle}
          className="tap flex items-center justify-center gap-1 rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white/90 hover:border-brand hover:text-brand"
        >
          <IconGlobe size={14} /> {lang === 'en' ? 'AR' : 'EN'}
        </button>

        {/* logo (center) — official mark, white variant for dark header */}
        <NavLink to="/" aria-label={t.a11y.homeLink} className="flex min-h-11 items-center">
          <img src="/logo-white.png" alt="Sporta Sports Wear" width="132" height="41" className="h-8 w-auto md:h-9" />
        </NavLink>

        {/* actions (right) */}
        <div className="flex items-center gap-0.5 sm:gap-3">
          <button onClick={() => setCartOpen(true)} className="tap relative flex items-center justify-center" aria-label={t.nav.cart}>
            <IconBag size={22} />
            {count > 0 && (
              <span className="absolute -end-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
                {count}
              </span>
            )}
          </button>
          {/* Was hidden below 640px, which left the wishlist with no entry
              point at all on a phone — the route existed and nothing linked to
              it. There is room for it. */}
          <Link to="/wishlist" className="tap relative flex items-center justify-center" aria-label={t.a11y.wishlist}>
            <IconHeart size={22} filled={wishCount > 0} />
            {wishCount > 0 && (
              <span className="absolute -end-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
                {wishCount}
              </span>
            )}
          </Link>
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t.theme.light : t.theme.dark}
            className="tap flex items-center justify-center transition hover:scale-110"
          >
            {theme === 'dark' ? <IconSun size={20} /> : <IconMoon size={20} />}
          </button>
          <button
            onClick={() => setSearchOpen(true)}
            aria-label={t.search.title}
            className="tap flex items-center justify-center transition hover:scale-110"
          >
            <IconSearch size={22} />
          </button>
        </div>
      </nav>
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />

      {/* secondary nav row */}
      <div className="border-t border-white/5">
        <ul className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 text-sm font-semibold sm:gap-6">
          {links.map((l) => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                end={l.to === '/'}
                onMouseEnter={l.prefetch}
                className={({ isActive }) =>
                  `flex min-h-11 items-center px-2 transition hover:text-brand ${isActive ? 'text-brand' : 'text-white/80'}`
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
