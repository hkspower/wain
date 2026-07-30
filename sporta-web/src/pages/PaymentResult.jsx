import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { useCart } from '../lib/cart'
import { clearAttempt } from '../lib/checkout'
import { usePageMeta } from '../lib/seo'

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
        const { supabase } = await import('../lib/supabase')
        if (supabase) {
          // Read status via the security-definer RPC (orders has no client SELECT).
          const { data } = await supabase.rpc('get_order_status', { p_track_id: trackid })
          const row = Array.isArray(data) ? data[0] : data
          if (alive) setConfirmed(row?.payment_status ?? null)
        }
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
      <p className="mt-2 text-slate-500">{r.msg}</p>
      {trackid && <p className="mt-3 text-xs text-slate-400">{trackid}</p>}
      <div className="mt-6 flex gap-3">
        <Link to="/" className="rounded-full bg-brand px-6 py-2.5 font-semibold text-white">{t.result.home}</Link>
        {effective !== 'success' && effective !== 'cod' && (
          <Link to="/cart" className="rounded-full border border-brand px-6 py-2.5 font-semibold text-brand">
            {t.result.retry}
          </Link>
        )}
      </div>
    </div>
  )
}
