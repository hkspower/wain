import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchOrders, fetchOrderItems, setFulfilment, saveCustomer, setCodPaid, settleCard,
  blockCustomer, fetchBlocked, toCsv, PAYMENT_STATES, FULFILMENT_STATES,
} from './api'
import { Notice } from './Notice'
import { formatKWD } from '../lib/format'
import { formatAddress } from '../lib/kuwait'
import { IconClose, IconSearch } from '../components/icons'

const kwd = (n) => formatKWD(Number(n ?? 0), 'en')
const when = (t) => (t ? new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

const NOT_MIGRATED = 'The database for this is not installed yet. Import the schema in phpMyAdmin, then try again. / قاعدة البيانات لهذه الميزة غير مثبّتة بعد. استورد المخطط في phpMyAdmin ثم أعد المحاولة.'
const NOT_RECORDED = 'Nothing was recorded. Try again. / لم يُسجَّل شيء. حاول مرة أخرى.'
// The sentence for a write or read that did not go through, or '' when it did.
// api.js gives a signed-out answer a sentence in `error`, but a missing table
// comes back as { needsMigration } with none, so a check on `error` alone
// reported that save as done.
function failureOf(r) {
  if (r.needsMigration) return NOT_MIGRATED
  return r.error || ''
}

// The Kuwaiti number as the server keeps it (store_phone in store.php): digits
// only, Arabic-Indic and Persian digits read as ASCII, and a 00965 or a 965 in
// front of a longer number taken as the country code. What is left is the
// 8-digit local number, so a local 9-series mobile that starts with 965 keeps
// all of its digits.
function kwLocalPhone(raw) {
  const ascii = String(raw ?? '')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0))
  let d = ascii.replace(/\D/g, '')
  if (d.startsWith('00965')) d = d.slice(5)
  else if (d.length > 8 && d.startsWith('965')) d = d.slice(3)
  return d
}

const PAY_TONE = {
  paid: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-slate-100 text-slate-600',
  review: 'bg-amber-100 text-amber-800',
  failed: 'bg-rose-100 text-rose-700',
  // Closed payments. admin.php accepts both as filters, so they need a tone of
  // their own rather than the grey default.
  refunded: 'bg-violet-100 text-violet-800',
  voided: 'bg-zinc-200 text-zinc-800',
}
// Every payment state the server filters on. api.js PAYMENT_STATES lists only
// the four a checkout produces; refunded and voided are added here so the
// owner can find them without switching to All.
const PAYMENT_FILTERS = [...PAYMENT_STATES, 'refunded', 'voided']
// The newest rows one request asks for (admin.php caps it at 500). This screen
// cannot page further yet, so a full page means there may be more orders.
const ORDER_LIMIT = 500

// The calendar date in Kuwait (UTC+3). An export made at 01:00 on the 13th
// must be named for the 13th, not for the UTC day before.
function kuwaitDate(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuwait', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const part = (type) => parts.find((p) => p.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
const FUL_TONE = {
  unfulfilled: 'bg-indigo-100 text-indigo-700',
  packed: 'bg-sky-100 text-sky-700',
  shipped: 'bg-violet-100 text-violet-700',
  delivered: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate-100 text-slate-600',
}
// What a fulfilment change sends or releases, read out before the tap is taken.
// admin.php queues the shopper's WhatsApp on shipped and the review invitation
// on delivered, and cancelled queues the warehouse's do-not-ship and releases
// the order's held stock. None of it can be taken back from this screen.
const FUL_CONFIRM = {
  shipped: 'Mark as shipped? The customer is sent a shipping message on WhatsApp. / تأكيد الشحن؟ سيُرسَل للعميل رسالة شحن عبر واتساب.',
  delivered: 'Mark as delivered? The customer is sent a review invitation, so only do this once the parcel is in their hands. / تأكيد التسليم؟ سيُرسَل للعميل طلب تقييم، لذا لا تفعل ذلك إلا بعد وصول الطرد إليه.',
  cancelled: 'Cancel this order? The warehouse is told not to ship it and its held stock is released. / إلغاء هذا الطلب؟ سيُبلَّغ المستودع بعدم شحنه وسيُفرج عن مخزونه المحجوز.',
}
// Why the payment panels are not shown for a closed order. admin.php refuses a
// cash mark on a cancelled order, and a card settlement on a cancelled,
// refunded or voided one, so offering the button only invites a refusal.
const CLOSED_REASON = {
  refunded: 'Refunded: the payment was returned to the customer, so it cannot be confirmed as paid. / مُستردّ: أُعيد المبلغ إلى العميل، لذلك لا يمكن تأكيده مدفوعاً.',
  voided: 'Voided: this payment was closed, so it cannot be confirmed as paid. / مُلغى: أُغلق هذا الدفع، لذلك لا يمكن تأكيده مدفوعاً.',
  cancelled: 'Cancelled: the order is closed, so its payment cannot be confirmed. Move fulfilment off cancelled first to reopen it. / ملغى: الطلب مغلق، لذلك لا يمكن تأكيد دفعه. غيّر حالة التنفيذ عن “ملغى” لإعادته أولاً.',
}

export default function Orders({ initialPayment = 'all' }) {
  const [payment, setPayment] = useState(initialPayment)
  const [search, setSearch] = useState('')
  const [state, setState] = useState({ loading: true, orders: [] })
  const [open, setOpen] = useState(null)
  // Every request takes the next number, and only the newest one may write the
  // list. Without this a slow answer for an earlier filter or search can arrive
  // last and replace the list on screen, and Export CSV would then write rows
  // the owner did not ask for.
  const latest = useRef(0)

  const load = useCallback(async () => {
    const ticket = ++latest.current
    setState((s) => ({ ...s, loading: true }))
    const r = await fetchOrders({ payment, search, limit: ORDER_LIMIT })
    if (ticket !== latest.current) return
    setState({ loading: false, orders: r.orders ?? [], error: r.error, needsMigration: r.needsMigration })
  }, [payment, search])

  useEffect(() => {
    const id = setTimeout(load, search ? 250 : 0) // debounce typing only
    return () => clearTimeout(id)
  }, [load, search])

  const { orders } = state
  // A full page may hide more orders, and a sheet with some missing reads as
  // complete. So the list says so and the export is held back.
  const truncated = orders.length >= ORDER_LIMIT
  const canExport = !state.loading && orders.length > 0 && !truncated

  function exportCsv() {
    if (!canExport) return
    // A UTF-8 byte-order mark (U+FEFF) at the top tells Excel on Windows that the
    // file is UTF-8. Without it Excel reads the bytes as the system code page and
    // Arabic names and addresses come out as garbage on the courier sheet.
    const blob = new Blob(['\uFEFF' + toCsv(orders)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `sporta-orders-${kuwaitDate()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Orders</h1>
          <p className="mt-1 text-sm text-slate-500">
            {state.loading
              ? 'Loading…'
              : truncated
                ? `${ORDER_LIMIT}+ orders · أكثر من ${ORDER_LIMIT} طلب`
                : `${orders.length} order${orders.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="min-h-[44px] rounded-lg border border-[#7d8799] bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Refresh
          </button>
          <button
            onClick={exportCsv}
            disabled={!canExport}
            className="min-h-[44px] rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {['all', ...PAYMENT_FILTERS].map((s) => (
          <button
            key={s}
            onClick={() => setPayment(s)}
            aria-pressed={payment === s}
            className={`min-h-[44px] rounded-full px-3 py-1.5 text-sm font-semibold capitalize ${
              payment === s ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {s}
          </button>
        ))}
        <label className="relative ms-auto">
          <span className="sr-only">Search by track ID</span>
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-500">
            <IconSearch size={16} />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Track ID…"
            className="min-h-[44px] w-48 rounded-lg border border-[#7d8799] bg-white py-2 pe-3 ps-9 text-sm text-slate-800 outline-none focus:border-indigo-500"
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
      {truncated && !state.loading && (
        <Notice tone="warn" title={`Showing the newest ${ORDER_LIMIT} orders · يعرض أحدث ${ORDER_LIMIT} طلب`}>
          There may be more. This list cannot page yet, so Export CSV is off: a sheet with orders missing
          would look complete. Narrow the filter or the search to reach the rest.
          <span className="mt-1 block" dir="rtl" lang="ar">
            قد توجد طلبات أخرى. القائمة لا تُقسَّم إلى صفحات بعد، لذلك أُوقف تصدير CSV حتى لا يبدو ملف ناقص كاملاً.
            ضيّق الفلتر أو البحث للوصول إلى البقية.
          </span>
        </Notice>
      )}

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
              <tr className="border-b border-slate-300 text-slate-500">
                <th className="py-2 text-start font-semibold">Track ID</th>
                <th className="py-2 text-start font-semibold">Placed</th>
                <th className="py-2 text-start font-semibold">Customer</th>
                <th className="py-2 text-end font-semibold">Amount</th>
                <th className="py-2 text-start font-semibold">Payment</th>
                <th className="py-2 text-start font-semibold">Method</th>
                {/* Which ad paid for this order. It sits beside the amount on
                    purpose: the question is never "where did they come from"
                    on its own, it is "what did that campaign earn". */}
                <th className="py-2 text-start font-semibold">Source</th>
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
                  <td className="py-3 font-mono text-xs">
                    {/* The row is a pointer target only. This button is what a
                        keyboard reaches: Enter or Space opens the order, and
                        the click bubbles to the row without harm. */}
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => setOpen(o)}
                      className="rounded font-mono text-xs underline-offset-2 hover:text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-indigo-600"
                    >
                      {o.track_id}
                    </button>
                  </td>
                  <td className="py-3 text-slate-500">{when(o.created_at)}</td>
                  <td className="py-3">{o.customer_name || <span className="text-slate-500">—</span>}</td>
                  <td className="py-3 text-end font-semibold tabular-nums">{kwd(o.amount)}</td>
                  <td className="py-3"><Badge tone={PAY_TONE[o.payment_status]}>{o.payment_status}</Badge></td>
                  <td className="py-3 text-xs font-semibold text-slate-500">
                    {{ cod: 'Cash', tpay: 'T-Pay', knet: 'KNET' }[o.payment_method] ?? o.payment_method}
                  </td>
                  <td className="py-3 text-xs"><SourceCell o={o} /></td>
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

      {open && (
        <OrderDrawer
          order={open}
          onClose={() => setOpen(null)}
          onChanged={load}
          // A money action answers with the order as it now stands. Merge it into
          // the open order so the drawer shows the new state, not the list's
          // snapshot from before the tap.
          onUpdated={(next) => setOpen((prev) => (prev && prev.id === next.id ? { ...prev, ...next } : prev))}
        />
      )}
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

// Where the order came from, in one cell.
//
// A campaign when the ad URL named one, otherwise the site they arrived from,
// otherwise "Direct" — which is a real answer, not missing data: someone typed
// the address, used a bookmark, or came from a link that carries no referrer.
// Showing an em-dash there would read as a bug in the tracking.
function SourceCell({ o }) {
  if (o.utm_source) {
    return (
      <span title={[o.utm_source, o.utm_medium, o.utm_campaign].filter(Boolean).join(' · ')}>
        <span className="font-semibold text-slate-700">{o.utm_source}</span>
        {o.utm_campaign && <span className="block text-[11px] text-slate-500">{o.utm_campaign}</span>}
      </span>
    )
  }
  if (o.referrer_host) return <span className="text-slate-500">{o.referrer_host}</span>
  return <span className="text-slate-500">Direct</span>
}

function OrderDrawer({ order, onClose, onChanged, onUpdated }) {
  const [items, setItems] = useState(null)
  const [busy, setBusy] = useState(false)
  const [cardRef, setCardRef] = useState('')  // the KNET payment id, typed from the portal
  const [err, setErr] = useState('')
  const closeRef = useRef(null)
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
    () => Object.fromEntries(CUSTOMER_FIELDS.map(([k]) => [k, order[k] ?? ''])),
  )
  // The details as the server last held them. Compared with what is typed, it
  // tells whether closing the drawer would throw anything away.
  const [stored, setStored] = useState(cust)
  const [saved, setSaved] = useState(false)
  // The block this number already has, read from the blocked list each time the
  // drawer opens: a reopen clears this drawer's memory, and the buttons must not
  // come back for a number that is blocked. Until the list is read, the block
  // buttons stay off. A block is an upsert, so "cash only" on a number blocked
  // everywhere would quietly cut that block back to cash only.
  const [block, setBlock] = useState({ status: 'checking', scope: null, error: '' })
  const [blockTry, setBlockTry] = useState(0)
  const [itemsError, setItemsError] = useState('')
  const [itemsTry, setItemsTry] = useState(0)
  // The block applies to the number the server holds for this order, not to the
  // one still typed in the form: a number typed and not saved is not blocked.
  const storedLocal = kwLocalPhone(stored.customer_phone)
  const canBlock = /^[569]\d{7}$/.test(storedLocal)
  const phoneEdited = cust.customer_phone !== stored.customer_phone

  const dirty = cardRef.trim() !== '' || CUSTOMER_FIELDS.some(([k]) => cust[k] !== stored[k])

  // Closing with unsaved customer edits or a typed payment ID asks first. The
  // X, the backdrop and Escape all go through here.
  function tryClose() {
    if (dirty && !window.confirm(
      'Close without saving? Your changes to this order will be lost. / الإغلاق دون حفظ؟ ستضيع التغييرات على هذا الطلب.',
    )) return
    onClose()
  }

  useEffect(() => {
    setItemsError('')
    fetchOrderItems(order.id).then((r) => {
      // A failed request is not an order with no items: say so, and offer a retry.
      if (r.error) return setItemsError(r.error)
      setItems(r.items)
    })
  }, [order.id, itemsTry])

  // The block this number already has, from the blocked list. It is read again
  // when the stored number changes, and when the operator tries again.
  useEffect(() => {
    if (!canBlock) return
    let live = true
    setBlock({ status: 'checking', scope: null, error: '' })
    fetchBlocked().then((r) => {
      if (!live) return
      const failure = failureOf(r)
      if (failure) return setBlock({ status: 'error', scope: null, error: failure })
      const row = r.rows.find((x) => x.phone === `965${storedLocal}`)
      setBlock({ status: 'ok', scope: row?.scope ?? null, error: '' })
    })
    return () => { live = false }
  }, [canBlock, storedLocal, blockTry])

  // Focus moves into the dialog when it opens and goes back to whatever opened
  // it when it closes, so a keyboard or screen-reader user is not left behind
  // the overlay.
  useEffect(() => {
    const opener = document.activeElement
    closeRef.current?.focus()
    return () => {
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [])

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && tryClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [dirty, onClose])

  async function move(status) {
    // A shipping message, a review invitation and a do-not-ship all leave the
    // shop the moment this is saved, so the tap is confirmed first.
    if (FUL_CONFIRM[status] && !window.confirm(FUL_CONFIRM[status])) return
    setBusy(true); setErr('')
    const r = await setFulfilment(order.id, status)
    setBusy(false)
    const failure = failureOf(r)
    if (failure) return setErr(failure)
    onChanged?.()
    onClose()
  }

  // Cash on delivery is the only payment the admin settles by hand — the card
  // methods are confirmed by the bank's callback. Kept out of `move` because it
  // does not close the drawer: after taking the cash the next thing the
  // operator usually does is mark the order delivered.
  async function settleCash(paid) {
    // Marking cash collected is what moves the money into the books, and undoing
    // it moves it back out. Both are one tap, so both ask first.
    if (!window.confirm(paid
      ? `Mark ${kwd(order.amount)} as collected in cash? The order is recorded as paid. / تأكيد تحصيل ${kwd(order.amount)} نقداً؟ سيُسجَّل الطلب مدفوعاً.`
      : 'Undo: record that the cash was not collected? / تراجع: تسجيل أن النقد لم يُحصَّل؟')) return
    setBusy(true); setErr('')
    const r = await setCodPaid(order.id, paid)
    setBusy(false)
    const failure = failureOf(r)
    if (failure) return setErr(failure)
    if (!r.order) return setErr(NOT_RECORDED)
    // Show the new state at once: the buttons it replaces must not stay live.
    onUpdated?.(r.order)
    onChanged?.()
  }

  // The card the bank took but never told us about. Deliberately gated on the
  // operator typing the KNET payment id: the whole point is that they have to
  // have looked it up in the portal first.
  async function settleTheCard() {
    setBusy(true); setErr('')
    const r = await settleCard(order.id, cardRef.trim())
    setBusy(false)
    const failure = failureOf(r)
    if (failure) return setErr(failure)
    if (!r.order) return setErr(NOT_RECORDED)
    setCardRef('')
    onUpdated?.(r.order)
    onChanged?.()
  }

  async function persistCustomer() {
    setBusy(true); setErr(''); setSaved(false)
    const r = await saveCustomer(order.id, cust)
    setBusy(false)
    const failure = failureOf(r)
    if (failure) return setErr(failure)
    setStored(cust)
    setSaved(true)
    onChanged?.()
  }

  // Blocking this number. Cash-on-delivery only by default — the proportionate
  // answer to a serial no-show, who can still buy by paying up front, which
  // costs the shop nothing. A reason is required rather than optional: in six
  // months it is the only thing that says whether this was a fraud pattern or
  // one bad afternoon.
  async function blockThisNumber(scope) {
    const reason = window.prompt(
      scope === 'all'
        ? 'Block this number from ALL orders. Why? / حظر هذا الرقم من كل الطلبات. لماذا؟'
        : 'Block this number from cash on delivery (they can still pay online). Why? / حظر هذا الرقم من الدفع النقدي عند الاستلام (يمكنه الدفع أونلاين). لماذا؟',
    )
    if (reason === null) return
    if (!reason.trim()) return setErr('A reason is required — future-you will want to know why. / السبب مطلوب.')
    setBusy(true); setErr('')
    // The number the server holds for this order, never the one still typed in the form.
    const r = await blockCustomer(stored.customer_phone, reason.trim(), scope)
    setBusy(false)
    const failure = failureOf(r)
    if (failure) return setErr(failure)
    if (r.data?.ok !== true) return setErr(NOT_RECORDED)
    setErr('')
    setBlock({ status: 'ok', scope: r.data.scope === 'all' ? 'all' : 'cod', error: '' })
  }

  // A closed order has no payment left to confirm. Refunded and voided payments
  // were closed in KPay, and a cancelled order gave its stock back. A paid order
  // is never called closed here: it has nothing to confirm either way.
  let closedFor = ''
  if (order.payment_status === 'refunded' || order.payment_status === 'voided') closedFor = order.payment_status
  else if (order.fulfilment_status === 'cancelled' && order.payment_status !== 'paid') closedFor = 'cancelled'

  // The typed number's local part. wa.me needs 965 in front, and only a number
  // the server would read as already carrying the country code keeps no prefix.
  const wa = kwLocalPhone(cust.customer_phone)

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={tryClose}>
      <aside
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Order ${order.track_id}`}
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-slate-300 bg-white px-5 py-4">
          <div>
            <p className="font-mono text-sm font-bold text-slate-800">{order.track_id}</p>
            <p className="text-xs text-slate-500">{when(order.created_at)}</p>
          </div>
          <button ref={closeRef} onClick={tryClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center text-slate-500 hover:text-slate-700">
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
            {itemsError ? (
              <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
                <p>{itemsError}</p>
                <button
                  type="button"
                  onClick={() => setItemsTry((n) => n + 1)}
                  className="mt-2 min-h-[44px] rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                >
                  Try again · أعد المحاولة
                </button>
              </div>
            ) : items === null ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : items.length === 0 ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                No line items. The order was created but its products were never matched — usually
                because the catalogue was not in the database at the time.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-300">
                {items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-slate-700">
                      {it.products?.name_en ?? 'Unknown'} <span className="text-slate-500">× {it.qty}</span>
                      {/* The size and fit the customer bought. A return or a complaint
                          is about one of them, so the packer sees both here. */}
                      {(it.size || it.fit) && (
                        <span className="block text-xs text-slate-500">
                          {it.size && <span>Size · المقاس: {it.size}</span>}
                          {it.size && it.fit && <span aria-hidden="true"> · </span>}
                          {it.fit && <span>Fit · القَصّة: {it.fit}</span>}
                        </span>
                      )}
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
                    className="min-h-[44px] rounded-lg border border-[#7d8799] px-3 py-2 text-sm outline-none focus:border-indigo-500"
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={persistCustomer}
                disabled={busy}
                className="min-h-[44px] rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Save details
              </button>
              {wa.length >= 8 && (
                <a
                  href={`https://wa.me/965${wa}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[44px] rounded-lg border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
                >
                  WhatsApp
                </a>
              )}
              {saved && <span className="text-sm font-semibold text-emerald-700">Saved</span>}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Captured at checkout. Blank on orders placed before checkout started asking.
            </p>

            {/* Refusing this number future business. Cash on delivery is the
                only payment that spends the shop's money before anyone pays —
                the courier goes out either way — so that is what a no-show
                loses first. Paying online stays open, because a prepaid order
                costs the shop nothing and a blocked customer who can still buy
                is a customer. */}
            {canBlock && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                {block.status === 'checking' && (
                  <p className="text-xs text-slate-500">Checking the block list… / جارٍ التحقق من قائمة الحظر…</p>
                )}
                {block.status === 'error' && (
                  <div className="text-xs text-rose-700">
                    <p>{block.error}</p>
                    <button
                      type="button"
                      onClick={() => setBlockTry((n) => n + 1)}
                      className="mt-1 min-h-[44px] font-semibold underline underline-offset-2"
                    >
                      Try again · أعد المحاولة
                    </button>
                  </div>
                )}
                {block.status === 'ok' && block.scope === 'all' && (
                  <p className="text-xs font-semibold text-rose-600">
                    Blocked from all orders. Manage the list under Blocked numbers. / محظور من كل الطلبات. أدِر القائمة من قسم الأرقام المحظورة.
                  </p>
                )}
                {block.status === 'ok' && block.scope === 'cod' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-amber-700">
                      Blocked from cash on delivery; they can still pay online. / محظور من الدفع النقدي عند الاستلام؛ يمكنه الدفع أونلاين.
                    </span>
                    <button
                      onClick={() => blockThisNumber('all')}
                      disabled={busy}
                      className="min-h-[44px] rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                    >
                      Block entirely · حظر كلي
                    </button>
                  </div>
                )}
                {block.status === 'ok' && !block.scope && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500">Refused delivery or a fake order? / رُفض التوصيل أو طلب وهمي؟</span>
                    <button
                      onClick={() => blockThisNumber('cod')}
                      disabled={busy}
                      className="min-h-[44px] rounded-lg border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-40"
                    >
                      Block cash on delivery · حظر الدفع النقدي عند الاستلام
                    </button>
                    <button
                      onClick={() => blockThisNumber('all')}
                      disabled={busy}
                      className="min-h-[44px] rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                    >
                      Block entirely · حظر كلي
                    </button>
                  </div>
                )}
                {phoneEdited && (
                  <p className="mt-2 text-xs text-slate-500">
                    Blocks the number saved on this order. Save the details first to block a changed number. / يُحظر الرقم المحفوظ على هذا الطلب. احفظ التفاصيل أولاً لحظر رقم معدّل.
                  </p>
                )}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-bold text-slate-700">Move fulfilment to</h3>
            <div className="flex flex-wrap gap-2">
              {FULFILMENT_STATES.filter((s) => s !== order.fulfilment_status).map((s) => (
                // Cancelling is set apart from the moves that only record progress:
                // it sends the warehouse a do-not-ship and releases the stock, so it
                // is red and pushed to the end of the row, not a twin of "delivered".
                <button
                  key={s}
                  onClick={() => move(s)}
                  disabled={busy}
                  className={`min-h-[44px] rounded-lg border px-3 py-2 text-sm font-semibold capitalize disabled:opacity-40 ${
                    s === 'cancelled'
                      ? 'ms-auto border-rose-300 text-rose-700 hover:bg-rose-50'
                      : 'border-[#7d8799] text-slate-700 hover:border-indigo-400 hover:text-indigo-600'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            {/* Cash on delivery: the money arrives at the door, so this is the
                one payment the admin confirms. Previously this panel printed
                "mark it paid" with no control that could — every cash order
                stayed pending and its revenue never reached the dashboard. */}
            {closedFor && (
              <div className="mt-3 rounded-xl border border-slate-300 bg-slate-50 p-3">
                <p className="text-xs text-slate-700">{CLOSED_REASON[closedFor]}</p>
              </div>
            )}
            {order.payment_method === 'cod' && order.payment_status === 'pending' && !closedFor && (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs text-emerald-900">
                  Cash on delivery — the driver collects <strong>{kwd(order.amount)}</strong> at the door.
                </p>
                <button
                  onClick={() => settleCash(true)}
                  disabled={busy}
                  className="mt-2 min-h-[44px] rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
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
            {order.payment_method !== 'cod' && order.payment_status !== 'paid' && !closedFor && (
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
                    className="min-h-[44px] min-w-[12rem] flex-1 rounded-lg border border-amber-300 px-3 py-2 font-mono text-sm outline-none focus:border-amber-500"
                  />
                  <button
                    onClick={settleTheCard}
                    disabled={busy || cardRef.trim().length < 6}
                    className="min-h-[44px] rounded-lg bg-amber-600 px-3 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-40"
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
              <div className="mt-3 rounded-xl border border-slate-300 bg-slate-50 p-3">
                <p className="text-xs text-slate-600">
                  Cash recorded as collected{order.paid_at ? ` on ${when(order.paid_at)}` : ''}.
                </p>
                <button
                  onClick={() => settleCash(false)}
                  disabled={busy}
                  className="mt-2 min-h-[44px] text-xs font-semibold text-rose-700 underline hover:text-rose-800 disabled:opacity-40"
                >
                  Undo — cash was not collected
                </button>
              </div>
            )}
            {order.payment_status !== 'paid' && order.payment_method !== 'cod' && !closedFor && (
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
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`${mono ? 'font-mono text-xs' : 'text-sm'} ${strong ? 'text-base font-bold' : ''} capitalize text-slate-800`}>
        {value}
      </p>
    </div>
  )
}
