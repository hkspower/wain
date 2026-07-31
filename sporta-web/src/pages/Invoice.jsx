import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { usePageMeta } from '../lib/seo'
import { formatKWD } from '../lib/format'
import { ltr, stamp, dirFor } from '../lib/bidi'
import { fitLabel } from '../lib/options'
import { governorate } from '../lib/kuwait'

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
  const { lang, t, dir } = useLang()
  const [state, setState] = useState({ loading: true, data: null, error: null })

  usePageMeta({ title: t.invoice.title, path: `/invoice/${trackId}`, robots: 'noindex, nofollow' })

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { supabase } = await import('../lib/supabase')
        if (!supabase) throw new Error('unconfigured')
        const { data, error } = await supabase.rpc('get_order_invoice', { p_track_id: trackId })
        if (error) throw error
        if (alive) setState({ loading: false, data: data ?? null, error: data ? null : 'notfound' })
      } catch {
        if (alive) setState({ loading: false, data: null, error: 'error' })
      }
    })()
    return () => {
      alive = false
    }
  }, [trackId])

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
  const subtotal = items.reduce((s, i) => s + Number(i.line_total ?? 0), 0)

  const addressParts = [
    inv.address?.block && `${t.checkout.block} ${inv.address.block}`,
    inv.address?.street && `${t.checkout.street} ${inv.address.street}`,
    inv.address?.building && `${t.checkout.building} ${inv.address.building}`,
    inv.address?.floor && `${t.checkout.floor} ${inv.address.floor}`,
    inv.address?.flat && `${t.checkout.flat} ${inv.address.flat}`,
  ].filter(Boolean)

  return (
    <section className="invoice mx-auto max-w-3xl px-4 py-10">
      {/* Not printed — the actions are for the screen only. */}
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="text-accent text-sm font-semibold underline underline-offset-2">
          {t.nav.home}
        </Link>
        <button type="button" onClick={() => window.print()} className="btn btn-primary btn-sm">
          {t.invoice.print}
        </button>
      </div>

      <article className="rounded-2xl border border-slate-200 bg-white p-6 md:p-10">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <img src="/logo.png" alt="Sporta Sports Wear" width="132" height="41" className="h-9 w-auto" />
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

        <div className="grid gap-6 border-b border-slate-200 py-6 sm:grid-cols-2">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600">{t.invoice.billTo}</h2>
            {/* The customer's own name decides its direction, not the page:
                this shop has customers called both "Fatima Al-Sabah" and
                "فاطمة الصباح", and neither should render backwards. */}
            <p dir={dirFor(inv.customer_name)} className="mt-1 font-bold text-slate-900">
              {inv.customer_name}
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
        <table className="mt-6 w-full border-collapse text-sm" dir={dir}>
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
                  <td className="py-3 text-start">
                    {/* Both names, each in its own direction. */}
                    <span dir={dirFor(lang === 'ar' ? i.name_ar : i.name_en)} className="block font-semibold text-slate-900">
                      {lang === 'ar' ? i.name_ar : i.name_en}
                    </span>
                    <span dir={dirFor(lang === 'ar' ? i.name_en : i.name_ar)} className="block text-xs text-slate-600">
                      {lang === 'ar' ? i.name_en : i.name_ar}
                    </span>
                    {opts.length > 0 && (
                      <span className="mt-0.5 block text-xs font-semibold text-slate-700">
                        {opts.join(t.invoice.sep)}
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-center font-semibold tabular-nums text-slate-900">{i.qty}</td>
                  <td className="py-3 text-end tabular-nums text-slate-700">{formatKWD(i.unit_price, lang)}</td>
                  <td className="py-3 text-end font-semibold tabular-nums text-slate-900">
                    {formatKWD(i.line_total, lang)}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} />
              <td className="pt-4 text-end text-sm font-bold text-slate-700">{t.cart.total}</td>
              <td className="text-accent pt-4 text-end font-display text-lg font-extrabold tabular-nums">
                {formatKWD(inv.amount ?? subtotal, lang)}
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
