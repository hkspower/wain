import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { optionLine } from '../lib/options'
import { useCart } from '../lib/cart'
import { formatKWD } from '../lib/format'
import { startCheckout } from '../lib/checkout'
import { usePageMeta } from '../lib/seo'
import { GOVERNORATES, governorate, governorateOfArea, normalisePhone, toAsciiDigits } from '../lib/kuwait'
import CheckoutSteps from '../components/CheckoutSteps'

const BLANK = {
  name: '', phone: '', governorate: '', area: '',
  block: '', street: '', building: '', floor: '', flat: '', note: '',
}
// Fields where anything but a digit is a mistake, stripped as they type. Block,
// floor and flat are numbers in the Kuwaiti addressing scheme; street can be a
// name, and building can carry a letter, so neither is listed.
const DIGITS_ONLY = new Set(['block', 'floor', 'flat'])

// The phone is stripped too, but it cannot simply be truncated: the field shows
// a fixed +965 and holds the eight national digits, while people paste
// "+965 9988 7766" or "0096599887766" from their contacts. Dropping the country
// code BEFORE the length cap is the difference between 99887766 and 96599887 —
// and 96599887 is a number the driver dials and nobody answers.
//
// This is also why maxLength on the input is generous rather than 8: browsers
// truncate an over-long paste before onChange ever sees it, so a tight cap would
// destroy the country code's digits instead of letting this remove them.
function cleanPhone(raw) {
  let d = toAsciiDigits(raw).replace(/\D/g, '')
  if (d.startsWith('00965')) d = d.slice(5)
  else if (d.length > 8 && d.startsWith('965')) d = d.slice(3)
  return d.slice(0, 8)
}

const STORE_KEY = 'sporta.delivery'
// The opt-out is stored separately from the details themselves. Deriving it
// from "are there saved details?" meant it defaulted to off for every
// first-time shopper, so nothing was ever saved and the feature could never
// switch itself on; and unticking it erased the details, losing the choice
// along with them. An explicit '0' is a decision worth keeping.
const REMEMBER_KEY = 'sporta.delivery.remember'

// The same rules create_order enforces. Repeated here only so the shopper is
// told immediately instead of after a round trip — the copy that actually
// protects the order is the one in checkout-migration.sql, because a browser
// can be bypassed and the database cannot.
function validate(f) {
  const e = {}
  if (f.name.trim().length < 2) e.name = 'missing_name'
  if (!normalisePhone(f.phone)) e.phone = 'invalid_phone'
  if (!governorate(f.governorate)) e.governorate = 'invalid_governorate'
  if (f.area.trim().length < 2) e.area = 'missing_area'
  if (!f.block.trim()) e.block = 'missing_block'
  if (!f.street.trim()) e.street = 'missing_street'
  if (!f.building.trim()) e.building = 'missing_building'
  return e
}

export default function Checkout() {
  const { lang, t } = useLang()
  const { items, total } = useCart()
  usePageMeta({ path: '/checkout', robots: 'noindex, follow' })

  const [form, setForm] = useState(() => {
    try {
      return { ...BLANK, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }
    } catch {
      return BLANK
    }
  })
  const [remember, setRemember] = useState(() => localStorage.getItem(REMEMBER_KEY) !== '0')
  const [errors, setErrors] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [method, setMethod] = useState('knet')
  const [formError, setFormError] = useState('')

  const gov = governorate(form.governorate)
  const set = (k) => (ev) => {
    const raw = ev.target.value
    // Digits only where only digits are meaningful. Doing it here rather than
    // with a pattern means a pasted "+965 9988 7766" or "Block 4" becomes
    // something the driver can use instead of a validation error.
    // toAsciiDigits first, in every numeric field: an Arabic keyboard types
    // ٤ for four, and stripping it as a non-digit meant the field could not be
    // filled in at all by half the shop's customers.
    const v =
      k === 'phone' ? cleanPhone(raw)
      : DIGITS_ONLY.has(k) ? toAsciiDigits(raw).replace(/[^\d]/g, '')
      : raw
    setForm((f) => {
      const next = { ...f, [k]: v }
      // Changing governorate clears the area: the suggestions belong to the
      // governorate, and a stale area is an undeliverable address.
      if (k === 'governorate') next.area = ''
      // The other direction. A browser autofilling a saved address writes the
      // fields it recognises in its own order, and it knows "Salmiya" without
      // knowing which governorate that is — so an area that names exactly one
      // governorate fills it in. Also spares anyone who types the area first.
      if (k === 'area' && !next.governorate) {
        const g = governorateOfArea(v)
        if (g) next.governorate = g.id
      }
      return next
    })
    // Only re-validate live once they have tried to submit. Validating while
    // someone is still typing their first field is nagging, not helping.
    if (submitted) setErrors((e) => ({ ...e, [k]: validate({ ...form, [k]: v })[k] }))
  }

  const summary = useMemo(() => items.map((i) => ({ ...i, line: i.price * i.qty })), [items])

  if (!items.length) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <p className="text-lg text-slate-600">{t.cart.empty}</p>
        <Link to="/shop" className="btn btn-primary mt-4 inline-flex">
          {t.shop.backToShop}
        </Link>
      </div>
    )
  }

  // Turn a token from create_order into something a shopper can act on. An
  // 'unavailable_<slug>' names the product, because "an item is unavailable"
  // is useless when there are eight things in the bag.
  function messageFor(token) {
    if (token.startsWith('unavailable_')) {
      const item = items.find((i) => i.slug === token.slice('unavailable_'.length))
      return `${t.checkout.err.unavailable}${item ? ` — ${item.name[lang]}` : ''}`
    }
    if (token.startsWith('too_long_')) return t.checkout.err.tooLong
    return t.checkout.err[token] ?? t.checkout.err.failed
  }

  async function submit(ev) {
    ev.preventDefault()
    setSubmitted(true)
    setFormError('')
    const e = validate(form)
    setErrors(e)
    if (Object.keys(e).length) {
      setFormError(t.checkout.fixErrors)
      document.getElementById(`f-${Object.keys(e)[0]}`)?.focus()
      return
    }

    localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0')
    if (remember) localStorage.setItem(STORE_KEY, JSON.stringify(form))
    else localStorage.removeItem(STORE_KEY)

    setBusy(true)
    try {
      await startCheckout({ items, lang, paymentMethod: method,
        customer: { ...form, phone: normalisePhone(form.phone) } })
      // On success the browser is already navigating to the bank.
    } catch (error) {
      const token = error?.token ?? 'failed'
      setFormError(messageFor(token))
      // A token that names a field sends the shopper straight back to it.
      const field = token.replace(/^(missing|too_long|invalid)_/, '')
      if (field in BLANK) {
        setErrors((prev) => ({ ...prev, [field]: token }))
        document.getElementById(`f-${field}`)?.focus()
      }
      setBusy(false)
    }
  }

  const err = (k) => (errors[k] ? messageFor(errors[k]) : null)

  return (
    <section className="mx-auto max-w-6xl px-4 py-10 md:py-14">
      <CheckoutSteps current="details" paying={busy} />

      <h1 className="mt-5 mb-2 text-3xl font-extrabold text-brand-dark">{t.cart.checkout}</h1>
      <p className="mb-5 text-sm text-slate-500">{t.checkout.deliveryHint}</p>

      {/* Guest checkout, said out loud. There is no customer account anywhere on
          this site and never has been — but a shopper cannot know that, and
          "will I have to register?" is answered by abandoning the cart. It also
          states the consequence honestly: no email is collected, so the order
          number is the only handle they get. */}
      <div className="mb-8 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
        {/* Stacked on a phone. As one flex row the short heading held its
            intrinsic width and squeezed the sentence into a five-word-per-line
            column — see it once and the reason for the breakpoint is obvious. */}
        <p className="text-sm font-bold text-emerald-900">{t.guest.title}</p>
        <p className="mt-1 text-sm leading-snug text-emerald-800">
          {t.guest.body}{' '}
          <Link to="/track" className="whitespace-nowrap font-semibold text-emerald-900 underline underline-offset-2">
            {t.guest.track}
          </Link>
        </p>
      </div>

      <form onSubmit={submit} noValidate className="grid gap-8 lg:grid-cols-[1fr_23rem]">
        <div className="space-y-6">
          {/* role="alert" is announced without taking focus, so focus can go
              where it is actually useful: the first field that needs fixing. */}
          {formError && (
            <p
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
            >
              {formError}
            </p>
          )}

          <fieldset className="rounded-2xl border border-slate-100 bg-white p-5 md:p-6">
            <legend className="px-1 text-sm font-bold text-slate-800">{t.checkout.contact}</legend>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field id="name" label={t.checkout.name} error={err('name')} className="sm:col-span-2">
                <input
                  id="f-name" name="name" value={form.name} onChange={set('name')}
                  autoComplete="name" autoCapitalize="words" enterKeyHint="next"
                  placeholder={t.checkout.namePh} maxLength={80}
                  aria-invalid={!!errors.name} aria-describedby={errors.name ? 'e-name' : undefined}
                  className={input(errors.name)}
                />
              </Field>

              <Field
                id="phone" label={t.checkout.phone} hint={t.checkout.phoneHint}
                error={err('phone')} className="sm:col-span-2"
              >
                {/* The +965 prefix is fixed rather than typed. It is the only
                    country Sporta delivers to, and free-typed country codes are
                    the main source of numbers the driver cannot reach. */}
                {/* dir="ltr" on both halves: a phone number is an LTR run. In
                    Arabic the leading "+" is a bidi-neutral character, so it was
                    being reordered to the far side and rendering as "965+". */}
                <div className={`flex items-stretch overflow-hidden p-0 ${input(errors.phone)}`} dir="ltr">
                  <span className="grid place-items-center bg-slate-50 px-3 text-sm font-semibold tabular-nums text-slate-500">
                    +965
                  </span>
                  <input
                    id="f-phone" name="tel" value={form.phone} onChange={set('phone')}
                    type="tel" inputMode="numeric" pattern="[0-9]*"
                    autoComplete="tel-national" enterKeyHint="next"
                    maxLength={17} placeholder="99887766"
                    aria-invalid={!!errors.phone}
                    aria-describedby={errors.phone ? 'e-phone' : 'h-phone'}
                    dir="ltr"
                    className="w-full bg-transparent px-3 py-2.5 text-sm tabular-nums outline-none"
                  />
                </div>
              </Field>
            </div>
          </fieldset>

          <fieldset className="rounded-2xl border border-slate-100 bg-white p-5 md:p-6">
            <legend className="px-1 text-sm font-bold text-slate-800">{t.checkout.address}</legend>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field id="governorate" label={t.checkout.governorate} error={err('governorate')}>
                <select
                  id="f-governorate" name="address-level1" autoComplete="address-level1"
                  value={form.governorate} onChange={set('governorate')}
                  aria-invalid={!!errors.governorate}
                  aria-describedby={errors.governorate ? 'e-governorate' : undefined}
                  className={input(errors.governorate)}
                >
                  <option value="">{t.checkout.governoratePick}</option>
                  {GOVERNORATES.map((g) => (
                    <option key={g.id} value={g.id}>{g.name[lang]}</option>
                  ))}
                </select>
              </Field>

              {/* Free text with suggestions, not a closed <select>: the list
                  covers the areas we deliver to, but a new suburb must never be
                  the reason someone cannot place an order. */}
              <Field id="area" label={t.checkout.area} error={err('area')}>
                <input
                  id="f-area" name="address-level2" value={form.area} onChange={set('area')}
                  list="kw-areas" autoComplete="address-level2" maxLength={60}
                  enterKeyHint="next" placeholder={t.checkout.areaPh}
                  aria-invalid={!!errors.area} aria-describedby={errors.area ? 'e-area' : undefined}
                  className={input(errors.area)}
                />
                <datalist id="kw-areas">
                  {(gov?.areas ?? []).map((a) => <option key={a.en} value={a[lang]} />)}
                </datalist>
              </Field>

              {/* One column on a phone. These three sat in a hard grid-cols-3
                  with no breakpoint, which measured 97px per field at 390pt —
                  a box too narrow to show the word "Street", let alone a value,
                  and three adjacent 97px targets to mis-tap between. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:col-span-2">
                <Field id="block" label={t.checkout.block} error={err('block')}>
                  <input
                    id="f-block" name="address-line2" value={form.block} onChange={set('block')}
                    inputMode="numeric" pattern="[0-9]*" autoComplete="address-line2"
                    enterKeyHint="next" maxLength={12} aria-invalid={!!errors.block}
                    aria-describedby={errors.block ? 'e-block' : undefined}
                    className={input(errors.block)}
                  />
                </Field>
                <Field id="street" label={t.checkout.street} error={err('street')}>
                  <input
                    id="f-street" name="address-line1" value={form.street} onChange={set('street')}
                    maxLength={40} autoComplete="address-line1" enterKeyHint="next"
                    autoCorrect="off" spellCheck={false} aria-invalid={!!errors.street}
                    aria-describedby={errors.street ? 'e-street' : undefined}
                    className={input(errors.street)}
                  />
                </Field>
                <Field id="building" label={t.checkout.building} error={err('building')}>
                  <input
                    id="f-building" name="address-line3" value={form.building} onChange={set('building')}
                    maxLength={24} autoComplete="address-line3" enterKeyHint="next"
                    autoCorrect="off" spellCheck={false} aria-invalid={!!errors.building}
                    aria-describedby={errors.building ? 'e-building' : undefined}
                    className={input(errors.building)}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:col-span-2">
                <Field id="floor" label={t.checkout.floor} optional={t.checkout.optional}>
                  <input id="f-floor" name="floor" value={form.floor} onChange={set('floor')}
                    maxLength={16} inputMode="numeric" pattern="[0-9]*" enterKeyHint="next"
                    autoComplete="off" className={input()} />
                </Field>
                <Field id="flat" label={t.checkout.flat} optional={t.checkout.optional}>
                  <input id="f-flat" name="flat" value={form.flat} onChange={set('flat')}
                    maxLength={16} inputMode="numeric" pattern="[0-9]*" enterKeyHint="next"
                    autoComplete="off" className={input()} />
                </Field>
              </div>

              <Field id="note" label={t.checkout.note} optional={t.checkout.optional} className="sm:col-span-2">
                <textarea
                  id="f-note" name="note" value={form.note} onChange={set('note')}
                  rows={2} maxLength={280} autoComplete="off" enterKeyHint="done"
                  placeholder={t.checkout.notePh} className={`${input()} resize-y`}
                />
              </Field>
            </div>

            {/* tap-row: a checkbox cannot grow to 44px without looking wrong,
                so the label around it carries the touch target instead. */}
            <label className="tap-row mt-4 flex cursor-pointer gap-2.5 text-sm text-slate-600">
              <input
                type="checkbox" checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-5 w-5 shrink-0 accent-brand"
              />
              {t.checkout.remember}
            </label>
          </fieldset>
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-2xl border border-slate-100 bg-white p-5 md:p-6">
            <h2 className="flex items-baseline justify-between font-bold text-slate-800">
              {t.checkout.summary}
              <span className="text-xs font-medium text-slate-400">
                {t.checkout.itemsCount(items.reduce((n, i) => n + i.qty, 0))}
              </span>
            </h2>
            <ul className="mt-3 divide-y divide-slate-100">
              {summary.map((i) => (
                // key is the LINE key, not the slug. Two sizes of one product
                // are two lines with the same slug, so keying on the slug gave
                // React duplicate keys and could show one line's quantity
                // against the other's name.
                <li key={i.key} className="flex justify-between gap-3 py-3 text-sm">
                  <span className="text-slate-600">
                    {i.name[lang]}
                    {optionLine(i, lang) && (
                      <span className="font-semibold text-slate-700"> ({optionLine(i, lang)})</span>
                    )}{' '}
                    × {i.qty}
                  </span>
                  <span className="whitespace-nowrap font-semibold text-slate-800">
                    {formatKWD(i.line, lang)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-between border-t border-slate-200 pt-4 text-lg font-bold">
              <span>{t.cart.total}</span>
              <span className="text-brand">{formatKWD(total, lang)}</span>
            </div>

            {/* Payment method. A radio group rather than a dropdown: both
                options need their consequence visible without a tap, because
                the difference — pay now on the bank's page, or pay the driver —
                is the whole decision. */}
            <fieldset className="mt-5 border-t border-slate-200 pt-4">
              <legend className="mb-2 text-sm font-bold text-slate-800">{t.checkout.payWith}</legend>
              <div className="space-y-2">
                {[
                  ['knet', t.checkout.methodKnet, t.checkout.methodKnetHint],
                  ['tpay', t.checkout.methodTpay, t.checkout.methodTpayHint],
                  ['cod', t.checkout.methodCod, t.checkout.methodCodHint],
                ].map(([id, label, hint]) => (
                  <label
                    key={id}
                    className={`tap-row flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
                      method === id ? 'border-brand bg-brand/5' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="paymethod"
                      value={id}
                      checked={method === id}
                      onChange={() => setMethod(id)}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-brand"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-800">{label}</span>
                      <span className="block text-xs leading-snug text-slate-500">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* On a phone the summary sits below a long form, so the real Pay
                button is the sticky bar below; showing both would be two live
                submit buttons a thumb-scroll apart. */}
            <button type="submit" disabled={busy} className="btn btn-primary mt-5 hidden w-full lg:inline-flex">
              {busy ? t.checkout.redirecting : method === 'cod' ? t.checkout.placeOrder : t.checkout.payNow}
            </button>
            {method !== 'cod' && (
              <p className="mt-3 hidden text-center text-xs text-slate-400 lg:block">{t.checkout.securedBy}</p>
            )}
            {method === 'cod' && (
              <p className="mt-3 hidden text-center text-xs text-slate-400 lg:block">{t.checkout.codNote}</p>
            )}
          </div>
        </aside>

        {/* Sticky pay bar — phones only. */}
        <div className="action-bar safe-bottom flex items-center justify-between gap-3 px-4 pt-3 lg:hidden">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t.cart.total}</p>
            <p className="truncate text-lg font-extrabold text-brand">{formatKWD(total, lang)}</p>
          </div>
          <button type="submit" disabled={busy} className="btn btn-primary flex-1">
            {busy ? t.checkout.redirecting : method === 'cod' ? t.checkout.placeOrder : t.checkout.payNow}
          </button>
        </div>
        <div className="h-[calc(5.25rem+var(--sa-bottom))] lg:hidden" aria-hidden />
      </form>
    </section>
  )
}

const input = (bad) =>
  `w-full rounded-xl border bg-white px-3 py-2.5 text-sm outline-none transition focus:ring-2 ${
    bad
      ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100'
      : 'border-slate-200 focus:border-brand focus:ring-brand/15'
  }`

function Field({ id, label, hint, error, optional, className = '', children }) {
  return (
    <div className={className}>
      <label htmlFor={`f-${id}`} className="mb-1.5 block text-xs font-bold text-slate-600">
        {label}
        {optional && <span className="ms-1.5 font-medium text-slate-400">({optional})</span>}
      </label>
      {children}
      {hint && !error && <p id={`h-${id}`} className="mt-1 text-xs text-slate-400">{hint}</p>}
      {error && (
        <p id={`e-${id}`} role="alert" className="mt-1 text-xs font-semibold text-rose-600">
          {error}
        </p>
      )}
    </div>
  )
}
