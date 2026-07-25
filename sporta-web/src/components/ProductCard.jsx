import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { useCart } from '../lib/cart'
import { useWishlist } from '../lib/wishlist'
import { IconHeart, IconCheck, IconPlus } from './icons'
import { formatKWD } from '../lib/format'

// Modern retail grid card (Gymshark-style): the photo IS the card — portrait
// 4:5, no border, no shadow, no white box. Everything interactive lives as an
// overlay on the image; below it just name, description and price on the page
// canvas. Ratings are deliberately gone from the grid: they were a hardcoded
// 4.8 on every product, and a grid that praises itself 20 times reads as fake.
export default function ProductCard({ product }) {
  const { lang, t } = useLang()
  const { add } = useCart()
  const { has, toggle } = useWishlist()
  const [added, setAdded] = useState(false)

  function quickAdd(e) {
    e.preventDefault()
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
          width="600"
          height="600"
          className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
        />

        {product.badge && (
          <span className="absolute start-2.5 top-2.5 rounded-md bg-brand px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
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
          aria-label={`${t.shop.add} — ${product.name[lang]}`}
          className={`absolute bottom-2 end-2 flex h-11 w-11 items-center justify-center rounded-full shadow-md transition focus-visible:opacity-100 ${
            added
              ? 'bg-emerald-500 text-white opacity-100'
              : 'bg-white/95 text-ink backdrop-blur hover:bg-brand hover:text-white lg:translate-y-1 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100'
          }`}
        >
          {added ? <IconCheck size={18} /> : <IconPlus size={18} />}
        </button>
      </Link>

      <div className="flex flex-col gap-0.5 pt-3">
        <Link to={`/product/${product.slug}`} className="-my-1.5 py-1.5 transition group-hover:text-brand">
          <h3 className="line-clamp-1 text-sm font-semibold text-slate-900">{product.name[lang]}</h3>
        </Link>
        <p className="line-clamp-1 text-xs text-slate-500">{product.desc[lang]}</p>
        <span className="price-card pt-0.5 text-sm font-bold tabular-nums">
          {formatKWD(product.price, lang)}
        </span>
      </div>
    </article>
  )
}
