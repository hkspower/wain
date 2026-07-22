import { useState } from 'react'
import { useLang } from '../i18n/LanguageContext'
import { CATEGORIES, byCategory } from '../lib/products'
import ProductCard from '../components/ProductCard'

export default function Shop() {
  const { lang, t } = useLang()
  const [cat, setCat] = useState('all')
  const products = byCategory(cat)

  return (
    <section className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="mb-6 text-3xl font-extrabold text-brand-dark">{t.nav.shop}</h1>

      <div className="mb-8 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              cat === c.id ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {c.name[lang]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {products.map((p) => (
          <ProductCard key={p.slug} product={p} />
        ))}
      </div>
    </section>
  )
}
