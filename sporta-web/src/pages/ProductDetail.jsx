import { useEffect, useMemo, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { getProduct, PRODUCTS, SIZES_FOR } from '../lib/products'
import { useCart } from '../lib/cart'
import { formatKWD } from '../lib/format'
import { usePageMeta, productJsonLd, breadcrumbJsonLd, graph } from '../lib/seo'
import ProductCard from '../components/ProductCard'
import SizeGuide from '../components/SizeGuide'
import AhedSpec from '../components/AhedSpec'
import { ahedDetail, AHED_PRODUCTS } from '../lib/ahed'
import { fetchStock, LOW_STOCK_AT } from '../lib/stock'
import { IconTruck, IconLock, IconReturn, IconPlus, IconMinus } from '../components/icons'

export default function ProductDetail() {
  const { slug } = useParams()
  const { lang, t } = useLang()
  const { add } = useCart()
  const navigate = useNavigate()
  const [qty, setQty] = useState(1)
  const [size, setSize] = useState(null)
  const [sizeErr, setSizeErr] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const product = getProduct(slug)
  const ahed = ahedDetail(slug)
  const [stock, setStock] = useState(null) // null = not known; see lib/stock.js

  // Live per-size availability. Deliberately not blocking: the page renders on
  // the static catalogue and the size buttons sharpen a moment later, because a
  // product page that waits on the database to draw anything is a slower page
  // for every visitor, including the ones with nothing to buy.
  useEffect(() => {
    let alive = true
    setStock(null)
    fetchStock(slug).then((s) => alive && setStock(s))
    return () => {
      alive = false
    }
  }, [slug])

  // Which sizes to offer, most specific source first:
  //   1. the database — what is on the shelf right now
  //   2. the AHED packing slip — what was ever bought in
  //   3. SIZES_FOR(category) — the generic range, as before
  // A shop that has not run the inventory migration behaves exactly as it did.
  const sizes = useMemo(() => {
    if (stock) {
      const known = Object.keys(stock)
      const order = ahed?.sizes ?? SIZES_FOR(product?.category) ?? []
      const ranked = order.filter((s) => known.includes(s))
      return ranked.length ? ranked : known
    }
    if (ahed?.sizes?.length) return ahed.sizes
    return product ? SIZES_FOR(product.category) : null
  }, [stock, ahed, product])

  // "Only 2 left" for the size in hand, or for the whole product before a size
  // is picked. Never a total across sizes — three lefts in L and none in M is
  // not "3 left" to someone who wears M.
  const lowNote = useMemo(() => {
    if (!stock) return null
    const rows = size ? [stock[size]].filter(Boolean) : Object.values(stock)
    const live = rows.filter((r) => r.inStock)
    if (!live.length) return null
    const n = size ? live[0].stock : Math.max(...live.map((r) => r.stock))
    if (n > LOW_STOCK_AT) return null
    return n === 1 ? t.spec.lastOne : t.spec.onlyLeft.replace('{n}', numAr(n, lang))
  }, [stock, size, t, lang])

  // "Complete the look" used to be the first four products in the catalogue,
  // which for every single page meant the same four. The AHED collections are
  // literally sets — a Sculpt top has a matching legging and jacket, and the
  // packing slip says which colours exist — so pair the same colour of the same
  // collection first, then the rest of the collection, then anything.
  const related = useMemo(() => {
    const mine = AHED_PRODUCTS[slug]
    const rank = (p) => {
      const o = AHED_PRODUCTS[p.slug]
      if (!mine || !o || o.collection !== mine.collection) return 3
      return o.colour === mine.colour ? 0 : 1
    }
    return PRODUCTS.filter((p) => p.slug !== slug)
      .map((p) => [rank(p), p])
      .sort((a, b) => a[0] - b[0])
      .slice(0, 4)
      .map(([, p]) => p)
  }, [slug])

  // Clear a selection that has just gone out of stock, rather than letting the
  // customer carry a sold-out size into the cart.
  useEffect(() => {
    if (size && stock && stock[size] && !stock[size].inStock) setSize(null)
  }, [size, stock])

  function handleAdd() {
    if (sizes?.length && !size) {
      setSizeErr(true)
      return false
    }
    add(product, qty, size)
    return true
  }

  const jsonLd = useMemo(
    () =>
      product
        ? graph(
            productJsonLd(product, lang),
            breadcrumbJsonLd([
              [t.nav.home, '/'],
              [t.nav.shop, '/shop'],
              [product.name[lang], `/product/${product.slug}`],
            ]),
          )
        : null,
    [product, lang, t],
  )
  usePageMeta(
    product
      ? {
          title: product.name[lang],
          description: product.desc[lang],
          path: `/product/${product.slug}`,
          jsonLd,
        }
      : { title: t.shop.notFound, path: '/shop', robots: 'noindex, follow' },
  )

  if (!product) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <p className="text-slate-500">{t.shop.notFound}</p>
        <Link to="/shop" className="mt-4 inline-block font-semibold text-brand underline">
          {t.shop.backToShop}
        </Link>
      </div>
    )
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-12">
      <div className="grid gap-8 md:grid-cols-2">
        <div className="overflow-hidden rounded-2xl bg-slate-50">
          {/* The hero, and the LCP element on this page as soon as the
              placeholders are real photographs. fetchpriority="high" promotes it
              ahead of the other subresources the browser discovers at the same
              time; decoding="async" keeps its decode off the paint. Deliberately
              NOT lazy — it is above the fold, and lazy-loading an above-the-fold
              image delays LCP by a round trip. */}
          <img
            src={product.image}
            alt={product.name[lang]}
            width="600"
            height="600"
            fetchPriority="high"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </div>
        <div>
          <h1 className="text-3xl font-extrabold text-brand-dark">{product.name[lang]}</h1>
          <p className="mt-3 text-lg text-slate-600">{product.desc[lang]}</p>
          <p className="mt-6 text-2xl font-bold text-brand">{formatKWD(product.price, lang)}</p>

          {/* Size selector — required for apparel */}
          {sizes && (
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold text-slate-900">{t.size.label}</span>
                <button type="button" onClick={() => setGuideOpen(true)} className="-my-2 py-2 text-xs font-semibold text-brand underline underline-offset-2">{t.size.guide}</button>
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t.size.label}>
                {sizes.map((sz) => {
                  // undefined stock = unknown, which is treated as available.
                  const out = stock?.[sz] ? !stock[sz].inStock : false
                  return (
                    <button
                      key={sz}
                      onClick={() => { setSize(sz); setSizeErr(false) }}
                      aria-pressed={size === sz}
                      disabled={out}
                      title={out ? t.spec.soldOut : undefined}
                      className={`relative h-11 min-w-11 rounded-xl border px-4 font-bold transition ${
                        out
                          ? 'cursor-not-allowed border-black/10 bg-slate-100 text-slate-400'
                          : size === sz
                            ? 'border-brand bg-brand text-white'
                            : 'border-black/15 bg-white text-slate-700 hover:border-brand'
                      }`}
                    >
                      {/* A struck-through label says "this size exists and you
                          cannot have it", which is the truth. Hiding the button
                          instead makes the shop look like it never stocked it. */}
                      <span className={out ? 'line-through decoration-slate-400' : undefined}>{sz}</span>
                    </button>
                  )
                })}
              </div>
              {sizeErr && <p className="mt-2 text-sm font-semibold text-rose-600">{t.size.pick}</p>}

              {/* One fixed-height slot for both stock lines, reserved from the
                  first paint whether or not there is anything to put in it.
                  Measured at 390pt: this page's CLS was 0.0515 — ten times every
                  other route — because "Only 2 left" and "Stocked in these sizes
                  only" appeared when the stock request resolved and pushed Add
                  to cart and Buy now down the page. A button that moves under a
                  thumb already reaching for it is the worst kind of shift.
                  min-h is 2.5rem: the two lines at their measured heights. */}
              <div className="mt-2 min-h-10">
                {/* Scarcity, only where it is a fact. */}
                {lowNote && <p className="text-sm font-semibold text-amber-700">{lowNote}</p>}
                {stock && ahed && <p className="text-xs text-slate-500">{t.spec.sizesShipped}</p>}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <div className="flex items-center rounded-full border border-slate-300 bg-white">
              <button className="tap flex items-center justify-center px-4 text-slate-700 hover:text-brand" aria-label={t.a11y.decrease} onClick={() => setQty((q) => Math.max(1, q - 1))}><IconMinus size={16} /></button>
              <span className="w-10 text-center font-semibold" aria-live="polite">{qty}</span>
              <button className="tap flex items-center justify-center px-4 text-slate-700 hover:text-brand" aria-label={t.a11y.increase} onClick={() => setQty((q) => q + 1)}><IconPlus size={16} /></button>
            </div>
            <button onClick={handleAdd} className="btn btn-primary">
              {t.shop.add}
            </button>
            <button
              onClick={() => handleAdd() && navigate('/checkout')}
              className="btn btn-ghost text-brand"
            >
              {t.shop.buyNow}
            </button>
          </div>

          {/* Trust signals */}
          <ul className="mt-8 space-y-2 rounded-2xl bg-white p-5 text-sm text-slate-600">
            <li className="flex items-center gap-3"><IconTruck size={18} className="text-brand" /> {t.trust.delivery}</li>
            <li className="flex items-center gap-3"><IconLock size={18} className="text-brand" /> {t.trust.pay}</li>
            <li className="flex items-center gap-3"><IconReturn size={18} className="text-brand" /> {t.trust.returns}</li>
          </ul>
        </div>
      </div>

      {/* The AHED specification, full width under both columns: it is reading
          material, and squeezing a two-column feature list into the buy panel
          pushed the Add-to-cart button below the fold on a phone. */}
      <AhedSpec detail={ahed} size={size} />

      {/* Cross-sell — complete the look */}
      <div className="mt-16">
        <h2 className="mb-6 text-2xl font-extrabold text-slate-900">{t.cross.title}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {related.map((p) => (
            <ProductCard key={p.slug} product={p} />
          ))}
        </div>
      </div>

      {/* Sticky mobile buy bar */}
      {/* Sticky buy bar. safe-bottom keeps it clear of the home-indicator
          gesture bar — without it the button sat under the swipe strip on every
          modern iPhone and Android. */}
      <div className="action-bar safe-bottom flex items-center justify-between gap-3 px-4 pt-3 md:hidden">
        <span className="text-lg font-extrabold text-brand-dark">{formatKWD(product.price * qty, lang)}</span>
        <button
          onClick={() => handleAdd() && navigate('/checkout')}
          className="btn btn-primary flex-1"
        >
          {t.shop.buyNow}
        </button>
      </div>
      {/* Spacer so the bar never covers the last of the page. */}
      <div className="h-[calc(4.75rem+var(--sa-bottom))] md:hidden" aria-hidden />
      <SizeGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </section>
  )
}

// Arabic-Indic digits, matching how every other number on the site renders.
const numAr = (n, lang) =>
  lang === 'ar' ? String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]) : String(n)
