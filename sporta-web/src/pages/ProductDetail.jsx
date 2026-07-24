import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { getProduct, PRODUCTS } from '../lib/products'
import { useCart } from '../lib/cart'
import { formatKWD } from '../lib/format'
import { usePageMeta, productJsonLd } from '../lib/seo'
import ProductCard from '../components/ProductCard'

export default function ProductDetail() {
  const { slug } = useParams()
  const { lang, t } = useLang()
  const { add } = useCart()
  const navigate = useNavigate()
  const [qty, setQty] = useState(1)
  const product = getProduct(slug)

  usePageMeta(
    product
      ? {
          title: product.name[lang],
          description: product.desc[lang],
          path: `/product/${product.slug}`,
          jsonLd: productJsonLd(product, lang),
        }
      : { title: t.shop.notFound, path: '/shop' },
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
          <img
            src={product.image}
            alt={product.name[lang]}
            width="600"
            height="600"
            className="h-full w-full object-cover"
          />
        </div>
        <div>
          <h1 className="text-3xl font-extrabold text-brand-dark">{product.name[lang]}</h1>
          <p className="mt-3 text-lg text-slate-600">{product.desc[lang]}</p>
          <p className="mt-6 text-2xl font-bold text-brand">{formatKWD(product.price, lang)}</p>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <div className="flex items-center rounded-full border border-slate-300 bg-white">
              <button className="px-4 py-2 text-lg" aria-label="−" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <span className="w-10 text-center font-semibold" aria-live="polite">{qty}</span>
              <button className="px-4 py-2 text-lg" aria-label="+" onClick={() => setQty((q) => q + 1)}>+</button>
            </div>
            <button onClick={() => add(product, qty)} className="btn btn-primary">
              {t.shop.add}
            </button>
            <button
              onClick={() => {
                add(product, qty)
                navigate('/checkout')
              }}
              className="btn btn-ghost text-brand"
            >
              {t.shop.buyNow}
            </button>
          </div>

          {/* Trust signals */}
          <ul className="mt-8 space-y-2 rounded-2xl bg-white p-5 text-sm text-slate-600">
            <li className="flex items-center gap-3">🚚 {t.trust.delivery}</li>
            <li className="flex items-center gap-3">🔒 {t.trust.pay}</li>
            <li className="flex items-center gap-3">↺ {t.trust.returns}</li>
          </ul>
        </div>
      </div>

      {/* Cross-sell — complete the look */}
      <div className="mt-16">
        <h2 className="mb-6 text-2xl font-extrabold text-slate-900">{t.cross.title}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {PRODUCTS.filter((p) => p.slug !== product.slug).slice(0, 4).map((p) => (
            <ProductCard key={p.slug} product={p} />
          ))}
        </div>
      </div>

      {/* Sticky mobile buy bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-black/10 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
        <span className="text-lg font-extrabold text-brand-dark">{formatKWD(product.price * qty, lang)}</span>
        <button
          onClick={() => {
            add(product, qty)
            navigate('/checkout')
          }}
          className="btn btn-primary flex-1"
        >
          {t.shop.buyNow}
        </button>
      </div>
      <div className="h-16 md:hidden" aria-hidden />
    </section>
  )
}
