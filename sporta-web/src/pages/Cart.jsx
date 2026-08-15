import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { optionLine } from '../lib/options'
import { canQuickCheckout, loadDelivery } from '../lib/delivery'
import { useCart } from '../lib/cart'
import { formatKWD } from '../lib/format'
import { IconPlus, IconMinus, IconClose } from '../components/icons'
import { usePageMeta } from '../lib/seo'
import CheckoutSteps from '../components/CheckoutSteps'

// A cart line keeps whatever the product had WHEN IT WAS ADDED, and the cart
// lives in localStorage — so a bag saved before a product had artwork, or
// before the placeholder fallback existed, still holds an empty image. The
// browser draws that as a broken-image glyph next to the price, which reads as
// a shop that has lost the item.
const LINE_ART =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">' +
    '<rect width="80" height="80" fill="%23E2DBCE"/></svg>',
  )

export default function Cart() {
  const { lang, t } = useLang()
  const { items, setQty, remove, total } = useCart()
  usePageMeta({ title: t.nav.cart, path: '/cart', robots: 'noindex, follow' })

  if (!items.length) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className="mb-3 text-3xl font-extrabold text-brand-dark">{t.cart.title}</h1>
        <p className="text-lg text-slate-600">{t.cart.empty}</p>
        <Link to="/shop" className="mt-4 inline-block rounded-full bg-brand px-6 py-2.5 font-semibold text-ink">
          {t.shop.backToShop}
        </Link>
      </div>
    )
  }

  // Read once per mount: localStorage does not change while this page is open.
  const quick = canQuickCheckout(loadDelivery())

  return (
    <section className="mx-auto max-w-4xl px-4 py-12">
      {/* Same indicator as /checkout, so the shopper sees the shape of the flow
          before committing to it rather than discovering it midway. */}
      <CheckoutSteps current="bag" />

      <h1 className="mt-5 mb-8 text-3xl font-extrabold text-slate-900">{t.cart.title}</h1>

      <div className="space-y-4">
        {items.map((i) => (
          // One row on a desktop, two on a phone. As a single flex line this
          // needed 488px — every phone in the range scrolled sideways, and the
          // price and remove button sat off the edge of the screen.
          <div key={i.key} className="grid grid-cols-[5rem_1fr] gap-x-4 gap-y-3 rounded-2xl border border-slate-100 bg-white p-4 sm:flex sm:items-center">
            <img src={i.image || LINE_ART} alt={i.name[lang]} width="80" height="80" className="h-20 w-20 rounded-lg object-cover" />
            <div className="min-w-0 self-center sm:flex-1">
              <h3 className="font-bold text-slate-800">{i.name[lang]}</h3>
              {/* The bag never showed which size was chosen — the one page
                  where a shopper checks before paying. Fit joins it. */}
              {optionLine(i, lang) && (
                <p className="text-sm font-semibold text-slate-700">{optionLine(i, lang)}</p>
              )}
              <p className="text-sm text-slate-500">{formatKWD(i.price, lang)}</p>
            </div>
            <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:contents">
              <div className="flex items-center rounded-full border border-slate-200">
                <button className="tap flex items-center justify-center px-3 text-slate-700 hover:text-brand" aria-label={t.a11y.decrease} onClick={() => setQty(i.key, i.qty - 1)}><IconMinus size={15} /></button>
                <span className="w-8 text-center font-semibold tabular-nums">{i.qty}</span>
                <button className="tap flex items-center justify-center px-3 text-slate-700 hover:text-brand" aria-label={t.a11y.increase} onClick={() => setQty(i.key, i.qty + 1)}><IconPlus size={15} /></button>
              </div>
              <div className="text-accent whitespace-nowrap font-bold tabular-nums sm:w-24 sm:text-end">{formatKWD(i.price * i.qty, lang)}</div>
              <button onClick={() => remove(i.key)} className="tap flex items-center justify-center text-slate-400 hover:text-rose-500" aria-label={t.a11y.remove}><IconClose size={16} /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-col items-stretch gap-4 sm:items-end">
        <div className="text-end text-xl font-bold text-slate-800">
          {t.cart.total}: <span className="text-accent tabular-nums">{formatKWD(total, lang)}</span>
        </div>
        {/* Named for what it will actually do. /checkout opens collapsed when
            the saved details are complete, and a button that says "Checkout"
            and then asks for nothing is a pleasant surprise nobody planned
            for — saying so up front is what makes it a reason to come back. */}
        <Link to="/checkout" className="btn btn-primary w-full sm:w-auto sm:px-8">
          {quick ? t.quick.cta : t.cart.checkout}
        </Link>
        {quick && <p className="text-end text-xs text-slate-600">{t.quick.ctaHint}</p>}
      </div>
    </section>
  )
}
