import { useRef } from 'react'
import { useDialog } from '../lib/useDialog'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { useCart } from '../lib/cart'
import { formatKWD } from '../lib/format'
import { IconClose, IconPlus, IconMinus, IconBag, IconLock } from './icons'

// Slide-in bag. Lets shoppers review/edit and reach checkout without leaving
// the page they're browsing — removes a full navigation from the funnel.
export default function CartDrawer({ open, onClose }) {
  const { lang, t } = useLang()
  const { items, setQty, remove, total } = useCart()

  // inert when closed, focus trapped when open, focus restored to the bag
  // button on close. See lib/useDialog.js — this drawer is the reason it exists:
  // it stays mounted to slide, so its buttons were live tab stops 44 and 45 of
  // 46 on the homepage while it was invisible.
  const panel = useRef(null)
  useDialog({ open, onClose, containerRef: panel })

  // Rendered into <body>, not in place.
  //
  // CartDrawer is mounted inside <header>, and the header carries a
  // backdrop-blur. A backdrop-filter makes an element the containing block for
  // its position:fixed descendants, so "fixed inset-y-0" resolved against the
  // 127px-tall header instead of the viewport. Two bugs followed:
  //   - the drawer collapsed to header height (the `height:100dvh` rule in
  //     index.css was a patch over this symptom);
  //   - closed, it sat one width outside the header's box and counted as page
  //     overflow. In RTL that is the left side, which pushed the entire Arabic
  //     page 448px right and left a beige band down every page.
  // A portal moves it out from under the blur, where `fixed` means what it
  // says and an off-canvas element contributes no document overflow.
  return createPortal(
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
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t.cart.title}
        className={`cart-drawer fixed inset-y-0 end-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'pointer-events-none translate-x-full rtl:-translate-x-full'
        }`}
      >
        <header className="flex items-center justify-between border-b border-black/10 px-6 py-5 pt-[calc(1.25rem+var(--sa-top))]">
          <h2 className="text-xl font-extrabold text-slate-900">{t.cart.title}</h2>
          <button onClick={onClose} aria-label={t.a11y.close} className="tap flex items-center justify-center text-slate-400 hover:text-slate-700">
            <IconClose size={22} />
          </button>
        </header>

        {items.length === 0 ? (
          /* Empty state */
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <IconBag size={56} stroke={1.25} className="text-slate-300" />
            <p className="text-slate-500">{t.cart.empty}</p>
            <Link to="/shop" onClick={onClose} className="btn btn-primary">
              {t.shop.backToShop}
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-black/5 overflow-y-auto px-6">
              {items.map((i) => (
                <li key={i.key} className="flex gap-4 py-4">
                  <img src={i.image} alt={i.name[lang]} width="72" height="72" className="h-18 w-18 rounded-xl object-cover" />
                  <div className="flex-1">
                    <p className="font-bold text-slate-900">{i.name[lang]}</p>
                    <p className="mt-0.5 text-sm text-slate-500 tabular-nums">{formatKWD(i.price, lang)}{i.size ? ` · ${i.size}` : ''}</p>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex items-center rounded-full border border-black/15 text-slate-900">
                        <button className="px-3 py-1 text-base font-bold leading-none text-slate-700 hover:text-brand" aria-label={t.a11y.decrease} onClick={() => setQty(i.key, i.qty - 1)}><IconMinus size={15} /></button>
                        <span className="w-7 text-center text-sm font-bold tabular-nums text-slate-900">{i.qty}</span>
                        <button className="px-3 py-1 text-base font-bold leading-none text-slate-700 hover:text-brand" aria-label={t.a11y.increase} onClick={() => setQty(i.key, i.qty + 1)}><IconPlus size={15} /></button>
                      </div>
                      <button onClick={() => remove(i.key)} aria-label={t.a11y.remove} className="text-slate-400 hover:text-rose-600">
                        <IconClose size={15} />
                      </button>
                    </div>
                  </div>
                  <span className="font-extrabold text-brand-dark tabular-nums">{formatKWD(i.price * i.qty, lang)}</span>
                </li>
              ))}
            </ul>

            <footer className="pb-[calc(1rem+var(--sa-bottom))] border-t border-black/10 px-6 py-5">
              <div className="flex items-center justify-between text-lg font-extrabold">
                <span>{t.cart.total}</span>
                <span className="text-brand-dark tabular-nums">{formatKWD(total, lang)}</span>
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500"><IconLock size={13} /> {t.trust.pay}</p>
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
    </>,
    document.body,
  )
}
