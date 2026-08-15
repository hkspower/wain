import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { usePageMeta } from '../lib/seo'

export default function NotFound() {
  const { t } = useLang()
  usePageMeta({ title: t.nf.title, description: t.nf.sub, path: '/404', robots: 'noindex, follow' })

  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-5 px-6 py-28 text-center">
      <p className="font-display text-7xl font-black text-brand">404</p>
      <h1 className="text-2xl font-extrabold text-slate-900">{t.nf.title}</h1>
      <p className="text-slate-500">{t.nf.sub}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link to="/" className="btn btn-primary">{t.nf.cta}</Link>
        <Link to="/shop" className="btn btn-ghost text-brand-dark">{t.shop.backToShop}</Link>
      </div>
    </section>
  )
}
