import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { CATEGORIES, PRODUCTS, byCategory } from '../lib/products'
import ProductCard from '../components/ProductCard'
import { usePageMeta, itemListJsonLd, breadcrumbJsonLd, graph } from '../lib/seo'

export default function Shop() {
  const { lang, t } = useLang()
  const [cat, setCat] = useState('all')
  const [sort, setSort] = useState('newest')
  // /shop?q=... — the search target advertised by the WebSite SearchAction
  // schema, so it must really filter.
  const [params] = useSearchParams()
  const q = (params.get('q') || '').trim().toLowerCase()
  const jsonLd = useMemo(
    () =>
      graph(
        itemListJsonLd(PRODUCTS, lang),
        breadcrumbJsonLd([
          [t.nav.home, '/'],
          [t.nav.shop, '/shop'],
        ]),
      ),
    [lang, t],
  )
  usePageMeta({
    title: t.nav.shop,
    description:
      'Shop premium sportswear in Kuwait — activewear, hoodies, caps and accessories. Prices in KWD with KNET checkout. تسوق ملابس سبورتا الرياضية في الكويت.',
    path: '/shop',
    jsonLd,
  })
  const products = byCategory(cat).filter(
    (p) =>
      !q ||
      p.name.en.toLowerCase().includes(q) ||
      p.name.ar.includes(q) ||
      p.desc?.en?.toLowerCase().includes(q) ||
      p.desc?.ar?.includes(q),
  )

  const sorted = [...products].sort((a, b) =>
    sort === 'priceAsc' ? a.price - b.price : sort === 'priceDesc' ? b.price - a.price : 0,
  )

  return (
    <section className="mx-auto max-w-7xl px-4 py-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900">{t.nav.shop}</h1>
          <p className="mt-1 text-sm text-slate-500">{sorted.length} · KWD</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
          {t.sort.label}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="newest">{t.sort.newest}</option>
            <option value="priceAsc">{t.sort.priceAsc}</option>
            <option value="priceDesc">{t.sort.priceDesc}</option>
          </select>
        </label>
      </div>

      <div className="mb-8 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            aria-pressed={cat === c.id}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              cat === c.id ? 'bg-brand text-white shadow' : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            {c.name[lang]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {sorted.map((p) => (
          <ProductCard key={p.slug} product={p} />
        ))}
      </div>
    </section>
  )
}
