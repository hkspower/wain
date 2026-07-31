import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { ltr } from '../lib/bidi'
import { formatKWD } from '../lib/format'
import { usingPhp, phpOrderStatus } from '../lib/backend'
import { usePageMeta } from '../lib/seo'

// Order tracking by the track id shown after checkout. Reads status through the
// get_order_status RPC (orders are not client-readable under RLS).
export default function TrackOrder() {
  const { t, lang } = useLang()
  const [id, setId] = useState('')
  const [state, setState] = useState({ status: 'idle' })
  usePageMeta({ title: t.track.title, description: t.track.sub, path: '/track' })

  async function submit(e) {
    e.preventDefault()
    const trackId = id.trim()
    if (!trackId) return
    setState({ status: 'loading' })
    try {
      let row
      if (usingPhp()) {
        row = await phpOrderStatus(trackId)
      } else {
        const { supabase } = await import('../lib/supabase')
        if (!supabase) return setState({ status: 'error' })
        const { data, error } = await supabase.rpc('get_order_status', { p_track_id: trackId })
        if (error) return setState({ status: 'notfound' })
        row = Array.isArray(data) ? data[0] : data
      }
      if (!row) return setState({ status: 'notfound' })
      // Neither backend returns the track id in the row — it is the QUERY. Put
      // it back so the card can print the number that was actually looked up.
      setState({ status: 'found', row: { ...row, track_id: trackId } })
    } catch {
      setState({ status: 'error' })
    }
  }

  const badge = {
    paid: 'bg-emerald-100 text-emerald-700',
    pending: 'bg-amber-100 text-amber-700',
    failed: 'bg-rose-100 text-rose-700',
  }

  return (
    <section className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-3xl font-extrabold text-slate-900">{t.track.title}</h1>
      <p className="mt-2 text-slate-500">{t.track.sub}</p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-3 sm:flex-row">
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder={t.track.placeholder}
          aria-label={t.track.placeholder}
          className="flex-1 rounded-full border border-black/15 bg-white px-5 py-3 outline-none focus:border-brand"
        />
        <button className="btn btn-primary w-full sm:w-auto">{t.track.cta}</button>
      </form>

      <div className="mt-8">
        {state.status === 'loading' && <div className="skeleton h-20 rounded-2xl" />}
        {state.status === 'notfound' && <p className="text-slate-600">{t.track.notfound}</p>}
        {state.status === 'error' && <p className="text-slate-600">{t.track.error}</p>}
        {state.status === 'found' && (
          <div className="card p-6">
            <div className="flex items-center justify-between gap-3">
              {/* The order number is a Latin run: isolated so Arabic cannot
                  reorder it, and slate-600 because slate-500 on this card was
                  under the contrast floor. */}
              <span dir="ltr" className="font-mono text-sm text-slate-600">{ltr(state.row.track_id)}</span>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${badge[state.row.payment_status] || ''}`}>
                {t.track.states[state.row.payment_status] || state.row.payment_status}
              </span>
            </div>
            {/* formatKWD, not a hand-built string: "10.000 KWD" put the
                currency on the wrong side in Arabic and used the wrong digits.
                Intl knows where د.ك goes. */}
            <p className="text-accent mt-3 font-display text-2xl font-extrabold tabular-nums">
              {formatKWD(state.row.amount, lang)}
            </p>
            <Link
              to={`/invoice/${encodeURIComponent(state.row.track_id)}`}
              className="text-accent mt-4 inline-block text-sm font-semibold underline underline-offset-2"
            >
              {t.invoice.view}
            </Link>
          </div>
        )}
      </div>
    </section>
  )
}
