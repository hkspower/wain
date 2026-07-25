import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { useCart } from '../lib/cart'
import { formatKWD } from '../lib/format'
import { startCheckout } from '../lib/checkout'
import { usePageMeta } from '../lib/seo'

export default function Checkout() {
  const { lang, t } = useLang()
  const { items, total } = useCart()
  usePageMeta({ path: '/checkout', robots: 'noindex, follow' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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

  async function pay() {
    setBusy(true)
    setError('')
    try {
      await startCheckout({ items, total, lang, ref: 'Sporta order' })
      // On success the browser navigates to the CBK page.
    } catch (e) {
      setError(e?.message || 'Payment could not be started.')
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-8 text-3xl font-extrabold text-brand-dark">{t.cart.checkout}</h1>

      <div className="rounded-2xl border border-slate-100 bg-white p-6">
        <h2 className="mb-4 font-bold text-slate-800">{t.checkout.summary}</h2>
        <ul className="divide-y divide-slate-100">
          {items.map((i) => (
            <li key={i.slug} className="flex justify-between py-3 text-sm">
              <span className="text-slate-600">
                {i.name[lang]} × {i.qty}
              </span>
              <span className="font-semibold text-slate-800">{formatKWD(i.price * i.qty, lang)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-between border-t border-slate-200 pt-4 text-lg font-bold">
          <span>{t.cart.total}</span>
          <span className="text-brand">{formatKWD(total, lang)}</span>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

      <button
        onClick={pay}
        disabled={busy}
        className="mt-6 w-full rounded-full bg-brand py-3.5 font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
      >
        {busy ? t.checkout.redirecting : t.checkout.payNow}
      </button>
      <p className="mt-3 text-center text-xs text-slate-400">{t.checkout.securedBy}</p>
    </section>
  )
}
