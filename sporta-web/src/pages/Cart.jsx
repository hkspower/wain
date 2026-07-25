import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { useCart } from '../lib/cart'
import { formatKWD } from '../lib/format'
import { IconPlus, IconMinus, IconClose } from '../components/icons'

export default function Cart() {
  const { lang, t } = useLang()
  const { items, setQty, remove, total } = useCart()

  if (!items.length) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <p className="text-lg text-slate-500">{t.cart.empty}</p>
        <Link to="/shop" className="mt-4 inline-block rounded-full bg-brand px-6 py-2.5 font-semibold text-white">
          {t.shop.backToShop}
        </Link>
      </div>
    )
  }

  return (
    <section className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="mb-8 text-3xl font-extrabold text-brand-dark">{t.cart.title}</h1>

      <div className="space-y-4">
        {items.map((i) => (
          <div key={i.key} className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4">
            <img src={i.image} alt={i.name[lang]} width="80" height="80" className="h-20 w-20 rounded-lg object-cover" />
            <div className="flex-1">
              <h3 className="font-bold text-slate-800">{i.name[lang]}</h3>
              <p className="text-sm text-slate-500">{formatKWD(i.price, lang)}</p>
            </div>
            <div className="flex items-center rounded-full border border-slate-200">
              <button className="px-3 py-2 text-slate-700 hover:text-brand" aria-label="Decrease quantity" onClick={() => setQty(i.key, i.qty - 1)}><IconMinus size={15} /></button>
              <span className="w-8 text-center font-semibold">{i.qty}</span>
              <button className="px-3 py-2 text-slate-700 hover:text-brand" aria-label="Increase quantity" onClick={() => setQty(i.key, i.qty + 1)}><IconPlus size={15} /></button>
            </div>
            <div className="w-24 text-end font-bold text-brand-dark">{formatKWD(i.price * i.qty, lang)}</div>
            <button onClick={() => remove(i.key)} className="text-slate-400 hover:text-rose-500" aria-label="Remove"><IconClose size={16} /></button>
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-col items-end gap-4">
        <div className="text-xl font-bold text-slate-800">
          {t.cart.total}: <span className="text-brand">{formatKWD(total, lang)}</span>
        </div>
        <Link to="/checkout" className="rounded-full bg-brand px-8 py-3 font-semibold text-white transition hover:bg-brand-dark">
          {t.cart.checkout}
        </Link>
      </div>
    </section>
  )
}
