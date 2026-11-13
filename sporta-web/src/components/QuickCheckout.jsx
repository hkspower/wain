import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import PaymentMethods from './PaymentMethods'
import { addressLines } from '../lib/delivery'
import { optionLine } from '../lib/options'
import { formatKWD } from '../lib/format'
import { LINE_ART, photoFit } from '../lib/productImage'
import { IconTruck, IconLock } from './icons'

// QUICK CHECKOUT — the whole order on one screen, for a shopper who has bought
// here before.
//
// The full form is nine fields and, on a phone, three screens of scrolling. For
// a returning customer every one of those fields already has the right answer
// in it, and asking again is asking them to re-read their own address looking
// for a mistake that is not there. This shows the address, the bag and the
// method, and one button.
//
// It is NOT a different checkout. Same validation, same create_order, same
// server-side pricing — it is the same form with nothing left to fill in. The
// gate is canQuickCheckout(): if a single required field is missing the shopper
// sees the form instead, because something in it genuinely needs them.
//
// EDIT IS ALWAYS ONE TAP AWAY, and it is prominent rather than tucked away. The
// failure mode of express checkout is delivering to the address someone moved
// out of, and the defence is showing the address rather than a saved-card-style
// "use my details".
export default function QuickCheckout({
  form,
  items,
  total,
  money,
  applied,
  method,
  onMethod,
  onEdit,
  onSubmit,
  busy,
  error,
}) {
  const { lang, t } = useLang()
  const lines = addressLines(form, lang, t)
  const count = items.reduce((n, i) => n + i.qty, 0)

  return (
    <form onSubmit={onSubmit} aria-busy={busy} className="mx-auto max-w-2xl space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
        >
          {error}
        </p>
      )}

      {/* WHERE IT IS GOING — first, and in full. */}
      <section className="rounded-2xl border border-slate-100 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <IconTruck size={17} className="text-brand" />
            {t.quick.deliverTo}
          </h2>
          <button
            type="button"
            onClick={onEdit}
            className="text-accent -my-2 py-2 text-xs font-semibold underline underline-offset-2"
          >
            {t.quick.edit}
          </button>
        </div>
        <p className="mt-3 font-bold text-slate-900">{form.name}</p>
        {/* dir=ltr on the number: a phone number is an LTR run, and in Arabic
            the leading + is bidi-neutral and gets reordered to the far side,
            rendering "+965 99887766" as "96599887766+". */}
        <p className="text-sm font-semibold tabular-nums text-slate-700" dir="ltr">
          +965 {form.phone}
        </p>
        {lines.map((l) => (
          <p key={l} className="mt-1 text-sm text-slate-600">{l}</p>
        ))}
        {form.note && <p className="mt-2 text-sm italic text-slate-600">“{form.note}”</p>}
      </section>

      {/* WHAT IS IN IT — every line, with its size and fit. A collapsed
          checkout that hides the bag is how someone pays for the wrong size. */}
      <section className="rounded-2xl border border-slate-100 bg-white p-5">
        <h2 className="flex items-baseline justify-between text-sm font-bold text-slate-800">
          {t.checkout.summary}
          <Link
            to="/cart"
            className="text-accent text-xs font-semibold underline underline-offset-2"
          >
            {t.quick.editBag}
          </Link>
        </h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-3 py-3">
              <img
                src={i.image || LINE_ART}
                alt=""
                width="48"
                height="48"
                loading="lazy"
                decoding="async"
                className={`h-12 w-12 shrink-0 rounded-lg bg-sand-light ${photoFit(i.image)}`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800">{i.name[lang]}</p>
                <p className="text-sm text-slate-600">
                  {optionLine(i, lang)}
                  {i.qty > 1 ? `${optionLine(i, lang) ? ' · ' : ''}× ${i.qty}` : ''}
                </p>
              </div>
              <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-slate-800">
                {formatKWD(i.price * i.qty, lang)}
              </span>
            </li>
          ))}
        </ul>
        {/* The same figures the full form shows, from the SERVER's quote. Until the quote arrives the bag's own sum is
            the only thing known, so it is labelled as a subtotal and no total is claimed. */}
        {money ? (
          <>
            {applied?.applied?.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-slate-200 pt-3 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>{t.cart.subtotal}</span>
                  <span className="tabular-nums">{formatKWD(applied.subtotal, lang)}</span>
                </div>
                {applied.applied.map((a, i) => (
                  <div key={i} className="flex justify-between font-semibold text-emerald-700">
                    <span>{a.label}</span>
                    <span className="tabular-nums">−{formatKWD(a.amount, lang)}</span>
                  </div>
                ))}
              </div>
            )}
            {money.delivery > 0 && (
              <div className="mt-2 flex justify-between text-sm text-slate-600">
                <span>{t.cart.delivery}</span>
                <span className="tabular-nums">{formatKWD(money.delivery, lang)}</span>
              </div>
            )}
            <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-lg font-bold">
              <span>
                {t.cart.total}{' '}
                <span className="text-sm font-medium text-slate-600">{t.checkout.itemsCount(count)}</span>
              </span>
              <span className="text-accent tabular-nums">{formatKWD(money.total, lang)}</span>
            </div>
          </>
        ) : (
          <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-sm text-slate-600">
            <span>
              {t.cart.subtotal}{' '}
              <span className="text-sm font-medium">{t.checkout.itemsCount(count)}</span>
            </span>
            <span className="tabular-nums">{formatKWD(total, lang)}</span>
          </div>
        )}
      </section>

      {/* HOW IT IS PAID — radios, not a dropdown: the difference between paying
          now on the bank's page and paying the driver is the whole decision, and
          it must be readable without a tap. */}
      <PaymentMethods
        value={method}
        onChange={onMethod}
        className="rounded-2xl border border-slate-100 bg-white p-5"
        legendClassName="px-1 text-sm font-bold text-slate-800"
      />

      <button type="submit" disabled={busy} className="btn btn-primary w-full">
        {busy ? t.checkout.redirecting : method === 'cod' ? t.checkout.placeOrder : t.checkout.payNow}
      </button>
      <p className="flex items-center justify-center gap-1.5 text-center text-sm text-slate-600">
        <IconLock size={13} className="text-brand" />
        {method === 'cod' ? t.checkout.codNote : t.checkout.securedBy}
      </p>
    </form>
  )
}
