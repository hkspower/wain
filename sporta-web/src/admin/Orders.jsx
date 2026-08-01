import { useCallback, useEffect, useState } from 'react'
import {
  fetchOrders, fetchOrderItems, setFulfilment, saveCustomer, setCodPaid, settleCard,
  toCsv, PAYMENT_STATES, FULFILMENT_STATES,
} from './api'
import { Notice } from './Overview'
import { formatKWD } from '../lib/format'
import { formatAddress } from '../lib/kuwait'
import { IconClose, IconSearch } from '../components/icons'

const kwd = (n) => formatKWD(Number(n ?? 0), 'en')
const when = (t) => (t ? new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

const PAY_TONE = {
  paid: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-slate-100 text-slate-600',
  review: 'bg-amber-100 text-amber-800',
  failed: 'bg-rose-100 text-rose-700',
}
const FUL_TONE = {
  unfulfilled: 'bg-indigo-100 text-indigo-700',
  packed: 'bg-sky-100 text-sky-700',
  shipped: 'bg-violet-100 text-violet-700',
  delivered: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate-100 text-slate-500',
}

export default function Orders({ initialPayment = 'all' }) {
  const [payment, setPayment] = useState(initialPayment)
  const [search, setSearch] = useState('')
  const [state, setState] = useState({ loading: true, orders: [] })
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const r = await fetchOrders({ payment, search })
    setState({ loading: false, orders: r.orders ?? [], error: r.error, needsMigration: r.needsMigration })
  }, [payment, search])

  useEffect(() => {
    const id = setTimeout(load, search ? 250 : 0) // debounce typing only
    return () => clearTimeout(id)
  }, [load, search])

  function exportCsv() {
    const blob = new Blob([toCsv(state.orders)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `sporta-orders-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const { orders } = state

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Orders</h1>
          <p className="mt-1 text-sm text-slate-500">
            {state.loading ? 'Loading…' : `${orders.length} order${orders.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Refresh
          </button>
          <button
            onClick={exportCsv}
            disabled={!orders.length}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {['all', ...PAYMENT_STATES].map((s) => (
          <button
            key={s}
            onClick={() => setPayment(s)}
            aria-pressed={payment === s}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold capitalize ${
              payment === s ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {s}
          </button>
        ))}
        <label className="relative ms-auto">
          <span className="sr-only">Search by track ID</span>
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-400">
            <IconSearch size={16} />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Track ID…"
            className="w-48 rounded-lg border border-slate-300 bg-white py-2 pe-3 ps-9 text-sm text-slate-800 outline-none focus:border-indigo-500"
          />
        </label>
      </div>

      {state.needsMigration && (
        <Notice tone="warn" title="Orders cannot be read yet">
          Run <code className="rounded bg-amber-100 px-1 font-mono text-[.85em]">api/schema.mysql.sql</code>{' '}
          in hPanel → Databases → phpMyAdmin. It creates the <code>orders</code> table; until it is
          applied there is nothing for the admin to read.
        </Notice>
      )}
      {state.error && <Notice tone="error" title="Query failed">{state.error}</Notice>}

      {!state.loading && !orders.length && !state.needsMigration && !state.error && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="font-semibold text-slate-700">No orders here yet</p>
          <p className="mt-1 text-sm text-slate-500">
            {payment === 'all'
              ? 'Orders appear the moment a customer starts checkout.'
              : `No orders with payment status “${payment}”.`}
          </p>
        </div>
      )}

      {orders.length > 0 && (
        <>
          <table className="admin-table w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 text-start font-semibold">Track ID</th>
                <th className="py-2 text-start font-semibold">Placed</th>
                <th className="py-2 text-start font-semibold">Customer</th>
                <th className="py-2 text-end font-semibold">Amount</th>
                <th className="py-2 text-start font-semibold">Payment</th>
                <th className="py-2 text-start font-semibold">Method</th>
                <th className="py-2 text-start font-semibold">Fulfilment</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => setOpen(o)}
                  className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="py-3 font-mono text-xs">{o.track_id}</td>
                  <td className="py-3 text-slate-500">{when(o.created_at)}</td>
                  <td className="py-3">{o.customer_name || <span className="text-slate-400">—</span>}</td>
                  <td className="py-3 text-end font-semibold tabular-nums">{kwd(o.amount)}</td>
                  <td className="py-3"><Badge tone={PAY_TONE[o.payment_status]}>{o.payment_status}</Badge></td>
                  <td className="py-3 text-xs font-semibold text-slate-500">
                    {{ cod: 'Cash', tpay: 'T-Pay', knet: 'KNET' }[o.payment_method] ?? o.payment_method}
                  </td>
                  <td className="py-3"><Badge tone={FUL_TONE[o.fulfilment_status]}>{o.fulfilment_status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="m-list">
            {orders.map((o) => (
              <button key={o.id} className="m-row w-full text-start" onClick={() => setOpen(o)}>
                <div className="m-row__top">
                  <span className="m-row__title">{o.customer_name || o.track_id}</span>
                  <Badge tone={PAY_TONE[o.payment_status]}>{o.payment_status}</Badge>
                  <span className="text-xs font-semibold text-slate-500">
                    {{ cod: 'Cash', tpay: 'T-Pay', knet: 'KNET' }[o.payment_method] ?? o.payment_method}
                  </span>
                </div>
                <div className="m-row__meta">
                  <span className="font-mono">{o.track_id}</span> · {kwd(o.amount)} · {o.fulfilment_status}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {open && <OrderDrawer order={open} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  )
}

function Badge({ tone, children }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold capitalize ${tone || 'bg-slate-100 text-slate-600'}`}>
      {children}
    </span>
  )
}

function OrderDrawer({ order, onClose, onChanged }) {
  const [items, setItems] = useState(null)
  const [busy, setBusy] = useState(false)
  const [cardRef, setCardRef] = useState('')  // the KNET payment id, typed from the portal
  const [err, setErr] = useState('')
  const CUSTOMER_FIELDS = [
    ['customer_name', 'Name'],
    ['customer_phone', 'Phone'],
    ['customer_area', 'Area'],
    ['customer_block', 'Block'],
    ['customer_street', 'Street'],
    ['customer_building', 'House / Building'],
    ['customer_floor', 'Floor'],
    ['customer_flat', 'Flat'],
    ['customer_note', 'Note'],
  ]
  const [cust, setCust] = useState(
    Object.fromEntries(CUSTOMER_FIELDS.map(([k]) => [k, order[k] ?? ''])),
  )
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetchOrderItems(order.id).then((r) => setItems(r.items))
  }, [order.id])

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  async function move(status) {
    setBusy(true); setErr('')
    const r = await setFulfilment(order.id, status)
    setBusy(false)
    if (r.error) return setErr(r.error)
    onChanged?.()
    onClose()
  }

  // Cash on delivery is the only payment the admin settles by hand — the card
  // methods are confirmed by the bank's callback. Kept out of `move` because it
  // does not close the drawer: after taking the cash the next thing the
  // operator usually does is mark the order delivered.
  async function settleCash(paid) {
    setBusy(true); setErr('')
    const r = await setCodPaid(order.id, paid)
    setBusy(false)
    if (r.needsMigration) {
      return setErr('The orders table is not installed yet — import api/schema.mysql.sql in phpMyAdmin.')
    }
    if (r.error) return setErr(r.error)
    onChanged?.()
  }

  // The card the bank took but never told us about. Deliberately gated on the
  // operator typing the KNET payment id: the whole point is that they have to
  // have looked it up in the portal first.
  async function settleTheCard() {
    setBusy(true); setErr('')
    const r = await settleCard(order.id, cardRef.trim())
    setBusy(false)
    if (r.error) return setErr(r.error)
    setCardRef('')
    onChanged?.()
  }

  async function persistCustomer() {
    setBusy(true); setErr(''); setSaved(false)
    const r = await saveCustomer(order.id, cust)
    setBusy(false)
    if (r.error) return setErr(r.error)
    setSaved(true)
    onChanged?.()
  }

  const wa = cust.customer_phone.replace(/[^0-9]/g, '')

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Order ${order.track_id}`}
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <p className="font-mono text-sm font-bold text-slate-800">{order.track_id}</p>
            <p className="text-xs text-slate-500">{when(order.created_at)}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            <IconClose size={20} />
          </button>
        </header>

        <div className="space-y-6 px-5 py-5">
          {order.payment_status === 'review' && (
            <Notice tone="warn" title="This payment could not be verified">
              The bank may have captured it. Check payment ID{' '}
              <code className="font-mono">{order.cbk_paymentid || '—'}</code> in the KNET portal
              before refunding or asking the customer to pay again.
            </Notice>
          )}

          <section className="grid grid-cols-2 gap-3">
            <Field label="Amount" value={kwd(order.amount)} strong />
            <Field label="Paid at" value={when(order.paid_at)} />
            <Field label="Payment" value={order.payment_status} />
            <Field label="Method" value={{ cod: 'Cash on delivery', tpay: 'CBK T-Pay (online payment link)', knet: 'KNET / card' }[order.payment_method] ?? order.payment_method} />
            <Field label="Fulfilment" value={order.fulfilment_status} />
            <Field label="KNET payment ID" value={order.cbk_paymentid || '—'} mono />
            <Field label="KNET reference" value={order.cbk_reference || '—'} mono />
          </section>

          <section>
            <h3 className="mb-2 text-sm font-bold text-slate-700">Items</h3>
            {items === null ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : items.length === 0 ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                No line items. The order was created but its products were never matched — usually
                because the catalogue was not in the database at the time.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-slate-700">
                      {it.products?.name_en ?? 'Unknown'} <span className="text-slate-400">× {it.qty}</span>
                    </span>
                    <span className="font-semibold tabular-nums">{kwd(it.unit_price * it.qty)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-bold text-slate-700">Customer</h3>
            {/* The one line the courier actually needs, in the order a Kuwaiti
                address is read out. Selectable so it can be pasted into a
                delivery app or a WhatsApp message. */}
            {formatAddress(order) && (
              <p className="mb-3 select-all rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {formatAddress(order)}
              </p>
            )}
            <div className="grid gap-2">
              {CUSTOMER_FIELDS.map(([k, label]) => (
                <label key={k} className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-500">{label}</span>
                  <input
                    value={cust[k]}
                    onChange={(e) => { setCust({ ...cust, [k]: e.target.value }); setSaved(false) }}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={persistCustomer}
                disabled={busy}
                className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Save details
              </button>
              {wa.length >= 8 && (
                <a
                  href={`https://wa.me/${wa.startsWith('965') ? wa : '965' + wa}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
                >
                  WhatsApp
                </a>
              )}
              {saved && <span className="text-sm font-semibold text-emerald-600">Saved</span>}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Captured at checkout. Blank on orders placed before checkout started asking.
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-bold text-slate-700">Move fulfilment to</h3>
            <div className="flex flex-wrap gap-2">
              {FULFILMENT_STATES.filter((s) => s !== order.fulfilment_status).map((s) => (
                <button
                  key={s}
                  onClick={() => move(s)}
                  disabled={busy}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold capitalize text-slate-700 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
            {/* Cash on delivery: the money arrives at the door, so this is the
                one payment the admin confirms. Previously this panel printed
                "mark it paid" with no control that could — every cash order
                stayed pending and its revenue never reached the dashboard. */}
            {order.payment_method === 'cod' && order.payment_status === 'pending' && (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs text-emerald-900">
                  Cash on delivery — the driver collects <strong>{kwd(order.amount)}</strong> at the door.
                </p>
                <button
                  onClick={() => settleCash(true)}
                  disabled={busy}
                  className="mt-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  {busy ? 'Saving…' : `Cash collected — mark paid (${kwd(order.amount)})`}
                </button>
              </div>
            )}
            {/* A card order that is not paid. KPG reports the result through
                the customer's browser, so a closed tab or a dropped connection
                leaves the money at the bank and the order here — the one
                failure mode this integration cannot design away. The operator
                confirms it in the KNET portal and types the payment id; nothing
                settles without it. */}
            {order.payment_method !== 'cod' && order.payment_status !== 'paid' && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs text-amber-900">
                  Did the bank actually take this payment? Find the order in the{' '}
                  <strong>KNET portal</strong>, then enter its payment ID to settle it here.
                  {order.cbk_paymentid ? (
                    <> The gateway reported <code className="font-mono">{order.cbk_paymentid}</code>.</>
                  ) : null}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    value={cardRef}
                    onChange={(e) => setCardRef(e.target.value)}
                    placeholder="KNET payment ID"
                    aria-label="KNET payment ID"
                    className="min-w-[12rem] flex-1 rounded-lg border border-amber-300 px-3 py-2 font-mono text-sm outline-none focus:border-amber-500"
                  />
                  <button
                    onClick={settleTheCard}
                    disabled={busy || cardRef.trim().length < 6}
                    className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-40"
                  >
                    {busy ? 'Saving…' : `Confirm paid (${kwd(order.amount)})`}
                  </button>
                </div>
                <p className="mt-2 text-[0.7rem] text-amber-800">
                  Recorded as a manual settlement, never as a bank callback.
                </p>
              </div>
            )}
            {order.payment_method === 'cod' && order.payment_status === 'paid' && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-600">
                  Cash recorded as collected{order.paid_at ? ` on ${when(order.paid_at)}` : ''}.
                </p>
                <button
                  onClick={() => settleCash(false)}
                  disabled={busy}
                  className="mt-2 text-xs font-semibold text-rose-700 underline hover:text-rose-800 disabled:opacity-40"
                >
                  Undo — cash was not collected
                </button>
              </div>
            )}
            {order.payment_status !== 'paid' && order.payment_method !== 'cod' && (
              <p className="mt-2 text-xs text-amber-700">
                This order is not marked paid — confirm the payment with the bank before shipping.
              </p>
            )}
          </section>

          {err && <Notice tone="error" title="Could not save">{err}</Notice>}
        </div>
      </aside>
    </div>
  )
}

function Field({ label, value, mono, strong }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`${mono ? 'font-mono text-xs' : 'text-sm'} ${strong ? 'text-base font-bold' : ''} capitalize text-slate-800`}>
        {value}
      </p>
    </div>
  )
}
