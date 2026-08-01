import { useCallback, useEffect, useState } from 'react'
import { fetchDiscounts, saveDiscount, setDiscountActive, deleteDiscount } from './api'
import { Notice } from './Overview'
import { formatKWD } from '../lib/format'
import { IconClose } from '../components/icons'

// Discount codes and automatic rules.
//
// Both live in one table because they are the same arithmetic — a window, a
// minimum, a limit, and money off — and two copies of that would drift. The
// only difference is whether the customer has to type something.
//
// EVERYTHING HERE IS APPLIED BY THE SERVER. The checkout may send a code; it
// may never send an amount. That is the same rule that stops the browser
// naming a price, and it matters more here, because a discount is a number the
// customer actively wants to be bigger. What this screen edits is the rule —
// never the total.
//
// Two ceilings, and they catch different mistakes:
//   * 90% per rule, which catches "100" typed for "10";
//   * 60% on the stack, which catches two sane rules adding up to a free order.
// The second lives in store.php because it is the one that has to hold when a
// rule this screen never saw meets a rule it did.

const kwd = (n) => formatKWD(Number(n ?? 0), 'en')

const BLANK = {
  id: 0, kind: 'code', code: '', label: '', type: 'percent', value: 10,
  min_order: 0, category: '', starts_at: '', ends_at: '', usage_limit: 0, active: true,
}

// datetime-local wants "YYYY-MM-DDTHH:MM"; MySQL gives "YYYY-MM-DD HH:MM:SS".
const toInput = (v) => (v ? String(v).replace(' ', 'T').slice(0, 16) : '')

export default function Discounts() {
  const [state, setState] = useState({ loading: true, rows: [] })
  const [editing, setEditing] = useState(null)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const r = await fetchDiscounts()
    setState({ loading: false, rows: r.rows, error: r.error, needsMigration: r.needsMigration })
  }, [])
  useEffect(() => { load() }, [load])

  async function toggle(d) {
    setState((s) => ({ ...s, rows: s.rows.map((x) => (x.id === d.id ? { ...x, active: !x.active } : x)) }))
    const r = await setDiscountActive(d.id, !d.active)
    if (r.error) { setMsg({ tone: 'error', text: r.error }) }
    load()
  }

  async function remove(d) {
    if (!window.confirm(`Delete “${d.label}”?`)) return
    const r = await deleteDiscount(d.id)
    if (r.error) setMsg({ tone: 'error', text: r.error })
    load()
  }

  if (state.loading) return <p className="text-sm text-slate-500">Loading…</p>
  if (state.needsMigration) {
    return (
      <Notice tone="warn" title="The discounts table is not installed yet">
        Import <code className="rounded bg-amber-100 px-1 font-mono text-[.85em]">api/promo.mysql.sql</code>{' '}
        once in phpMyAdmin — hPanel → Databases → phpMyAdmin → your database → Import. Safe to re-run.
      </Notice>
    )
  }
  if (state.error) return <Notice tone="error" title="Cannot load the discounts">{state.error}</Notice>

  const codes = state.rows.filter((d) => d.kind === 'code')
  const autos = state.rows.filter((d) => d.kind === 'auto')

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Discounts</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Codes the customer types, and rules that apply themselves.
          </p>
        </div>
        <button
          onClick={() => setEditing({ ...BLANK })}
          className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700"
        >
          New discount
        </button>
      </div>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Group
        title="Codes" note="The customer enters these at checkout."
        rows={codes} onEdit={setEditing} onToggle={toggle} onRemove={remove}
      />
      <Group
        title="Automatic" note="These apply themselves when an order qualifies — nothing to type."
        rows={autos} onEdit={setEditing} onToggle={toggle} onRemove={remove}
      />

      <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
        Automatic rules apply first, best one first, then at most one typed code. The total is
        capped at 60% of the order — the backstop against two reasonable discounts adding up to a
        free one. Checkout shows the customer exactly what was applied.
      </p>

      {editing && (
        <Editor
          value={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setMsg(null); load() }}
        />
      )}
    </div>
  )
}

function Group({ title, note, rows, onEdit, onToggle, onRemove }) {
  return (
    <section>
      <h2 className="font-bold text-slate-800">{title}</h2>
      <p className="mb-3 text-sm text-slate-500">{note}</p>
      {!rows.length ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          None yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-800">
                  {d.code && <code className="me-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">{d.code}</code>}
                  {d.label}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {d.type === 'percent' ? `${d.value}% off` : `${kwd(d.value)} off`}
                  {Number(d.min_order) > 0 && ` · orders over ${kwd(d.min_order)}`}
                  {d.category && ` · ${d.category} only`}
                  {d.usage_limit > 0 && ` · used ${d.used_count} of ${d.usage_limit}`}
                  {d.usage_limit === 0 && d.used_count > 0 && ` · used ${d.used_count}×`}
                </p>
                {(d.starts_at || d.ends_at) && (
                  <p className="mt-0.5 text-xs text-slate-400">
                    {d.starts_at ? `from ${toInput(d.starts_at).replace('T', ' ')}` : 'from now'}
                    {' · '}
                    {d.ends_at ? `until ${toInput(d.ends_at).replace('T', ' ')} UTC` : 'no end date'}
                  </p>
                )}
              </div>

              {/* `live` is the SERVER's answer, not a re-derivation here: an
                  expired discount that the admin renders as active is exactly
                  the disagreement that gets support calls. */}
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                d.live ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {d.live ? 'Live' : d.active ? 'Not live' : 'Off'}
              </span>

              <button onClick={() => onToggle(d)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300">
                {d.active ? 'Switch off' : 'Switch on'}
              </button>
              <button onClick={() => onEdit({ ...d, starts_at: toInput(d.starts_at), ends_at: toInput(d.ends_at), category: d.category ?? '' })}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300">
                Edit
              </button>
              <button onClick={() => onRemove(d)}
                className="rounded-lg px-2 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50">
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Editor({ value, onClose, onSaved }) {
  const [form, setForm] = useState(value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const r = await saveDiscount({ ...form, category: form.category || null })
    setBusy(false)
    if (r.error) setError(r.error)
    else onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 py-10">
      <form onSubmit={submit} className="w-full max-w-lg space-y-5 rounded-2xl bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">{form.id ? 'Edit discount' : 'New discount'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            <IconClose className="h-5 w-5" />
          </button>
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        <div className="grid grid-cols-2 gap-2">
          {[['code', 'A code they type'], ['auto', 'Applies itself']].map(([k, label]) => (
            <button
              key={k} type="button" onClick={() => set('kind', k)}
              aria-pressed={form.kind === k}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold ${
                form.kind === k ? 'border-indigo-500 bg-indigo-50 text-indigo-900' : 'border-slate-200 text-slate-700'
              }`}
            >{label}</button>
          ))}
        </div>

        {form.kind === 'code' && (
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Code</span>
            <input
              value={form.code}
              onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="SAVE10" required
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm uppercase outline-none focus:border-indigo-400"
            />
            <span className="mt-1 block text-xs text-slate-500">
              Letters and numbers only. Case does not matter to the customer — it is stored uppercase.
            </span>
          </label>
        )}

        <label className="block">
          <span className="text-xs font-semibold text-slate-600">Name</span>
          <input
            value={form.label} onChange={(e) => set('label', e.target.value)} required
            placeholder="10% welcome offer"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
          />
          <span className="mt-1 block text-xs text-slate-500">
            The customer sees this at checkout and on the invoice.
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Kind of discount</span>
            <select
              value={form.type} onChange={(e) => set('type', e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            >
              <option value="percent">Percentage off</option>
              <option value="fixed">Fixed amount off (KWD)</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">
              {form.type === 'percent' ? 'Percent (1–90)' : 'Amount in KWD'}
            </span>
            <input
              type="number" step={form.type === 'percent' ? '1' : '0.001'}
              min={form.type === 'percent' ? '1' : '0.001'} max={form.type === 'percent' ? '90' : undefined}
              value={form.value} onChange={(e) => set('value', e.target.value)} required
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Minimum order (KWD)</span>
            <input
              type="number" step="0.001" min="0" value={form.min_order}
              onChange={(e) => set('min_order', e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
            <span className="mt-1 block text-xs text-slate-500">0 means no minimum.</span>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Times it may be used</span>
            <input
              type="number" step="1" min="0" value={form.usage_limit}
              onChange={(e) => set('usage_limit', e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
            <span className="mt-1 block text-xs text-slate-500">0 means unlimited.</span>
          </label>
        </div>

        <label className="block">
          <span className="text-xs font-semibold text-slate-600">Only on one category (optional)</span>
          <input
            value={form.category} onChange={(e) => set('category', e.target.value)}
            placeholder="men"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Leave empty for the whole shop. When set, the discount is worked out on that
            category’s lines only, not on the whole order.
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Starts (UTC, optional)</span>
            <input
              type="datetime-local" value={form.starts_at} onChange={(e) => set('starts_at', e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Ends (UTC, optional)</span>
            <input
              type="datetime-local" value={form.ends_at} onChange={(e) => set('ends_at', e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
          </label>
        </div>
        <p className="-mt-2 text-xs text-slate-500">
          Times are UTC — Kuwait is UTC+3, so 18:00 UTC is 21:00 in Kuwait. Stated rather than
          guessed, because a promotion that starts three hours early is a price nobody meant to offer.
        </p>

        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox" checked={!!form.active}
            onChange={(e) => set('active', e.target.checked)}
            className="h-4 w-4 accent-indigo-600"
          />
          Switched on
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600">
            Cancel
          </button>
          <button disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
