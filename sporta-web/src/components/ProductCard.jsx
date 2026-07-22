import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { useCart } from '../lib/cart'
import { formatKWD } from '../lib/format'

export default function ProductCard({ product }) {
  const { lang, t } = useLang()
  const { add } = useCart()
  return (
    <div className="group overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition hover:shadow-md">
      <Link to={`/product/${product.slug}`} className="block">
        <div className="relative aspect-square overflow-hidden bg-slate-50">
          <img
            src={product.image}
            alt={product.name[lang]}
            loading="lazy"
            width="600"
            height="600"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
          {product.badge && (
            <span className="absolute start-3 top-3 rounded-full bg-brand px-2 py-1 text-xs font-semibold text-white">
              {product.badge[lang]}
            </span>
          )}
        </div>
      </Link>
      <div className="p-4">
        <Link to={`/product/${product.slug}`}>
          <h3 className="line-clamp-1 font-bold text-slate-800 hover:text-brand">{product.name[lang]}</h3>
        </Link>
        <p className="mt-1 line-clamp-1 text-sm text-slate-500">{product.desc[lang]}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="font-bold text-brand-dark">{formatKWD(product.price, lang)}</span>
          <button
            onClick={() => add(product)}
            className="rounded-full bg-brand px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
          >
            {t.shop.add}
          </button>
        </div>
      </div>
    </div>
  )
}
