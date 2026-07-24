import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { getProduct } from '../lib/products'
import { useCart } from '../lib/cart'
import { formatKWD } from '../lib/format'
import { usePageMeta, productJsonLd } from '../lib/seo'

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

          <div className="mt-6 flex items-center gap-4">
            <div className="flex items-center rounded-full border border-slate-200">
              <button className="px-4 py-2 text-lg" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <span className="w-10 text-center font-semibold">{qty}</span>
              <button className="px-4 py-2 text-lg" onClick={() => setQty((q) => q + 1)}>+</button>
            </div>
            <button
              onClick={() => add(product, qty)}
              className="rounded-full bg-brand px-6 py-2.5 font-semibold text-white transition hover:bg-brand-dark"
            >
              {t.shop.add}
            </button>
            <button
              onClick={() => {
                add(product, qty)
                navigate('/cart')
              }}
              className="rounded-full border border-brand px-6 py-2.5 font-semibold text-brand transition hover:bg-brand-light"
            >
              {t.shop.buyNow}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
