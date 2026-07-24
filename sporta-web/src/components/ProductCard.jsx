import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { useCart } from '../lib/cart'
import { formatKWD } from '../lib/format'

export default function ProductCard({ product }) {
  const { lang, t } = useLang()
  const { add } = useCart()
  const [added, setAdded] = useState(false)

  function quickAdd(e) {
    e.preventDefault()
    add(product)
    setAdded(true)
    setTimeout(() => setAdded(false), 1200)
  }

  return (
    <article className="card card-hover group flex flex-col overflow-hidden">
      <Link
        to={`/product/${product.slug}`}
        className="relative block aspect-square overflow-hidden bg-slate-100"
        aria-label={product.name[lang]}
      >
        <img
          src={product.image}
          alt={product.name[lang]}
          loading="lazy"
          width="600"
          height="600"
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
        {product.badge && (
          <span className="absolute start-3 top-3 rounded-full bg-brand px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow">
            {product.badge[lang]}
          </span>
        )}
        {/* Wishlist */}
        <button
          type="button"
          onClick={(e) => e.preventDefault()}
          aria-label="Add to wishlist"
          className="absolute end-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-500 opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100 hover:text-brand"
        >
          ♡
        </button>
      </Link>

      <div className="flex flex-1 flex-col p-4">
        <Link to={`/product/${product.slug}`}>
          <h3 className="line-clamp-1 font-bold text-slate-900 transition group-hover:text-brand">
            {product.name[lang]}
          </h3>
        </Link>
        <p className="mt-1 line-clamp-1 text-sm text-slate-500">{product.desc[lang]}</p>

        <div className="mt-1 flex items-center gap-1 text-xs text-amber-500" aria-hidden>
          ★★★★★ <span className="text-slate-400">(4.8)</span>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-lg font-extrabold text-brand-dark">{formatKWD(product.price, lang)}</span>
          <button
            onClick={quickAdd}
            className={`btn btn-sm ${added ? 'btn-ghost text-emerald-600' : 'btn-primary'}`}
            aria-label={`${t.shop.add} — ${product.name[lang]}`}
          >
            {added ? '✓' : t.shop.add}
          </button>
        </div>
      </div>
    </article>
  )
}
