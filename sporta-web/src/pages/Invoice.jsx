import { useEffect, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { usePageMeta } from '../lib/seo'
import { formatKWD } from '../lib/format'
import { ltr, stamp, dirFor } from '../lib/bidi'
import { fitLabel } from '../lib/options'
import { governorate } from '../lib/kuwait'
import { phpOrderInvoice } from '../lib/backend'

// The customer's invoice, at /invoice/<order number>.
//
// ============================ WHY IT IS RTL-CORRECT ========================
// This is the hardest page on the site for bidirectional text: Arabic prose
// wrapped around order numbers, dates, quantities, sizes and money, every one
// of which is a left-to-right run inside a right-to-left paragraph. See
// lib/bidi.js for what goes wrong and why isolation — not merely `dir` — is
// the fix.
//
// The rules applied throughout, and each one was a visible bug without it:
//
//   * The document takes its direction from the PAGE, and the table mirrors
//     with it: in Arabic the item column is on the right and the money on the
//     left, because that is the direction a receipt is read.
//   * Alignment is LOGICAL (text-start / text-end), never left/right. A
//     hard-coded `text-right` on the total is correct in English and lands the
//     total under the item names in Arabic.
//   * The order number, the date and the phone are wrapped as isolated LTR
//     runs. Without that "SP1A2B3C." renders ".SP1A2B3C" in Arabic.
//   * Product names carry their OWN direction, chosen per string: the
//     catalogue holds "Cloudsoft Jacket" and "جاكيت كلاودسوفت" and this page
//     shows both, one under the other, in every language.
//   * Money keeps Latin digits in both languages, matching formatKWD, so the
//     invoice cannot disagree with the price the shopper saw on the product
//     page. Intl already inserts the right bidi marks around "د.ك."
//   * Numeric columns are tabular-nums so the figures line up in a column
//     rather than dancing with the glyph widths.
//
// PRINTING is the point of the page — a customer prints it or saves a PDF, and
// a warehouse or a company accounts department may be the one reading it. The
// print rules live in styles/index.css under @media print.
export default function Invoice() {
  const { trackId = '' } = useParams()
  // ?k= is the signed key the server issues with a new order and in the
  // account's order list; without it the server answers the limited invoice.
  const [search] = useSearchParams()
  const invoiceKey = search.get('k') ?? ''
  const { lang, t, dir } = useLang()
  const [state, setState] = useState({ loading: true, data: null, error: null })

  usePageMeta({ title: t.invoice.title, path: `/invoice/${trackId}`, robots: 'noindex, nofollow' })

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await phpOrderInvoice(trackId, invoiceKey)
        if (alive) setState({ loading: false, data: data ?? null, error: data ? null : 'notfound' })
      } catch {
        if (alive) setState({ loading: false, data: null, error: 'error' })
      }
    })()
    return () => {
      alive = false
    }
  }, [trackId, invoiceKey])

  if (state.loading) {
    return <p className="mx-auto max-w-3xl px-4 py-20 text-center text-slate-600">{t.a11y.loading}…</p>
  }

  if (!state.data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <p className="text-lg text-slate-600">
          {state.error === 'notfound' ? t.track.notfound : t.track.error}
        </p>
        <Link to="/track" className="btn btn-primary mt-5 inline-flex">{t.track.cta}</Link>
      </div>
    )
  }

  const inv = state.data
  const gov = governorate(inv.address?.governorate)
  const paid = inv.payment_status === 'paid'
  const items = inv.items ?? []
  // The sum of the line totals — the goods before discount and delivery. It is
  // the fallback for the server's subtotal, and (with delivery/discount) for
  // the grand total, so a response missing a field still adds up on screen.
  const lineSum = items.reduce((s, i) => s + Number(i.line_total ?? 0), 0)
  const goodsSubtotal = inv.subtotal != null ? Number(inv.subtotal) : lineSum
  const discountAmount = Number(inv.discount_amount ?? 0)
  const deliveryFee = Number(inv.delivery_fee ?? 0)
  const discountLabel = inv.discount_label || inv.discount_code || ''
  const total =
    inv.amount != null ? Number(inv.amount) : goodsSubtotal - discountAmount + deliveryFee

  const addressParts = [
    inv.address?.block && `${t.checkout.block} ${inv.address.block}`,
    inv.address?.street && `${t.checkout.street} ${inv.address.street}`,
    inv.address?.building && `${t.checkout.building} ${inv.address.building}`,
    inv.address?.floor && `${t.checkout.floor} ${inv.address.floor}`,
    inv.address?.flat && `${t.checkout.flat} ${inv.address.flat}`,
  ].filter(Boolean)

  return (
    <section className="invoice mx-auto max-w-3xl px-3 py-10 sm:px-4">
      {/* Not printed — the actions are for the screen only. */}
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="tap text-accent inline-flex items-center text-sm font-semibold underline underline-offset-2">
          {t.nav.home}
        </Link>
        <button type="button" onClick={() => window.print()} className="btn btn-primary btn-sm">
          {t.invoice.print}
        </button>
      </div>

      <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 md:p-10">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6 print:pb-4">
          <div>
            {/* Two inks, one shown at a time (index.css). logo.png has BLACK
                lettering for a light surface; on the dark theme's charcoal card
                it measured about 1.1:1 and the wordmark all but vanished, only
                the orange S left. The white-lettered logo takes over there on
                screen, and the black one always prints. Both carry the alt text:
                the hidden one is not exposed, so it is read once. */}
            <img src="/logo.png" alt="Sporta Sports Wear" width="132" height="41" className="invoice-logo-light h-9 w-auto" />
            <img src="/logo-white.png" alt="Sporta Sports Wear" width="600" height="184" className="invoice-logo-dark h-9 w-auto" />
            <p className="mt-2 text-xs text-slate-600">{t.invoice.seller}</p>
          </div>
          <div className="text-start sm:text-end">
            <h1 className="font-display text-2xl font-extrabold text-slate-900">{t.invoice.title}</h1>
            {/* The order number is a Latin run. In Arabic, without isolation,
                the trailing punctuation of the label migrates across it. */}
            <p className="mt-1 text-sm text-slate-700">
              {t.invoice.number}{' '}
              <span dir="ltr" className="font-bold tabular-nums">{ltr(inv.track_id)}</span>
            </p>
            <p className="text-sm text-slate-600">
              {t.invoice.date} <span dir="ltr" className="tabular-nums">{stamp(inv.placed_at)}</span>
            </p>
            <p className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-bold ${
              paid ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'
            }`}>
              {paid ? t.invoice.paid : t.invoice.unpaid}
            </p>
          </div>
        </header>

        <div className="grid gap-6 border-b border-slate-200 py-6 sm:grid-cols-2 print:gap-4 print:py-4">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600">{t.invoice.billTo}</h2>
            {/* The customer's own name decides its direction, not the page:
                this shop has customers called both "Fatima Al-Sabah" and
                "فاطمة الصباح", and neither should render backwards. */}
            {/* The direction sits on an inline span inside a block that keeps
                the page's: on the <p> itself, an Arabic name in the English
                invoice (or a Latin one in the Arabic invoice) was pushed to the
                far edge of its column, away from the heading and the address
                it belongs to. */}
            <p className="mt-1 font-bold text-slate-900">
              <span dir={dirFor(inv.customer_name)}>{inv.customer_name}</span>
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-700">
              {addressParts.join(t.invoice.sep)}
              {addressParts.length > 0 && <br />}
              {/* "Salmiya" is Latin, "حولي" is Arabic, and they sit either
                  side of one separator. Each gets its own isolated span so the
                  comma cannot migrate between them. */}
              <span dir={dirFor(inv.address?.area)}>{inv.address?.area}</span>
              {inv.address?.area && gov?.name?.[lang] ? t.invoice.sep : ''}
              <span>{gov?.name?.[lang]}</span>
            </p>
          </div>
          <div className="sm:text-end">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600">{t.invoice.payment}</h2>
            <p className="mt-1 font-semibold text-slate-900">
              {inv.payment_method === 'cod'
                ? t.checkout.methodCod
                : inv.payment_method === 'tpay'
                  ? t.checkout.methodTpay
                  : t.checkout.methodKnet}
            </p>
            {inv.paid_at && (
              <p className="text-sm text-slate-600">
                {t.invoice.paidOn} <span dir="ltr" className="tabular-nums">{stamp(inv.paid_at)}</span>
              </p>
            )}
          </div>
        </div>

        {/* The table mirrors with the page. Alignment is logical throughout —
            a hard-coded text-right puts the total under the item names in
            Arabic instead of at the end of its own column. */}
        <table className="mt-6 w-full border-collapse text-[13px] sm:text-sm print:mt-4" dir={dir}>
          <thead>
            <tr className="border-b border-slate-300 text-xs uppercase tracking-wide text-slate-600">
              <th className="py-2 text-start font-bold">{t.invoice.item}</th>
              <th className="py-2 text-center font-bold">{t.invoice.qty}</th>
              <th className="py-2 text-end font-bold">{t.invoice.unitPrice}</th>
              <th className="py-2 text-end font-bold">{t.invoice.lineTotal}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, n) => {
              const opts = [i.size, i.fit ? fitLabel(i.fit, lang) : null].filter(Boolean)
              return (
                <tr key={`${i.name_en}-${i.size}-${n}`} className="border-b border-slate-100 align-top">
                  <td className="py-3 text-start print:py-1.5">
                    {/* Both names, each in its own direction — on an INLINE
                        span inside a block that keeps the page's direction.
                        The `dir` used to sit on the block itself, and a block
                        aligns `start` to its OWN direction: the English name in
                        an Arabic page hugged the left of the column while the
                        Arabic name above it hugged the right (and the other way
                        round in English), so the two lines of one product never
                        shared an edge. */}
                    <span className="block font-semibold text-slate-900">
                      <span dir={dirFor(lang === 'ar' ? i.name_ar : i.name_en)}>{lang === 'ar' ? i.name_ar : i.name_en}</span>
                    </span>
                    <span className="block text-xs text-slate-600">
                      <span dir={dirFor(lang === 'ar' ? i.name_en : i.name_ar)}>{lang === 'ar' ? i.name_en : i.name_ar}</span>
                    </span>
                    {opts.length > 0 && (
                      <span className="mt-0.5 block text-xs font-semibold text-slate-700">
                        {opts.join(t.invoice.sep)}
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-center font-semibold tabular-nums text-slate-900 print:py-1.5">{i.qty}</td>
                  <td className="py-3 text-end tabular-nums text-slate-700 print:py-1.5">{formatKWD(i.unit_price, lang)}</td>
                  <td className="py-3 text-end font-semibold tabular-nums text-slate-900 print:py-1.5">
                    {formatKWD(i.line_total, lang)}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {/* print:table-row-group — see styles/index.css: a <tfoot> is
              repeated at the foot of EVERY printed page unless it is made an
              ordinary row group, which printed the totals block six times on
              a six-page invoice.

              The label cell spans the first three columns and the figure sits
              in the fourth. It used to be an empty two-column cell, a label in
              the unit-price column and a figure: the promo name then had only
              that one narrow column to wrap inside, and the label (no padding)
              touched the figure whenever the figure set the column's width —
              "Total1,122.625". `pe-4` is the gap, on the end side in either
              direction. */}
          <tfoot>
            {/* The invoice has to add up. The server sends goods subtotal,
                discount and delivery separately, and each is shown on its own
                line: items summing to more than the total (a coupon) or less
                than it (the delivery fee) reads as a miscount until the
                difference is named. Discount appears only when there is one;
                subtotal and delivery are always present. Values fall back to
                the arithmetic if an older cached response lacks a field. */}
            <tr>
              <td colSpan={3} className="pe-4 pt-4 text-end text-sm text-slate-600">{t.invoice.subtotal}</td>
              <td className="pt-4 text-end tabular-nums text-slate-700">
                {formatKWD(goodsSubtotal, lang)}
              </td>
            </tr>
            {discountAmount > 0 && (
              <tr>
                {/* The line is always named in the reader's language; the
                    promo's own name (which the merchant may have typed in one
                    language only) rides alongside as context, like a product
                    name does — never in place of the translated label.

                    The separator is OUTSIDE the isolated span. Inside it, in
                    an Arabic page, the leading " · " belongs to the LTR run,
                    so it was painted on the far side of the promo name and the
                    name touched the word "الخصم": "Launch 10% offالخصم". */}
                <td colSpan={3} className="pe-4 text-end text-sm text-slate-600">
                  {t.invoice.discount}
                  {discountLabel && (
                    <>
                      {' '}<span aria-hidden="true">·</span>{' '}
                      <span dir={dirFor(discountLabel)}>{discountLabel}</span>
                    </>
                  )}
                </td>
                {/* Formatted as a NEGATIVE amount, in the page's direction.
                    This cell used to be dir="ltr" with a typed "−" in front,
                    which in Arabic did two wrong things: it right-aligned the
                    figure (an LTR cell's end is its right edge) while every
                    other figure sits at the left end of the column, and it put
                    the minus on the far side of the currency, "3.000 د.ك. −".
                    Intl writes the sign inside an LRM, glued to the digits. */}
                <td className="text-end tabular-nums text-emerald-700">
                  {formatKWD(-discountAmount, lang)}
                </td>
              </tr>
            )}
            <tr>
              <td colSpan={3} className="pe-4 text-end text-sm text-slate-600">{t.invoice.delivery}</td>
              <td className="text-end tabular-nums text-slate-700">
                {formatKWD(deliveryFee, lang)}
              </td>
            </tr>
            <tr>
              <td colSpan={3} className="pe-4 pt-3 text-end text-sm font-bold text-slate-700">{t.cart.total}</td>
              <td className="text-accent pt-3 text-end font-display text-base font-extrabold tabular-nums sm:text-lg">
                {formatKWD(total, lang)}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Kuwait has no VAT as of this writing. Saying so is better than an
            invoice with a silent gap where a tax line would be — a company
            accounts department will otherwise ask. */}
        <p className="mt-6 text-xs leading-relaxed text-slate-600">{t.invoice.taxNote}</p>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          {t.invoice.footer}{' '}
          <span dir="ltr">www.sporta.com.kw</span> · <span dir="ltr">cs@sporta.com.kw</span>
        </p>
      </article>
    </section>
  )
}
