import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { useCart } from '../lib/cart'

// Customer lands here after CBK:
//   /payment/result?status=success|failed|cancelled|error&trackid=...&payid=...
export default function PaymentResult() {
  const [params] = useSearchParams()
  const { t } = useLang()
  const { clear } = useCart()
  const status = params.get('status') || 'error'
  const trackid = params.get('trackid') || ''
  const [confirmed, setConfirmed] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      // Empty the cart on success.
      if (status === 'success') clear()
      if (!trackid) return setLoading(false)
      try {
        const { supabase } = await import('../lib/supabase')
        if (supabase) {
          const { data } = await supabase
            .from('orders')
            .select('payment_status')
            .eq('track_id', trackid)
            .maybeSingle()
          if (alive) setConfirmed(data?.payment_status ?? null)
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

  const effective = confirmed === 'paid' ? 'success' : confirmed === 'failed' ? 'failed' : status
  const r = t.result[effective] || t.result.error

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
      <div className={`mb-4 text-6xl ${effective === 'success' ? 'text-emerald-500' : 'text-rose-500'}`}>
        {effective === 'success' ? '✓' : effective === 'cancelled' ? '⏱' : '✕'}
      </div>
      <h1 className="text-2xl font-bold text-slate-800">{loading ? '…' : r.title}</h1>
      <p className="mt-2 text-slate-500">{r.msg}</p>
      {trackid && <p className="mt-3 text-xs text-slate-400">{trackid}</p>}
      <div className="mt-6 flex gap-3">
        <Link to="/" className="rounded-full bg-brand px-6 py-2.5 font-semibold text-white">{t.result.home}</Link>
        {effective !== 'success' && (
          <Link to="/cart" className="rounded-full border border-brand px-6 py-2.5 font-semibold text-brand">
            {t.result.retry}
          </Link>
        )}
      </div>
    </div>
  )
}
