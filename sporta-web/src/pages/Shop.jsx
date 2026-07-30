import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

  // -------------------------------------------------------------------------
  // Progressive rendering, with an infinite-scroll sentinel.
  //
  // WHY, given the catalogue is only 46 products: the grid was 827 DOM nodes and
  // 48 <img> elements on one page, all built before the first paint. That is
  // work the shopper pays for whether or not they scroll, and it grows with the
  // catalogue — a real photograph per product instead of a gradient makes it
  // grow a lot faster.
  //
  // PAGE is 12 because the grid is 2 / 3 / 4 columns, and 12 fills three, four
  // or six rows exactly — no half-empty final row at any breakpoint.
  //
  // The sentinel loads the next page BEFORE it is reached (rootMargin 600px), so
  // in practice there is no waiting and no spinner. If IntersectionObserver is
  // missing, or JavaScript is having a bad day, the button underneath is a real
  // button and does the same thing — which is also what makes this keyboard- and
  // screen-reader-accessible, since an observer that only fires on scroll is
  // neither.
  const PAGE = 12
  const [shown, setShown] = useState(PAGE)
  const sentinel = useRef(null)

  // A new filter or sort is a new list, so it starts from the top again.
  useEffect(() => setShown(PAGE), [cat, sort, q])

  const more = useCallback(() => setShown((n) => Math.min(n + PAGE, sorted.length)), [sorted.length])

  useEffect(() => {
    const el = sentinel.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && more(), {
      rootMargin: '600px 0px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [more])

  const visible = sorted.slice(0, shown)
  const remaining = sorted.length - visible.length

  return (
    <section className="mx-auto max-w-7xl px-4 py-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900">{t.shop.h1}</h1>
          <p className="mt-1 text-sm text-slate-600">{sorted.length} · KWD</p>
          <p className="mt-2 max-w-2xl text-slate-600">{t.shop.intro}</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
          {t.sort.label}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="min-h-11 rounded-full border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-brand"
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
            className={`flex min-h-11 items-center rounded-full px-4 text-sm font-semibold transition ${
              cat === c.id ? 'bg-brand text-ink shadow' : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            {c.name[lang]}
          </button>
        ))}
      </div>

      <h2 className="sr-only">{t.shop.gridHeading}</h2>
      <div className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-3 md:gap-x-4 lg:grid-cols-4">
        {visible.map((p) => (
          <ProductCard key={p.slug} product={p} />
        ))}
      </div>

      {remaining > 0 && (
        <div className="mt-10 flex flex-col items-center gap-3">
          {/* The sentinel sits ABOVE the button and is zero-height: it is a
              scroll trigger, not a control, so it is aria-hidden and the button
              beside it is the accessible way to do the same thing. */}
          <div ref={sentinel} aria-hidden className="h-px w-full" />
          <button onClick={more} className="btn btn-ghost text-accent">
            {t.shop.loadMore.replace('{n}', numLocal(Math.min(PAGE, remaining), lang))}
          </button>
          {/* Announced, so a screen-reader user knows the list grew rather than
              wondering why the page got longer. */}
          <p aria-live="polite" className="text-xs text-slate-600">
            {t.shop.showing
              .replace('{shown}', numLocal(visible.length, lang))
              .replace('{total}', numLocal(sorted.length, lang))}
          </p>
        </div>
      )}
    </section>
  )
}

// Arabic-Indic digits, as everywhere else numbers appear on this site.
const numLocal = (n, lang) =>
  lang === 'ar' ? String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]) : String(n)
