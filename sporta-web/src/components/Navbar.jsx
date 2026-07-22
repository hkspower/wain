import { NavLink } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'

export default function Navbar() {
  const { t, lang, toggle } = useLang()
  const links = [
    { to: '/', label: t.nav.home },
    { to: '/about', label: t.nav.about },
    { to: '/services', label: t.nav.services },
    { to: '/contact', label: t.nav.contact },
  ]

  return (
    <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <NavLink to="/" className="text-2xl font-extrabold text-brand">
          {t.hero.title}
        </NavLink>
        <ul className="hidden gap-6 md:flex">
          {links.map((l) => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                end={l.to === '/'}
                className={({ isActive }) =>
                  `text-sm font-semibold transition hover:text-brand ${
                    isActive ? 'text-brand' : 'text-slate-600'
                  }`
                }
              >
                {l.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <button
          onClick={toggle}
          className="rounded-full border border-brand px-3 py-1 text-sm font-semibold text-brand transition hover:bg-brand hover:text-white"
        >
          {lang === 'en' ? 'العربية' : 'English'}
        </button>
      </nav>
    </header>
  )
}
