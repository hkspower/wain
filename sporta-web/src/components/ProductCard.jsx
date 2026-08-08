import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { useCart } from '../lib/cart'
import { useWishlist } from '../lib/wishlist'
import { IconHeart, IconCheck, IconPlus } from './icons'
import { formatKWD } from '../lib/format'
import { fetchStockTable } from '../lib/stock'

// Modern retail grid card (Gymshark-style): the photo IS the card — portrait
// 4:5, no border, no shadow, no white box. Everything interactive lives as an
// overlay on the image; below it just name, description and price on the page
// canvas. Ratings are deliberately gone from the grid: they were a hardcoded
// 4.8 on every product, and a grid that praises itself 20 times reads as fake.
export default function ProductCard({ product }) {
  const { lang, t } = useLang()
  const { add } = useCart()
  const { has, toggle } = useWishlist()
  const navigate = useNavigate()
  const [added, setAdded] = useState(false)
  // undefined = not looked up yet, null = the table is unavailable.
  const [sizes, setSizes] = useState(undefined)

  // One shared, cached request for the whole stock table — twelve cards
  // mounting together make one call, and the product page has usually warmed
  // it already. Deliberately not blocking the render: the card draws from the
  // catalogue immediately and this only ever refines it.
  useEffect(() => {
    let live = true
    fetchStockTable()
      .then((table) => { if (live) setSizes(table ? (table[product.slug] ?? {}) : null) })
      .catch(() => { if (live) setSizes(null) })
    return () => { live = false }
  }, [product.slug])

  // Does this product come in sizes? An accessory has no variant rows, so an
  // EMPTY map is a real answer meaning "no sizes" — which is why {} must not be
  // read as "unknown". null here is genuinely unknown.
  const hasSizes = sizes ? Object.keys(sizes).length > 0 : null

  // Every size out of stock. Only ever true for a product we HAVE rows for, so
  // an accessory is never marked sold out on the strength of no evidence.
  const soldOut = hasSizes === true
    && Object.values(sizes).every((r) => !r?.inStock && !(Number(r?.stock) > 0))

  // WHY THIS BUTTON SOMETIMES NAVIGATES INSTEAD OF ADDING.
  //
  // It used to call add(product) with no size, always. The server refuses a
  // size-less line for anything that HAS sizes — `size_required_<slug>` — so
  // tapping + on a garment built a bag that checkout would not accept, and the
  // checkout has no size picker to fix it with. The shopper met a generic
  // failure at the last step of buying.
  //
  // A garment therefore goes to the product page to choose a size, which is
  // what every retail grid does with quick-add. An accessory still adds in one
  // tap, because for it there is nothing to choose.
  //
  // UNKNOWN COUNTS AS SIZED. If the stock table did not load we cannot tell a
  // jacket from a cap, and the two mistakes are not equal: navigating costs an
  // accessory buyer one extra tap, while adding costs a garment buyer their
  // order at the checkout.
  function quickAdd(e) {
    e.preventDefault()
    if (soldOut) return
    if (hasSizes !== false) { navigate(`/product/${product.slug}`); return }
    add(product)
    setAdded(true)
    setTimeout(() => setAdded(false), 1200)
  }

  return (
    <article className="group flex flex-col">
      <Link
        to={`/product/${product.slug}`}
        className="relative block aspect-[4/5] overflow-hidden rounded-xl bg-slate-100"
        aria-label={product.name[lang]}
      >
        <img
          src={product.image}
          alt={product.name[lang]}
          loading="lazy"
          // decoding="async" keeps the decode off the main thread. Without it a
          // card entering the viewport decoded during the scroll frame, and the
          // shop page's worst frame under 4x CPU throttling was 58 ms.
          decoding="async"
          // 600x750 to match the aspect-[4/5] box. At 600x600 the declared
          // intrinsic ratio contradicted the CSS one — harmless while the
          // container reserves the space, and wrong the moment it does not.
          width="600"
          height="750"
          className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
        />

        {/* SOLD OUT — a veil on the photo, never a change in the card's box,
            so arriving after the first paint moves nothing on the page. */}
        {soldOut && (
          <>
            <span className="absolute inset-0 bg-white/55" aria-hidden="true" />
            <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-ink/85 py-1.5 text-center text-[11px] font-bold uppercase tracking-widest text-white">
              {t.spec.soldOut}
            </span>
          </>
        )}

        {product.badge && !soldOut && (
          <span className="absolute start-2.5 top-2.5 rounded-md bg-brand px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-ink">
            {product.badge[lang]}
          </span>
        )}

        {/* Wishlist — hover-reveal on pointer screens, always visible where
            there is no hover to reveal it. */}
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); toggle(product.slug) }}
          aria-label={t.a11y.saveWishlist}
          aria-pressed={has(product.slug)}
          className={`absolute end-2 top-2 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 shadow-sm backdrop-blur transition hover:text-brand focus-visible:opacity-100 ${
            has(product.slug)
              ? 'text-brand opacity-100'
              : 'text-slate-600 lg:opacity-0 lg:group-hover:opacity-100'
          }`}
        >
          <IconHeart size={17} filled={has(product.slug)} />
        </button>

        {/* Quick add — the circular "+" every modern sports-retail grid uses.
            Sits on the photo so the text block below stays quiet. */}
        <button
          type="button"
          onClick={quickAdd}
          disabled={soldOut}
          // The label says what the tap will DO. On a garment that is "choose a
          // size", because that is where it goes — a button labelled "add" that
          // navigates is the kind of thing a screen-reader user cannot forgive.
          aria-label={
            soldOut
              ? `${t.spec.soldOut} — ${product.name[lang]}`
              : `${hasSizes === false ? t.shop.add : t.assistant.chooseSize} — ${product.name[lang]}`
          }
          className={`absolute bottom-2 end-2 flex h-11 w-11 items-center justify-center rounded-full shadow-md transition focus-visible:opacity-100 ${
            soldOut
              ? 'hidden'
              : added
                ? 'bg-emerald-500 text-white opacity-100'
                : 'bg-white/95 text-ink backdrop-blur hover:bg-brand hover:text-ink lg:translate-y-1 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100'
          }`}
        >
          {added ? <IconCheck size={18} /> : <IconPlus size={18} />}
        </button>
      </Link>

      <div className="flex flex-col gap-0.5 pt-3">
        <Link to={`/product/${product.slug}`} className="-my-1.5 py-1.5 transition group-hover:text-accent">
          <h3 className="line-clamp-1 text-sm font-semibold text-slate-900">{product.name[lang]}</h3>
        </Link>
        <p className="line-clamp-1 text-xs text-slate-600">{product.desc[lang]}</p>
        {/* `price` is always what the shop CHARGES — a live sale has already
            replaced it on the server. `list_price` is only ever the old,
            higher number to strike through, so a component that ignores both
            of these still shows the right money. */}
        <span className="price-card flex items-baseline gap-2 pt-0.5 text-sm font-bold tabular-nums">
          {formatKWD(product.price, lang)}
          {product.on_sale && (
            <>
              <s className="text-xs font-semibold text-slate-400">
                {formatKWD(product.list_price, lang)}
              </s>
              {/* The percentage is the thing a shopper actually reads, and
                  screen readers get the whole sentence rather than "-25%"
                  floating with no referent. */}
              <span className="sr-only">
                {formatKWD(product.list_price, lang)} → {formatKWD(product.price, lang)}
              </span>
            </>
          )}
        </span>
      </div>
    </article>
  )
}
