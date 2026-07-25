import { useCallback, useEffect, useState } from 'react'
import { fetchCatalogState, syncCatalog } from './api'
import { Notice } from './Overview'
import { formatKWD } from '../lib/format'
import Products from './Products'

const kwd = (n) => formatKWD(Number(n ?? 0), 'en')

// The catalogue lives in two places: the JS the site ships with, and the
// products table Supabase prices orders from. Only the table matters at
// checkout, so this screen exists to make any divergence between them visible
// and fixable in one action.
export default function Catalog() {
  const [state, setState] = useState({ loading: true })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const load = useCallback(async () => {
    setState({ loading: true })
    const r = await fetchCatalogState()
    setState({ loading: false, rows: r.rows ?? [], extra: r.extra ?? [], error: r.error, needsMigration: r.needsMigration })
  }, [])

  useEffect(() => { load() }, [load])

  async function push() {
    setBusy(true); setResult(null)
    const r = await syncCatalog()
    setBusy(false)
    setResult(r.error ? { error: r.error } : { ok: r.count })
    if (!r.error) load()
  }

  if (state.loading) return <p className="text-slate-400">Loading catalogue…</p>

  const rows = state.rows ?? []
  const missing = rows.filter((r) => r.state === 'missing')
  const differs = rows.filter((r) => r.state === 'differs')
  const synced = rows.length - missing.length - differs.length

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">Catalogue</h1>
        <p className="mt-1 text-sm text-slate-500">
          What the site ships with, compared against what the database will charge.
        </p>
      </header>

      {state.error && <Notice tone="error" title="Cannot read products">{state.error}</Notice>}
      {state.needsMigration && (
        <Notice tone="warn" title="Run the migration first">
          <code className="rounded bg-amber-100 px-1 font-mono text-[.85em]">supabase/schema.sql</code>{' '}
          creates the products table.
        </Notice>
      )}

      {missing.length > 0 ? (
        <Notice tone="error" title={`${missing.length} product(s) missing from the database`}>
          Checkout prices every order from this table. While a product is missing, any cart
          containing it produces a zero total and the payment is refused with “Order has no
          payable amount”. Pushing the catalogue below fixes it.
        </Notice>
      ) : differs.length > 0 ? (
        <Notice tone="warn" title={`${differs.length} price(s) differ`}>
          Customers are charged the database price, not the price shown in the table below.
        </Notice>
      ) : (
        <Notice tone="info" title="Catalogue is in sync">
          All {rows.length} products exist in the database at the expected price.
        </Notice>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-bold text-slate-800">Push the site catalogue to Supabase</p>
            <p className="mt-0.5 text-sm text-slate-500">
              Inserts what is missing and updates what differs, matching on slug. Re-running it is
              safe — it never creates duplicates and never deletes anything.
            </p>
          </div>
          <button
            onClick={push}
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {busy ? 'Pushing…' : `Push ${rows.length} products`}
          </button>
        </div>
        {result?.ok && (
          <p className="mt-3 text-sm font-semibold text-emerald-600">
            Synced {result.ok} products. Checkout can price orders now.
          </p>
        )}
        {result?.error && <p className="mt-3 text-sm font-semibold text-rose-600">{result.error}</p>}
        <p className="mt-3 text-xs text-slate-400">
          Product images are not pushed: the built-in artwork is a placeholder embedded in the
          page, not a URL. Add real photo URLs per product below once you have them.
        </p>
      </section>

      <section>
        <div className="mb-2 flex items-baseline gap-3">
          <h2 className="text-sm font-bold text-slate-700">Comparison</h2>
          <span className="text-xs text-slate-500">
            {synced} in sync · {differs.length} differ · {missing.length} missing
          </span>
        </div>
        <table className="admin-table w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 text-start font-semibold">Product</th>
              <th className="py-2 text-start font-semibold">Slug</th>
              <th className="py-2 text-end font-semibold">Site price</th>
              <th className="py-2 text-end font-semibold">Database</th>
              <th className="py-2 text-start font-semibold">State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug} className="border-b border-slate-100">
                <td className="py-2.5">{r.name_en}</td>
                <td className="py-2.5 font-mono text-xs text-slate-500">{r.slug}</td>
                <td className="py-2.5 text-end tabular-nums">{kwd(r.price)}</td>
                <td className="py-2.5 text-end tabular-nums">
                  {r.remotePrice == null ? <span className="text-slate-300">—</span> : kwd(r.remotePrice)}
                </td>
                <td className="py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                      r.state === 'ok' ? 'bg-emerald-100 text-emerald-800'
                        : r.state === 'differs' ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-700'
                    }`}
                  >
                    {r.state === 'ok' ? 'in sync' : r.state}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="m-list">
          {rows.map((r) => (
            <div key={r.slug} className="m-row">
              <div className="m-row__top">
                <span className="m-row__title">{r.name_en}</span>
                <span
                  className={`m-row__badge ${
                    r.state === 'ok' ? 'm-row__badge--paid' : r.state === 'differs' ? 'm-row__badge--pending' : 'm-row__badge--failed'
                  }`}
                >
                  {r.state === 'ok' ? 'in sync' : r.state}
                </span>
              </div>
              <div className="m-row__meta">
                <span className="font-mono">{r.slug}</span> · site {kwd(r.price)}
                {r.remotePrice != null && ` · db ${kwd(r.remotePrice)}`}
              </div>
            </div>
          ))}
        </div>

        {state.extra?.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            {state.extra.length} product(s) exist only in the database and not on the site:{' '}
            <span className="font-mono">{state.extra.join(', ')}</span>. They are left untouched.
          </p>
        )}
      </section>

      <section className="border-t border-slate-200 pt-6">
        <Products />
      </section>
    </div>
  )
}
