import { useState } from 'react'
import { useLang } from '../i18n/LanguageContext'
import { usePageMeta } from '../lib/seo'

// Order tracking by the track id shown after checkout. Reads status through the
// get_order_status RPC (orders are not client-readable under RLS).
export default function TrackOrder() {
  const { t } = useLang()
  const [id, setId] = useState('')
  const [state, setState] = useState({ status: 'idle' })
  usePageMeta({ title: t.track.title, description: t.track.sub, path: '/track' })

  async function submit(e) {
    e.preventDefault()
    const trackId = id.trim()
    if (!trackId) return
    setState({ status: 'loading' })
    try {
      const { supabase } = await import('../lib/supabase')
      if (!supabase) return setState({ status: 'error' })
      const { data, error } = await supabase.rpc('get_order_status', { p_track_id: trackId })
      const row = Array.isArray(data) ? data[0] : data
      if (error || !row) return setState({ status: 'notfound' })
      setState({ status: 'found', row })
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

      <form onSubmit={submit} className="mt-6 flex gap-3">
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder={t.track.placeholder}
          aria-label={t.track.placeholder}
          className="flex-1 rounded-full border border-black/15 bg-white px-5 py-3 outline-none focus:border-brand"
        />
        <button className="btn btn-primary">{t.track.cta}</button>
      </form>

      <div className="mt-8">
        {state.status === 'loading' && <div className="skeleton h-20 rounded-2xl" />}
        {state.status === 'notfound' && <p className="text-slate-500">{t.track.notfound}</p>}
        {state.status === 'error' && <p className="text-slate-500">{t.track.error}</p>}
        {state.status === 'found' && (
          <div className="card p-6">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-slate-500">{state.row.track_id}</span>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${badge[state.row.payment_status] || ''}`}>
                {t.track.states[state.row.payment_status] || state.row.payment_status}
              </span>
            </div>
            <p className="mt-3 text-2xl font-extrabold tabular-nums text-brand-dark">
              {Number(state.row.amount).toFixed(3)} KWD
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
