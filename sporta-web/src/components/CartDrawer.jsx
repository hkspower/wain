import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { useCart } from '../lib/cart'
import { formatKWD } from '../lib/format'

// Slide-in bag. Lets shoppers review/edit and reach checkout without leaving
// the page they're browsing — removes a full navigation from the funnel.
export default function CartDrawer({ open, onClose }) {
  const { lang, t } = useLang()
  const { items, setQty, remove, total } = useCart()

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-ink/60 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t.cart.title}
        className={`fixed inset-y-0 end-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'pointer-events-none translate-x-full rtl:-translate-x-full'
        }`}
        style={{ backgroundColor: '#fff', height: '100vh' }}
      >
        <header className="flex items-center justify-between border-b border-black/10 px-6 py-5">
          <h2 className="text-xl font-extrabold text-slate-900">{t.cart.title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-2xl leading-none text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </header>

        {items.length === 0 ? (
          /* Empty state */
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <span className="text-5xl" aria-hidden>🛍️</span>
            <p className="text-slate-500">{t.cart.empty}</p>
            <Link to="/shop" onClick={onClose} className="btn btn-primary">
              {t.shop.backToShop}
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-black/5 overflow-y-auto px-6">
              {items.map((i) => (
                <li key={i.slug} className="flex gap-4 py-4">
                  <img src={i.image} alt="" width="72" height="72" className="h-18 w-18 rounded-xl object-cover" />
                  <div className="flex-1">
                    <p className="font-bold text-slate-900">{i.name[lang]}</p>
                    <p className="mt-0.5 text-sm text-slate-500 tabular-nums">{formatKWD(i.price, lang)}</p>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex items-center rounded-full border border-black/15 text-slate-900">
                        <button className="px-3 py-1 text-base font-bold leading-none text-slate-700 hover:text-brand" aria-label="Decrease quantity" onClick={() => setQty(i.slug, i.qty - 1)}>&minus;</button>
                        <span className="w-7 text-center text-sm font-bold tabular-nums text-slate-900">{i.qty}</span>
                        <button className="px-3 py-1 text-base font-bold leading-none text-slate-700 hover:text-brand" aria-label="Increase quantity" onClick={() => setQty(i.slug, i.qty + 1)}>+</button>
                      </div>
                      <button onClick={() => remove(i.slug)} className="text-xs font-semibold text-slate-400 hover:text-rose-600">
                        ✕
                      </button>
                    </div>
                  </div>
                  <span className="font-extrabold text-brand-dark tabular-nums">{formatKWD(i.price * i.qty, lang)}</span>
                </li>
              ))}
            </ul>

            <footer className="border-t border-black/10 px-6 py-5">
              <div className="flex items-center justify-between text-lg font-extrabold">
                <span>{t.cart.total}</span>
                <span className="text-brand-dark tabular-nums">{formatKWD(total, lang)}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{t.trust.pay}</p>
              <Link to="/checkout" onClick={onClose} className="btn btn-primary mt-4 w-full">
                {t.cart.checkout}
              </Link>
              <Link
                to="/shop"
                onClick={onClose}
                className="mt-2 block text-center text-sm font-semibold text-slate-500 hover:text-brand"
              >
                {t.shop.backToShop}
              </Link>
            </footer>
          </>
        )}
      </aside>
    </>
  )
}
