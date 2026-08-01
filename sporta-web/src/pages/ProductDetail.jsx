import { useEffect, useMemo, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { getProduct, loadProducts, productImages, PRODUCTS, SIZES_FOR } from '../lib/products'
import { useCart } from '../lib/cart'
import { useWishlist } from '../lib/wishlist'
import { formatKWD } from '../lib/format'
import { usePageMeta, productJsonLd, breadcrumbJsonLd, graph } from '../lib/seo'
import ProductCard from '../components/ProductCard'
import SizeGuide from '../components/SizeGuide'
import AhedSpec from '../components/AhedSpec'
import ProductGallery from '../components/ProductGallery'
import BrandPlate from '../components/BrandPlate'
import { OptionBox, Chip, ChipRow, ColourSwatches } from '../components/OptionBox'
import { SIZE_LADDER, normalizeSize, fitsFor, fitLabel, colourwaysOf } from '../lib/options'
import { ahedDetail, AHED_PRODUCTS } from '../lib/ahed'
import { fetchStock, LOW_STOCK_AT } from '../lib/stock'
import { IconTruck, IconLock, IconReturn, IconPlus, IconMinus, IconHeart } from '../components/icons'

export default function ProductDetail() {
  const { slug } = useParams()
  const { lang, t } = useLang()
  const { add } = useCart()
  const wishlist = useWishlist()
  const navigate = useNavigate()
  const [qty, setQty] = useState(1)
  const [size, setSize] = useState(null)
  const [sizeErr, setSizeErr] = useState(false)
  const [fit, setFit] = useState(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const shipped = getProduct(slug)
  // The LIVE price, when the shop has one.
  //
  // The page renders on the shipped catalogue first — same reasoning as the
  // stock below: waiting on a database to draw anything is a slower page for
  // every visitor. But the price is not decoration. Checkout charges what the
  // products table says, so a page that only ever showed the bundled price
  // would advertise 10.000 for something that rings up at 7.500 the moment a
  // sale is on, and the shopper meets the difference at the last step.
  const [live, setLive] = useState(null)
  useEffect(() => {
    let alive = true
    setLive(null)
    loadProducts()
      .then((all) => { if (alive) setLive(all.find((p) => p.slug === slug) ?? null) })
      .catch(() => {})
    return () => { alive = false }
  }, [slug])
  // Only the price fields are taken from the server. Everything else — the
  // images, the copy, the AHED detail — stays with the shipped record, which
  // is richer than the table and does not change under the reader.
  const product = shipped && {
    ...shipped,
    ...(live ? { price: live.price, list_price: live.list_price, on_sale: live.on_sale } : {}),
  }
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

  // WHICH SIZES EXIST, and separately, WHICH ONES YOU CAN HAVE.
  //
  // The box now draws the whole ladder, S through 5XL, for anything that is
  // apparel. Before, it drew only the sizes this piece was bought in — so a 3XL
  // customer saw S M L XL and had no way to tell whether the shop does not
  // carry 3XL or simply sold out of it. The ladder answers that: every size the
  // shop's range contains is on screen, and the ones this piece is not carried
  // in are struck through.
  //
  // `carried` is the same three-source lookup as before, most specific first:
  //   1. the database — what is on the shelf right now
  //   2. the AHED packing slip — what was ever bought in
  //   3. SIZES_FOR(category) — the generic range
  // A shop that has not run the inventory migration behaves exactly as it did.
  const carried = useMemo(() => {
    const from = (list) => new Set((list ?? []).map(normalizeSize))
    if (stock) {
      const known = from(Object.keys(stock))
      return known.size ? known : from(ahed?.sizes ?? SIZES_FOR(product?.category))
    }
    if (ahed?.sizes?.length) return from(ahed.sizes)
    return from(SIZES_FOR(product?.category))
  }, [stock, ahed, product])

  // The ladder itself, plus anything carried that the ladder does not name — a
  // one-size accessory or a numeric size must not vanish because it is not on a
  // clothing rail.
  const sizes = useMemo(() => {
    if (!carried.size) return null
    const extra = [...carried].filter((s) => !SIZE_LADDER.includes(s))
    return [...SIZE_LADDER, ...extra]
  }, [carried])

  // Which fits this garment is made in, and the cut it is designed as. A
  // backpack gets null: it does not come in oversize.
  // Keyed on the SLUG, not on the product object.
  //
  // `product` is rebuilt whenever the live price arrives, so a dependency on
  // the object identity re-ran this, produced a new `fits`, and the effect
  // below reset the shopper's chosen fit back to the default — after they had
  // chosen it. Measured: pick Oversize, wait for the price, and the order goes
  // to the warehouse as Normal. Which fits a garment comes in depends on the
  // garment, and the garment is the slug.
  const fits = useMemo(() => fitsFor(shipped), [slug]) // eslint-disable-line react-hooks/exhaustive-deps
  // Only say "struck-through sizes are not carried" when some actually are.
  const notCarried = useMemo(
    () => !!sizes && sizes.some((sz) => !carried.has(sz)),
    [sizes, carried],
  )
  const colours = useMemo(() => colourwaysOf(slug), [slug])

  // Default to the garment's own cut, and reset it when the product changes —
  // carrying "tank" from a top onto a jacket would be nonsense.
  useEffect(() => setFit(fits?.default ?? null), [fits])

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
    add(product, qty, size, fit)
    return true
  }

  // Whether ANY size of this product is actually available. `stock` is null
  // until the request lands, and null means "do not claim" — the schema then
  // omits the assertion rather than guessing.
  const anyInStock = useMemo(() => {
    if (!stock) return null
    // Each size is {sku, stock, inStock} — see shape() in lib/stock.js. Reading
    // it as a bare number silently made everything OutOfStock, which is the
    // same class of lie as the hard-coded InStock it replaced, in the other
    // direction.
    const sizes = Object.values(stock)
    return sizes.length ? sizes.some((r) => r?.inStock || Number(r?.stock) > 0) : null
  }, [stock])

  const jsonLd = useMemo(
    () =>
      product
        ? graph(
            productJsonLd(product, lang, { inStock: anyInStock }),
            breadcrumbJsonLd([
              [t.nav.home, '/'],
              [t.nav.shop, '/shop'],
              [product.name[lang], `/product/${product.slug}`],
            ]),
          )
        : null,
    [product, lang, t, anyInStock],
  )
  usePageMeta(
    product
      ? {
          title: product.name[lang],
          description: product.desc[lang],
          path: `/product/${product.slug}`,
          jsonLd,
          type: 'product',
          // Only a real URL. Most products still carry generated placeholder
          // artwork as a data: URI, and a crawler cannot fetch one of those —
          // usePageMeta falls back to the brand card.
          image: product.image,
        }
      : { title: t.shop.notFound, path: '/shop', robots: 'noindex, follow' },
  )

  if (!product) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        {/* An h1, not a p — this is the page's only heading. It is noindex, so
            SEO does not care; a screen reader does. */}
        <h1 className="text-lg font-normal text-slate-500">{t.shop.notFound}</h1>
        <Link to="/shop" className="mt-4 inline-block font-semibold text-brand underline">
          {t.shop.backToShop}
        </Link>
      </div>
    )
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-12">
      {/* Visible breadcrumb, matching breadcrumbJsonLd above trail for trail.
          The structured data claimed a trail the page did not actually show,
          which is both the wrong signal to a search engine and a missing way
          back for anyone who arrived on this page from search rather than from
          the shop. aria-current marks the page itself, which is why the last
          crumb is not a link. */}
      <nav aria-label={t.a11y.breadcrumb} className="mb-6 text-sm text-slate-600">
        <ol className="flex flex-wrap items-center gap-1.5">
          {/* -my-2.5 py-2.5 grows the tap target past 40px without moving the
              text or changing the line height — a 21px-tall link is a miss on a
              phone. */}
          <li><Link to="/" className="-my-2.5 inline-block py-2.5 hover:text-accent">{t.nav.home}</Link></li>
          <li aria-hidden className="text-slate-300">/</li>
          <li><Link to="/shop" className="-my-2.5 inline-block py-2.5 hover:text-accent">{t.nav.shop}</Link></li>
          <li aria-hidden className="text-slate-300">/</li>
          <li aria-current="page" className="truncate font-semibold text-slate-700">
            {product.name[lang]}
          </li>
        </ol>
      </nav>

      <div className="grid gap-8 md:grid-cols-2">
        {/* Sticky on desktop only. The AHED specification and the cross-sell
            make this page long, and a 600px photograph scrolling off the top
            leaves the buy panel arguing for a product the visitor can no longer
            see. `top-24` clears the sticky site header. Never sticky on a phone,
            where one column means it would eat the whole screen. */}
        <div className="md:sticky md:top-24 md:self-start">
          <ProductGallery images={productImages(product)} alt={product.name[lang]} />
          {/* Who you are buying from, and who made it, directly under the
              photograph — the two facts a shopper checks before the price. */}
          <BrandPlate detail={ahed} />
        </div>
        <div>
          {/* HIERARCHY. The title and the price used to be two different
              oranges, which is two shouts and no hierarchy — and the price at
              #E0561C on beige measured 2.77:1, the worst pair on the page.
              Now: the name is ink and carries the weight, the price is the only
              orange in the column and is therefore the thing the eye lands on
              second. tabular-nums so 10.000 and 8.000 line up digit for digit. */}
          {/* Save sits with the title, not in the action row. At 390pt the row
              was qty + Add + Buy now + heart, which wrapped the heart onto a
              line by itself and read as a mistake. Top-of-panel is also where
              every shopper already looks for it. */}
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-3xl font-extrabold text-slate-900">{product.name[lang]}</h1>
            <button
              type="button"
              onClick={() => wishlist.toggle(product.slug)}
              aria-pressed={wishlist.has(product.slug)}
              aria-label={wishlist.has(product.slug) ? t.a11y.savedWishlist : t.a11y.saveWishlist}
              title={wishlist.has(product.slug) ? t.a11y.savedWishlist : t.a11y.saveWishlist}
              className={`tap mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition ${
                wishlist.has(product.slug)
                  ? 'border-brand text-brand'
                  : 'border-slate-300 text-slate-600 hover:border-brand hover:text-brand'
              }`}
            >
              <IconHeart size={18} filled={wishlist.has(product.slug)} />
            </button>
          </div>
          <p className="mt-3 text-lg leading-relaxed text-slate-600">{product.desc[lang]}</p>
          <p className="text-accent mt-6 flex items-baseline gap-3 font-display text-[1.75rem] font-bold tabular-nums">
            {formatKWD(product.price, lang)}
            {product.on_sale && (
              <s className="text-lg font-semibold text-slate-400">
                {formatKWD(product.list_price, lang)}
              </s>
            )}
          </p>

          {/* THE THREE OPTION BOXES: size, fit, colour.
              One shared component (OptionBox/Chip) so they cannot drift into
              three different ideas of what "chosen" looks like — which is what
              happens when each row is hand-built where it is used. */}
          <div className="mt-6 space-y-3">
            {sizes && (
              <OptionBox
                label={t.size.label}
                aside={
                  <button
                    type="button"
                    onClick={() => setGuideOpen(true)}
                    className="text-accent -my-3 py-3 text-xs font-semibold underline underline-offset-2"
                  >
                    {t.size.guide}
                  </button>
                }
                hint={notCarried ? t.size.notCarried : null}
              >
                <ChipRow label={t.size.label}>
                  {sizes.map((sz) => {
                    // Two different reasons a size cannot be picked, and the
                    // shopper deserves to know which: NOT CARRIED (this piece
                    // was never made in it) or SOLD OUT (it was, and it is
                    // gone). Both are struck through; the tooltip says which.
                    const notMine = !carried.has(sz)
                    const out = notMine || (stock?.[sz] ? !stock[sz].inStock : false)
                    return (
                      <Chip
                        key={sz}
                        selected={size === sz}
                        disabled={out}
                        title={notMine ? t.size.notCarried : out ? t.spec.soldOut : undefined}
                        onClick={() => {
                          setSize(sz)
                          setSizeErr(false)
                        }}
                      >
                        {sz}
                      </Chip>
                    )
                  })}
                </ChipRow>
                {sizeErr && <p className="mt-2 text-sm font-semibold text-rose-600">{t.size.pick}</p>}

                {/* One fixed-height slot for both stock lines, reserved from the
                    first paint whether or not there is anything to put in it.
                    Measured at 390pt: this page's CLS was 0.0515 — ten times
                    every other route — because "Only 2 left" and "Stocked in
                    these sizes only" appeared when the stock request resolved
                    and pushed Add to cart and Buy now down the page. A button
                    that moves under a thumb already reaching for it is the
                    worst kind of shift. */}
                <div className="mt-2 min-h-10">
                  {/* Scarcity, only where it is a fact. */}
                  {lowNote && <p className="text-sm font-semibold text-amber-700">{lowNote}</p>}
                  {stock && ahed && <p className="text-xs text-slate-600">{t.spec.sizesShipped}</p>}
                </div>
              </OptionBox>
            )}

            {fits && (
              <OptionBox label={t.fit.label} hint={t.fit.note}>
                <ChipRow label={t.fit.label}>
                  {fits.options.map((f) => (
                    <Chip key={f.id} selected={fit === f.id} onClick={() => setFit(f.id)}>
                      {fitLabel(f.id, lang)}
                    </Chip>
                  ))}
                </ChipRow>
              </OptionBox>
            )}

            {colours.length > 1 && (
              <OptionBox label={t.colour.label} hint={t.colour.note}>
                <ColourSwatches colours={colours} label={t.colour.label} />
              </OptionBox>
            )}
          </div>

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
              className="btn btn-ghost text-accent"
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
        <span className="text-accent text-lg font-extrabold tabular-nums">{formatKWD(product.price * qty, lang)}</span>
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
