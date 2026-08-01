import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { useCart } from '../lib/cart'
import { clearAttempt } from '../lib/checkout'
import { phpOrderStatus } from '../lib/backend'
import { usePageMeta } from '../lib/seo'
import { ltr } from '../lib/bidi'

// Customer lands here after CBK:
//   /payment/result?status=success|review|failed|cancelled|error&trackid=...&payid=...
// 'review' = the bank may have captured the payment but the server could not
// verify the amount/order. Never tell the customer to pay again in that case.
export default function PaymentResult() {
  const [params] = useSearchParams()
  const { t } = useLang()
  const { clear } = useCart()
  const status = params.get('status') || 'error'
  usePageMeta({ path: '/payment/result', robots: 'noindex, follow' })
  const trackid = params.get('trackid') || ''
  const [confirmed, setConfirmed] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      // Empty the cart on success, and end the checkout attempt with it.
      // The attempt's track id is deliberately reused across retries so a
      // double tap cannot create two orders; once the order is placed, holding
      // on to it would hand the NEXT bag the same order number.
      if (status === 'success' || status === 'cod') {
        clear()
        clearAttempt()
      }
      if (!trackid) return setLoading(false)
      try {
        const row = await phpOrderStatus(trackid)
        if (alive) setConfirmed(row?.payment_status ?? null)
      } catch {
        /* ignore */
      }
      if (alive) setLoading(false)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackid])

  // A cash order is a completed checkout even though nothing has been paid yet,
  // so it must not read as a failure. It stays 'cod' until the driver collects
  // and the admin marks it paid — at which point the confirmed status wins.
  const effective = confirmed === 'paid' ? 'success'
    : confirmed === 'failed' ? 'failed'
    : status === 'cod' ? 'cod'
    : status
  const r = t.result[effective] || t.result.error

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
      <div className={`mb-4 text-6xl ${
        effective === 'success' || effective === 'cod' ? 'text-emerald-500' : 'text-rose-500'
      }`}>
        {effective === 'success' || effective === 'cod' ? '✓' : effective === 'cancelled' ? '⏱' : '✕'}
      </div>
      <h1 className="text-2xl font-bold text-slate-800">{loading ? '…' : r.title}</h1>
      <p className="mt-2 text-slate-600">{r.msg}</p>
      {/* The order number is a Latin run and the only handle a guest customer
          has. Isolated so it cannot be reordered inside Arabic, and readable —
          slate-400 on the beige canvas measured 1.91:1. */}
      {trackid && (
        <p dir="ltr" className="mt-3 text-xs font-semibold tabular-nums text-slate-600">{ltr(trackid)}</p>
      )}
      {trackid && (effective === 'success' || effective === 'cod') && (
        <Link to={`/invoice/${encodeURIComponent(trackid)}`} className="text-accent mt-4 text-sm font-semibold underline underline-offset-2">
          {t.invoice.view}
        </Link>
      )}
      <div className="mt-6 flex gap-3">
        <Link to="/" className="rounded-full bg-brand px-6 py-2.5 font-semibold text-ink">{t.result.home}</Link>
        {effective !== 'success' && effective !== 'cod' && (
          <Link to="/cart" className="rounded-full border border-brand px-6 py-2.5 font-semibold text-brand">
            {t.result.retry}
          </Link>
        )}
      </div>
    </div>
  )
}
