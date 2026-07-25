import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { IconInstagram, IconTikTok, IconWhatsApp } from './icons'

export default function Footer() {
  const { t } = useLang()
  const L = t.footer.links
  return (
    <footer className="mt-16 bg-ink text-slate-300">
      <div className="mx-auto max-w-7xl px-6 py-12 md:py-16">
        {/* Brand + tagline + socials */}
        <div className="flex flex-col items-center gap-5 text-center">
          <img src="/logo-white.png" alt="Sporta Sports Wear" width="200" height="62" loading="lazy" className="h-12 w-auto" />
          <p className="max-w-md text-sm text-slate-400">{t.footer.tagline}</p>
          <div className="flex items-center gap-3">
            {[
              { href: 'https://www.instagram.com/sporta.kw', label: 'Instagram', Icon: IconInstagram },
              { href: 'https://www.tiktok.com/@sporta.kw', label: 'TikTok', Icon: IconTikTok },
              { href: 'https://wa.me/96522091914', label: 'WhatsApp', Icon: IconWhatsApp },
            ].map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.label}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 transition hover:border-brand hover:text-brand"
              >
                <s.Icon size={18} />
              </a>
            ))}
          </div>
        </div>

        {/* Link columns */}
        <div className="mt-12 grid grid-cols-2 gap-8 text-center sm:text-start">
          <div>
            <h4 className="mb-3 text-sm font-bold text-brand">{t.footer.infoTitle}</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/about" className="hover:text-brand">{L.about}</Link></li>
              <li><Link to="/about" className="hover:text-brand">{L.why}</Link></li>
              <li><Link to="/about" className="hover:text-brand">{L.terms}</Link></li>
              <li><Link to="/about" className="hover:text-brand">{L.privacy}</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-bold text-brand">{t.footer.navTitle}</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/contact" className="hover:text-brand">{L.contact}</Link></li>
              <li><Link to="/shop" className="hover:text-brand">{L.shipping}</Link></li>
              <li><Link to="/shop" className="hover:text-brand">{L.returns}</Link></li>
              <li><Link to="/track" className="hover:text-brand">{L.track}</Link></li>
            </ul>
          </div>
        </div>

        {/* Club / newsletter CTA */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 rounded-3xl bg-ink-soft p-8 text-center md:flex-row md:text-start">
          <div>
            <h4 className="text-xl font-extrabold text-white">{t.news.title}</h4>
            <p className="mt-1 text-sm text-slate-400">{t.news.sub}</p>
          </div>
          <a
            href="https://wa.me/96522091914"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            {t.news.cta}
          </a>
        </div>

        {/* Payment methods */}
        <div className="mt-8 flex items-center justify-center gap-2">
          {['KNET', 'VISA', 'Mastercard'].map((p) => (
            <span
              key={p}
              className="rounded-md border border-white/15 px-2.5 py-1 text-[11px] font-bold tracking-wide text-slate-300"
            >
              {p}
            </span>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} Sporta — {t.footer.rights} · 30199/2023
        </p>
      </div>
    </footer>
  )
}
