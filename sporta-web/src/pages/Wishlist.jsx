import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { useWishlist } from '../lib/wishlist'
import { PRODUCTS } from '../lib/products'
import ProductCard from '../components/ProductCard'
import { usePageMeta } from '../lib/seo'
import { IconHeart } from '../components/icons'

export default function Wishlist() {
  const { t } = useLang()
  const { slugs } = useWishlist()
  usePageMeta({ title: t.wish.title, path: '/wishlist', robots: 'noindex, follow' })
  const items = PRODUCTS.filter((p) => slugs.includes(p.slug))

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 md:px-6">
      <h1 className="mb-8 text-3xl font-extrabold text-slate-900">{t.wish.title}</h1>
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <IconHeart size={56} stroke={1.25} className="text-slate-300" />
          <p className="text-slate-500">{t.wish.empty}</p>
          <Link to="/shop" className="btn btn-primary">{t.shop.backToShop}</Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {items.map((p) => <ProductCard key={p.slug} product={p} />)}
        </div>
      )}
    </section>
  )
}
