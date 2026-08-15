import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchVariants, setStock } from './api'
import { AHED_FX, ahedCostKwd, AHED_COLLECTIONS } from '../lib/ahed'
import { formatKWD } from '../lib/format'
import { Notice } from './Overview'

const kwd = (n) => formatKWD(Number(n ?? 0), 'en')

// Stock, per size, for the AHED shipment — and the one number the owner could
// not see anywhere before: what each piece cost against what it sells for.
//
// The invoice is in dirhams and the shop prices in dinars, so margin needs a
// rate; it is stated on screen rather than hidden in the arithmetic, because it
// drifts and the owner is the one who knows when it has.
export default function Inventory() {
  const [state, setState] = useState({ loading: true, rows: [] })
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState('')
  const [onlyProblems, setOnlyProblems] = useState(false)

  const load = useCallback(async () => {
    const r = await fetchVariants()
    setState({ loading: false, ...r })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const rows = useMemo(() => {
    const withMargin = (state.rows ?? []).map((r) => {
      const cost = ahedCostKwd(r.sku)
      const price = Number(r.price ?? 0)
      return {
        ...r,
        cost,
        price,
        // Margin per piece, in dinars. Null when we do not know the cost, which
        // is not the same as zero and must not be drawn as a healthy 0%.
        profit: cost == null ? null : price - cost,
        pct: cost == null || cost === 0 ? null : Math.round(((price - cost) / cost) * 100),
      }
    })
    return onlyProblems
      ? withMargin.filter((r) => r.stock === 0 || (r.profit != null && r.profit <= 0))
      : withMargin
  }, [state.rows, onlyProblems])

  const totals = useMemo(() => {
    const all = state.rows ?? []
    const pieces = all.reduce((n, r) => n + Number(r.stock || 0), 0)
    const received = all.reduce((n, r) => n + Number(r.received || 0), 0)
    const costHeld = all.reduce((n, r) => n + (ahedCostKwd(r.sku) ?? 0) * Number(r.stock || 0), 0)
    const retail = all.reduce((n, r) => n + Number(r.price || 0) * Number(r.stock || 0), 0)
    const soldOut = all.filter((r) => Number(r.stock) === 0).length
    const belowCost = all.filter((r) => {
      const c = ahedCostKwd(r.sku)
      return c != null && Number(r.price) <= c
    })
    return { pieces, received, costHeld, retail, soldOut, belowCost }
  }, [state.rows])

  async function save(sku, value) {
    const n = Number(value)
    if (!Number.isInteger(n) || n < 0) {
      setMsg('Stock must be a whole number, zero or more.')
      return
    }
    setBusy(sku)
    setMsg('')
    const r = await setStock(sku, n)
    setBusy(null)
    if (r.error) {
      setMsg(r.error)
      return
    }
    if (r.needsMigration) {
      await load()
      return
    }
    setState((s) => ({
      ...s,
      rows: s.rows.map((row) => (row.sku === sku ? { ...row, stock: n } : row)),
    }))
  }

  if (state.loading) return <div className="h-40 rounded-xl bg-slate-100" aria-busy="true" />
  if (state.error) return <Notice tone="error" title="Cannot load inventory">{state.error}</Notice>

  if (state.needsMigration) {
    return (
      <Notice tone="warn" title="Inventory table not created yet">
        <p>
          Run <code className="rounded bg-amber-100 px-1 font-mono text-[.85em]">api/schema.mysql.sql</code>{' '}
          in hPanel → Databases → phpMyAdmin. It creates <code>product_variants</code> and loads the AHED
          packing slip — 42 sizes across 27 products, 48 pieces.
        </p>
        <p className="mt-2">
          Until then a product page offers every size, whether or not the shop has it.
        </p>
      </Notice>
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">Inventory</h1>
        <p className="mt-1 text-sm text-slate-500">
          AHED shipment, {AHED_FX.asOf}. Stock is what the shop holds now; a size at zero is struck
          out and cannot be bought.
        </p>
      </header>

      {/* Money out versus money in, on what is actually on the shelf. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Pieces in stock" value={String(totals.pieces)} sub={`${totals.received} received`} />
        <Tile label="Cost of stock held" value={kwd(totals.costHeld)} sub={`at ${AHED_FX.aedPerKwd} AED/KWD`} />
        <Tile label="Retail value" value={kwd(totals.retail)} sub="if it all sells" accent />
        <Tile
          label="Sold-out sizes"
          value={String(totals.soldOut)}
          sub={totals.soldOut ? 'not buyable' : 'all sizes available'}
          warn={totals.soldOut > 0}
        />
      </div>

      {/* The finding that pays for this screen. Prices in the catalogue were
          placeholders, and some of them are under what AHED charged. */}
      {totals.belowCost.length > 0 && (
        <Notice
          tone="error"
          title={`${totals.belowCost.length} size(s) are priced at or below what they cost`}
        >
          Every sale of these loses money. Wholesale is converted at{' '}
          {AHED_FX.aedPerKwd} AED to the dinar — if that rate is stale, correct it in{' '}
          <code className="rounded bg-rose-100 px-1 font-mono text-[.85em]">data/ahed.json</code>.
          Otherwise raise the price in Catalogue: the database price is what customers are charged.
        </Notice>
      )}

      {msg && <Notice tone="error" title="Could not save">{msg}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={onlyProblems}
            onChange={(e) => setOnlyProblems(e.target.checked)}
            className="h-4 w-4 accent-indigo-600"
          />
          Only sold out or losing money
        </label>
        <button onClick={load} className="text-sm font-semibold text-indigo-600 underline">
          Refresh
        </button>
      </div>

      <table className="admin-table w-full text-sm">
        <thead>
          <tr className="text-start text-xs uppercase tracking-wide text-slate-500">
            <Th>Product</Th>
            <Th>Size</Th>
            <Th>Item code</Th>
            <Th right>Stock</Th>
            <Th right>Cost</Th>
            <Th right>Price</Th>
            <Th right>Margin</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.sku} className={r.stock === 0 ? 'bg-slate-50/70' : undefined}>
              <td className="py-2 pe-3 font-semibold text-slate-800">
                {r.name_en}
                <span className="ms-2 text-xs font-normal text-slate-400">
                  {AHED_COLLECTIONS[r.collection]?.name.en ?? r.collection}
                </span>
              </td>
              <td className="py-2 pe-3 font-bold text-slate-700">{r.size}</td>
              <td className="py-2 pe-3 font-mono text-xs text-slate-500">{r.sku}</td>
              <td className="py-2 pe-3 text-end">
                <StockCell row={r} busy={busy === r.sku} onSave={(v) => save(r.sku, v)} />
              </td>
              <td className="py-2 pe-3 text-end tabular-nums text-slate-500">
                {r.cost == null ? '—' : kwd(r.cost)}
              </td>
              <td className="py-2 pe-3 text-end tabular-nums text-slate-700">{kwd(r.price)}</td>
              <td className="py-2 text-end tabular-nums">
                {r.profit == null ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <span className={r.profit <= 0 ? 'font-bold text-rose-600' : 'font-semibold text-emerald-700'}>
                    {kwd(r.profit)}
                    <span className="ms-1 text-xs font-normal opacity-70">
                      {r.pct == null ? '' : `${r.pct > 0 ? '+' : ''}${r.pct}%`}
                    </span>
                  </span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="py-6 text-center text-slate-500">
                Nothing to show — no size is sold out and nothing is priced under cost.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* .admin-table is display:none below 768px (admin-mobile.css), so a table
          on its own is a blank screen on a phone — which is where the owner
          counts stock. Same rows, stacked. */}
      <div className="m-list">
        {rows.map((r) => (
          <div key={r.sku} className="m-row">
            <div className="m-row__top">
              <span className="m-row__title">{r.name_en}</span>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                {r.size}
              </span>
            </div>
            <div className="m-row__meta flex items-center justify-between gap-3">
              <span className="font-mono text-xs">{r.sku}</span>
              <StockCell row={r} busy={busy === r.sku} onSave={(v) => save(r.sku, v)} />
            </div>
            <div className="m-row__meta flex flex-wrap items-baseline gap-x-3">
              <span>Cost {r.cost == null ? '—' : kwd(r.cost)}</span>
              <span>Price {kwd(r.price)}</span>
              {r.profit != null && (
                <span className={r.profit <= 0 ? 'font-bold text-rose-600' : 'font-semibold text-emerald-700'}>
                  {r.profit <= 0 ? 'Loses ' : 'Makes '}
                  {kwd(Math.abs(r.profit))}
                </span>
              )}
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">
            Nothing to show — no size is sold out and nothing is priced under cost.
          </p>
        )}
      </div>
    </div>
  )
}

// A stock count is edited far more often than it is read, so it is an input in
// the row rather than a modal. Commits on blur or Enter; Escape puts it back.
function StockCell({ row, busy, onSave }) {
  const [value, setValue] = useState(String(row.stock))
  useEffect(() => setValue(String(row.stock)), [row.stock])

  const commit = () => {
    if (String(row.stock) !== value.trim()) onSave(value.trim())
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {row.stock === 0 && <span className="text-xs font-bold text-rose-600">OUT</span>}
      <input
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setValue(String(row.stock))
        }}
        disabled={busy}
        inputMode="numeric"
        aria-label={`Stock for ${row.name_en} size ${row.size}`}
        className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-end font-bold tabular-nums outline-none focus:border-indigo-500 disabled:opacity-50"
      />
    </span>
  )
}

function Th({ children, right }) {
  return <th className={`pb-2 font-semibold ${right ? 'text-end' : 'text-start'}`}>{children}</th>
}

function Tile({ label, value, sub, accent, warn }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        accent
          ? 'border-indigo-200 bg-indigo-50'
          : warn
            ? 'border-amber-200 bg-amber-50'
            : 'border-slate-200 bg-white'
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 text-xl font-extrabold tabular-nums ${
          accent ? 'text-indigo-700' : warn ? 'text-amber-700' : 'text-slate-800'
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  )
}
