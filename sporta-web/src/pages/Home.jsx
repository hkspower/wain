import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { PRODUCTS } from '../lib/products'
import ProductCard from '../components/ProductCard'

export default function Home() {
  const { t } = useLang()
  const featured = PRODUCTS.slice(0, 4)

  return (
    <>
      <section className="bg-brand-light">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-24 text-center">
          <h1 className="text-5xl font-extrabold text-brand-dark md:text-6xl">{t.hero.title}</h1>
          <p className="max-w-xl text-lg text-slate-600">{t.hero.subtitle}</p>
          <Link
            to="/shop"
            className="rounded-full bg-brand px-8 py-3 font-semibold text-white shadow-lg transition hover:bg-brand-dark"
          >
            {t.hero.cta}
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-8 flex items-center justify-between">
          <h2 className="text-2xl font-extrabold text-brand-dark">{t.shop.featured}</h2>
          <Link to="/shop" className="text-sm font-semibold text-brand hover:underline">
            {t.shop.viewAll} →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {featured.map((p) => (
            <ProductCard key={p.slug} product={p} />
          ))}
        </div>
      </section>
    </>
  )
}
