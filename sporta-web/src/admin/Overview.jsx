import { useEffect, useState } from 'react'
import { fetchStats, fetchRevenueDaily, fetchCatalogState } from './api'
import { formatKWD } from '../lib/format'

const kwd = (n) => formatKWD(Number(n ?? 0), 'en')

export default function Overview({ onGoto }) {
  const [state, setState] = useState({ loading: true })

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [s, r, c] = await Promise.all([fetchStats(), fetchRevenueDaily(14), fetchCatalogState()])
      if (!alive) return
      setState({
        loading: false,
        stats: s.stats,
        series: r.series ?? [],
        catalog: c.rows ?? [],
        needsMigration: s.needsMigration || r.needsMigration || c.needsMigration,
        notAdmin: s.notAdmin || r.notAdmin,
        error: s.error || c.error,
      })
    })()
    return () => {
      alive = false
    }
  }, [])

  if (state.loading) return <Skeleton />

  if (state.error) return <Notice tone="error" title="Cannot load the dashboard">{state.error}</Notice>

  // Signed in but not allowlisted. Distinguished from "migration missing"
  // because the fix is completely different, and from "no data" because an
  // empty dashboard looks like a working shop with no orders.
  if (state.notAdmin) {
    return (
      <Notice tone="error" title="This account is not an admin">
        <p>
          It is signed in, but it is not on the admin allowlist, so the database
          refuses to show it any orders or figures. Being signed in is
          deliberately not enough — Supabase sign-up is open to anyone.
        </p>
        <p className="mt-2">Add this account in the Supabase SQL editor:</p>
        <pre className="mt-1 overflow-x-auto rounded bg-slate-900 p-2 text-[.72rem] leading-relaxed text-slate-100">{`insert into public.admin_users (user_id, email)
select id, email from auth.users
 where email = 'you@example.com'
on conflict (user_id) do nothing;`}</pre>
      </Notice>
    )
  }

  if (state.needsMigration) {
    return (
      <Notice tone="warn" title="Database migration not applied yet">
        The admin needs the policies and functions in{' '}
        <code className="rounded bg-amber-100 px-1 font-mono text-[.85em]">
          supabase/admin-migration.sql
        </code>
        . Open the Supabase SQL editor, paste that file in, and run it — then reload this page.
        Until then the admin cannot read orders, because only an insert policy exists.
      </Notice>
    )
  }

  const s = state.stats ?? {}
  const missing = state.catalog.filter((r) => r.state === 'missing').length
  const differs = state.catalog.filter((r) => r.state === 'differs').length

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">Overview</h1>
        <p className="mt-1 text-sm text-slate-500">Live figures from the orders table.</p>
      </header>

      {/* Things that need a decision come before things that are merely true. */}
      {missing > 0 && (
        <Notice tone="error" title={`${missing} of ${state.catalog.length} products are not in the database`}>
          Orders are priced from the products table. Until it holds the catalogue, every checkout
          fails with “Order has no payable amount”.{' '}
          <button className="font-semibold underline" onClick={() => onGoto?.('catalog')}>
            Open Catalogue to fix it
          </button>
        </Notice>
      )}
      {missing === 0 && differs > 0 && (
        <Notice tone="warn" title={`${differs} product prices differ from the site`}>
          The database price is what customers are charged.{' '}
          <button className="font-semibold underline" onClick={() => onGoto?.('catalog')}>
            Review in Catalogue
          </button>
        </Notice>
      )}
      {Number(s.review_count) > 0 && (
        <Notice tone="warn" title={`${s.review_count} payment(s) need checking`}>
          The bank may have taken the money but the server could not verify the amount or the
          order. Check these in the KNET portal before refunding or re-charging.{' '}
          <button className="font-semibold underline" onClick={() => onGoto?.('orders', 'review')}>
            Show them
          </button>
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Revenue (paid)" value={kwd(s.paid_revenue)} sub={`${s.paid_count ?? 0} orders`} accent />
        <Kpi label="Today" value={kwd(s.revenue_today)} sub={`${s.paid_today ?? 0} paid today`} />
        <Kpi label="Last 7 days" value={kwd(s.revenue_7d)} sub={`${s.paid_7d ?? 0} paid`} />
        <Kpi
          label="Awaiting shipment"
          value={String(s.unfulfilled_count ?? 0)}
          sub="paid, not yet sent"
          warn={Number(s.unfulfilled_count) > 0}
        />
      </div>

      <Chart series={state.series} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Mini label="Pending" value={s.pending_count} />
        {/* pending+cod and pending+card are opposite jobs: one is money out with
            a driver, the other is a checkout to chase with the bank. One
            "Pending" number could not tell the operator which. */}
        <Mini
          label="Cash to collect"
          value={`${s.cod_awaiting_count ?? 0}`}
          sub={kwd(s.cod_awaiting_amount)}
          warn={Number(s.cod_awaiting_count) > 0}
        />
        <Mini label="Needs review" value={s.review_count} warn />
        <Mini label="Failed" value={s.failed_count} />
        <Mini label="Products live" value={state.catalog.length - missing} />
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, accent, warn }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        accent ? 'border-indigo-200 bg-indigo-50' : warn ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 text-xl font-extrabold tabular-nums lg:text-2xl ${
          accent ? 'text-indigo-700' : warn ? 'text-amber-700' : 'text-slate-800'
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

function Mini({ label, value, sub, warn }) {
  const n = Number(value ?? 0)
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${warn && n > 0 ? 'text-amber-600' : 'text-slate-800'}`}>{n}</p>
      {sub && <p className="text-xs tabular-nums text-slate-500">{sub}</p>}
    </div>
  )
}

// Daily paid revenue. Bars rather than a line: fourteen discrete days is not a
// continuous signal, and a zero day should read as an empty slot, not a dip.
function Chart({ series }) {
  if (!series?.length) return null
  const max = Math.max(...series.map((d) => Number(d.revenue) || 0), 1)
  const total = series.reduce((t, d) => t + Number(d.revenue || 0), 0)
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-slate-700">Paid revenue · last 14 days</h2>
        <span className="text-sm font-semibold tabular-nums text-slate-500">{kwd(total)}</span>
      </div>
      <div className="flex h-28 items-end gap-1.5">
        {series.map((d) => {
          const v = Number(d.revenue) || 0
          const pct = Math.round((v / max) * 100)
          const day = String(d.day).slice(5)
          return (
            <div key={d.day} className="group relative flex flex-1 flex-col items-center justify-end gap-1">
              <div
                className={`w-full rounded-t transition-colors ${v > 0 ? 'bg-indigo-500 group-hover:bg-indigo-600' : 'bg-slate-100'}`}
                style={{ height: `${Math.max(pct, 2)}%` }}
                title={`${day}: ${kwd(v)} · ${d.orders} order(s)`}
              />
              <span className="text-[10px] tabular-nums text-slate-400">{day.slice(3)}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function Notice({ tone = 'warn', title, children }) {
  const tones = {
    warn: 'border-amber-300 bg-amber-50 text-amber-900',
    error: 'border-rose-300 bg-rose-50 text-rose-900',
    info: 'border-indigo-200 bg-indigo-50 text-indigo-900',
  }
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`} role="status">
      {title && <p className="font-bold">{title}</p>}
      <div className="mt-1 text-sm leading-relaxed">{children}</div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="h-7 w-40 rounded bg-slate-200" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-slate-100" />
        ))}
      </div>
      <div className="h-40 rounded-xl bg-slate-100" />
    </div>
  )
}
