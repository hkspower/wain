import { useCallback, useEffect, useState } from 'react'
import { fetchAllProducts, saveProduct, fetchSlides, saveSettings } from './api'
import { Notice } from './Overview'
import { formatKWD } from '../lib/format'

// Promotions: what the shop is pushing right now.
//
// Three things, because they are the three surfaces a promotion actually uses:
//   * a SALE PRICE on a product — "was 12.000, now 9.000", optionally dated;
//   * FEATURED products — the row the home page leads with;
//   * the PROMO BAR — the strip across the top of every page.
//
// The sale price is the one with teeth. It is not a label: checkout charges it,
// computed on the server from the same row the shop displays, so the price the
// customer sees and the price the bank is asked for cannot disagree. And it is
// stored ALONGSIDE the list price rather than replacing it, so ending a sale is
// switching it off — nobody has to remember what the original price was.

const kwd = (n) => formatKWD(Number(n ?? 0), 'en')
const toInput = (v) => (v ? String(v).replace(' ', 'T').slice(0, 16) : '')

export default function Promotions() {
  const [state, setState] = useState({ loading: true, rows: [] })
  const [bar, setBar] = useState(null)
  const [msg, setMsg] = useState(null)
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const [p, s] = await Promise.all([fetchAllProducts(), fetchSlides()])
    setState({ loading: false, rows: p.rows, error: p.error, needsMigration: p.needsMigration })
    if (s.hero) setBar(null) // hero settings belong to the Slides screen
  }, [])
  useEffect(() => { load() }, [load])

  // The promo bar rides on the same settings table the slider does, but it is
  // fetched with the public slides payload so this screen does not need a
  // fourth endpoint for one record.
  useEffect(() => {
    let alive = true
    fetch(`${(window.SPORTA_CONFIG?.phpApiUrl || '/api').replace(/\/$/, '')}/api.php?r=slides`)
      .then((r) => r.json())
      .then((d) => { if (alive && d?.promo_bar) setBar({ ...d.promo_bar, starts_at: '', ends_at: '' }) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  async function saveBar(next) {
    setBar(next)
    const r = await saveSettings('promo_bar', next)
    setMsg(r.error ? { tone: 'error', text: r.error } : { tone: 'ok', text: 'Promo bar saved.' })
  }

  async function patchProduct(p, patch) {
    // saveProduct is a full save, so the row is sent back whole with the one
    // field changed. Sending a partial would blank everything omitted.
    const r = await saveProduct({
      ...p,
      sale_price: p.sale_price ?? '',
      sale_starts_at: toInput(p.sale_starts_at),
      sale_ends_at: toInput(p.sale_ends_at),
      ...patch,
    })
    if (r.error) { setMsg({ tone: 'error', text: r.error }); return false }
    setMsg(null)
    load()
    return true
  }

  if (state.loading) return <p className="text-sm text-slate-500">Loading…</p>
  if (state.needsMigration) {
    return (
      <Notice tone="warn" title="The promotions columns are not installed yet">
        Import <code className="rounded bg-amber-100 px-1 font-mono text-[.85em]">api/promo.mysql.sql</code>{' '}
        once in phpMyAdmin — hPanel → Databases → phpMyAdmin → your database → Import. Safe to re-run.
      </Notice>
    )
  }
  if (state.error) return <Notice tone="error" title="Cannot load the catalogue">{state.error}</Notice>

  const onSale = state.rows.filter((p) => p.sale_price)
  const featured = state.rows.filter((p) => Number(p.featured))
  const search = q.trim().toLowerCase()
  const matches = search
    ? state.rows.filter((p) => `${p.name_en} ${p.name_ar} ${p.slug}`.toLowerCase().includes(search))
    : []

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Promotions</h1>
        <p className="mt-0.5 text-sm text-slate-500">Sale prices, the featured row, and the bar across the top.</p>
      </div>

      {msg && <Notice tone={msg.tone === 'ok' ? 'ok' : 'error'}>{msg.text}</Notice>}

      {/* ------------------------------------------------------- the promo bar */}
      {bar && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-bold text-slate-800">The bar across the top</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Seen on every page, in both languages. Leave a line empty and that language shows nothing.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">English</span>
              <input
                value={bar.text_en ?? ''} onChange={(e) => setBar({ ...bar, text_en: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Arabic</span>
              <input
                dir="rtl" value={bar.text_ar ?? ''} onChange={(e) => setBar({ ...bar, text_ar: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
            </label>
          </div>

          <label className="mt-3 block">
            <span className="text-xs font-semibold text-slate-600">Links to (optional)</span>
            <input
              value={bar.href ?? ''} onChange={(e) => setBar({ ...bar, href: e.target.value })}
              placeholder="/shop"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
            <span className="mt-1 block text-xs text-slate-500">
              A path on this site. Links to other sites are refused.
            </span>
          </label>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox" checked={!!bar.enabled}
                onChange={(e) => setBar({ ...bar, enabled: e.target.checked })}
                className="h-4 w-4 accent-indigo-600"
              />
              Show the bar
            </label>
            <button
              onClick={() => saveBar(bar)}
              className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700"
            >
              Save the bar
            </button>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------ on sale */}
      <section>
        <h2 className="font-bold text-slate-800">On sale</h2>
        <p className="mb-3 text-sm text-slate-500">
          Checkout charges the sale price. The old price stays on the row, so ending a sale is one click.
        </p>
        {!onSale.length ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            Nothing is on sale. Find a product below to put one on.
          </p>
        ) : (
          <ul className="space-y-2">
            {onSale.map((p) => <SaleRow key={p.id} p={p} onPatch={patchProduct} />)}
          </ul>
        )}
      </section>

      {/* ----------------------------------------------------------- featured */}
      <section>
        <h2 className="font-bold text-slate-800">Featured</h2>
        <p className="mb-3 text-sm text-slate-500">
          The row the home page leads with. Lowest number first.
        </p>
        {!featured.length ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            Nothing featured yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {featured
              .sort((a, b) => (a.featured_sort ?? 0) - (b.featured_sort ?? 0))
              .map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                  <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">{p.name_en}</span>
                  <label className="flex items-center gap-2 text-xs text-slate-500">
                    Order
                    <input
                      type="number" step="1" defaultValue={p.featured_sort ?? 0}
                      onBlur={(e) => {
                        const v = Number(e.target.value)
                        if (v !== (p.featured_sort ?? 0)) patchProduct(p, { featured_sort: v })
                      }}
                      className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <button
                    onClick={() => patchProduct(p, { featured: false })}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300"
                  >
                    Remove
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------- picker */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold text-slate-800">Put a product on sale, or feature it</h2>
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search the catalogue…"
          className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
        />
        {search && !matches.length && (
          <p className="mt-3 text-sm text-slate-500">Nothing matches “{q}”.</p>
        )}
        {!!matches.length && (
          <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto">
            {matches.slice(0, 40).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 p-2.5">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{p.name_en}</span>
                <span className="text-sm text-slate-500">{kwd(p.price)}</span>
                <button
                  onClick={() => patchProduct(p, { featured: !Number(p.featured) })}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                    Number(p.featured)
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                      : 'border-slate-200 text-slate-700'
                  }`}
                >
                  {Number(p.featured) ? 'Featured' : 'Feature'}
                </button>
                <SaleButton p={p} onPatch={patchProduct} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function SaleButton({ p, onPatch }) {
  const [open, setOpen] = useState(false)
  const [price, setPrice] = useState('')
  if (p.sale_price) {
    return (
      <button
        onClick={() => onPatch(p, { sale_price: '' })}
        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800"
      >
        End sale
      </button>
    )
  }
  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700">
        Put on sale
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="number" step="0.001" autoFocus value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder={`< ${p.price}`}
        className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
      />
      <button
        onClick={async () => { if (await onPatch(p, { sale_price: price })) setOpen(false) }}
        className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-bold text-white"
      >Set</button>
      <button onClick={() => setOpen(false)} className="px-1 text-xs text-slate-500">Cancel</button>
    </span>
  )
}

function SaleRow({ p, onPatch }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-slate-800">{p.name_en}</p>
        <p className="mt-0.5 text-sm">
          <span className="text-slate-400 line-through">{kwd(p.price)}</span>
          <span className="ms-2 font-bold text-emerald-700">{kwd(p.sale_price)}</span>
          <span className="ms-2 text-xs text-slate-500">
            {Math.round((1 - Number(p.sale_price) / Number(p.price)) * 100)}% off
          </span>
        </p>
        <p className="mt-0.5 text-xs text-slate-400">
          {p.sale_starts_at ? `from ${toInput(p.sale_starts_at).replace('T', ' ')}` : 'live now'}
          {' · '}
          {p.sale_ends_at ? `until ${toInput(p.sale_ends_at).replace('T', ' ')} UTC` : 'no end date'}
        </p>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        Ends
        <input
          type="datetime-local" defaultValue={toInput(p.sale_ends_at)}
          onBlur={(e) => {
            if (e.target.value !== toInput(p.sale_ends_at)) onPatch(p, { sale_ends_at: e.target.value })
          }}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
        />
      </label>
      <button
        onClick={() => onPatch(p, { sale_price: '' })}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300"
      >
        End sale
      </button>
    </li>
  )
}
