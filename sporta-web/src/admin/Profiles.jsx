import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchProfiles, fetchProfile, PAGE_SIZE } from './profilesApi'
import { Notice } from './Notice'
import { formatKWD } from '../lib/format'
import { formatAddress } from '../lib/kuwait'
import { IconClose, IconSearch } from '../components/icons'

// Customer profiles: who has an account, what they have bought, where it went.
//
// The list is customer_accounts joined to orders (admin.php ?r=profiles_list,
// 20 a page, searchable by name, email or phone); a profile opens into
// ?r=profile_detail (the account, its latest 100 orders, and the delivery
// addresses those orders used). Read-only: nothing here changes a customer.
//
// RULES THIS SCREEN KEEPS
//   - What the server sent lives in component state and nowhere else: no
//     localStorage, no sessionStorage, no console, no URL. The search term is
//     the one thing that reaches the server's query string, and it is not kept.
//   - Everything is drawn as React text. Customers choose their own names and
//     addresses, so none of it is ever markup.
//   - Customers write Arabic names into an English admin: every name, address
//     and place is dir="auto", so each reads in its own direction wherever it
//     sits.
//   - A request that the next keystroke, page or tab has made pointless is
//     aborted, not merely ignored, so a slow answer to "al" can never land on
//     top of the answer to "ali".

const DEBOUNCE_MS = 300
const CONTROL = /[\u0000-\u001f\u007f]/g // the server refuses these in a search

const kwd = (n) => formatKWD(Number(n ?? 0), 'en')

// MySQL gives "2026-10-30 12:20:00". A space instead of the ISO "T" is read
// differently by different browsers (older Safari answers Invalid Date), so
// the separator is normalised first.
function parse(t) {
  if (!t) return null
  const d = new Date(String(t).replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d
}
const day = (t) => parse(t)?.toLocaleDateString('en-GB', { dateStyle: 'medium' }) ?? '—'
const when = (t) => parse(t)?.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) ?? '—'

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
  cancelled: 'bg-slate-100 text-slate-600',
}
const METHOD = { cod: 'Cash', tpay: 'T-Pay', knet: 'KNET' }

function Badge({ tone, children }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold capitalize ${tone || 'bg-slate-100 text-slate-600'}`}>
      {children}
    </span>
  )
}

const display = (p) => p.name || p.email || `Profile ${p.id}`

export default function Profiles() {
  const [openId, setOpenId] = useState(null)
  // Where the person was in the list, so Back puts them there again.
  const came = useRef({ opener: null, scrollY: 0 })

  function open(id, opener) {
    came.current = { opener, scrollY: window.scrollY }
    setOpenId(id)
  }

  const back = useCallback(() => setOpenId(null), [])

  useEffect(() => {
    if (openId !== null) return
    const { opener, scrollY } = came.current
    if (!opener) return
    window.scrollTo(0, scrollY)
    if (opener.isConnected) opener.focus({ preventScroll: true })
    came.current = { opener: null, scrollY: 0 }
  }, [openId])

  return (
    <>
      {/* The list stays mounted (hidden) under an open profile, so Back is
          instant, keeps the search and page, and costs no request. */}
      <ProfileList hidden={openId !== null} onOpen={open} />
      {openId !== null && <ProfileDetail key={openId} id={openId} onBack={back} />}
    </>
  )
}

// ---------------------------------------------------------------- the list

function ProfileList({ hidden, onOpen }) {
  const [input, setInput] = useState('') // what is in the box
  const [query, setQuery] = useState('') // what the list was asked for
  const [page, setPage] = useState(1)
  const [reload, setReload] = useState(0)
  const [state, setState] = useState({ status: 'loading', rows: [], hasMore: false, error: null })
  const searchRef = useRef(null)

  // One request per pause in typing, not one per key.
  useEffect(() => {
    const next = input.trim()
    if (next === query) return undefined
    const id = setTimeout(() => {
      setQuery(next)
      setPage(1)
    }, DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [input, query])

  useEffect(() => {
    const ac = new AbortController()
    setState((s) => ({ ...s, status: 'loading', error: null }))
    fetchProfiles({ query, page, signal: ac.signal })
      .then((r) => {
        if (ac.signal.aborted) return
        if (r.ok) setState({ status: 'ready', rows: r.profiles, hasMore: r.hasMore, error: null })
        // An error clears the rows: a failure must not sit under another
        // query's results as if they answered it.
        else setState({ status: 'error', rows: [], hasMore: false, error: r })
      })
      .catch((e) => {
        if (e?.name === 'AbortError' || ac.signal.aborted) return
        setState({ status: 'error', rows: [], hasMore: false, error: { kind: 'server', message: 'Something went wrong while loading profiles.' } })
      })
    // Navigating away from this query/page — or from the screen — cancels it.
    return () => ac.abort()
  }, [query, page, reload])

  function submit(e) {
    e.preventDefault()
    const next = input.trim()
    if (next === query) setReload((n) => n + 1)
    else {
      setQuery(next)
      setPage(1)
    }
  }

  function clearSearch() {
    setInput('')
    setQuery('')
    setPage(1)
    searchRef.current?.focus()
  }

  const { status, rows, hasMore, error } = state
  const loading = status === 'loading'

  return (
    <div className="space-y-5" hidden={hidden} data-profiles-list>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Profiles</h1>
          <p className="mt-1 text-sm text-slate-500" role="status" dir="auto">
            {loading && !rows.length
              ? 'Loading…'
              : status === 'ready'
                ? `${rows.length} ${rows.length === 1 ? 'profile' : 'profiles'} on page ${page}${hasMore ? ' · more after this' : ''}`
                : ' '}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReload((n) => n + 1)}
          className="min-h-11 rounded-lg border border-[#7d8799] bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          Refresh
        </button>
      </header>

      <form role="search" onSubmit={submit} className="profiles-search relative max-w-md">
        <label>
          <span className="sr-only">Search profiles by name, email or phone</span>
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-500">
            <IconSearch size={16} />
          </span>
          <input
            ref={searchRef}
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value.replace(CONTROL, ''))}
            maxLength={80}
            placeholder="Name, email or phone"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            dir="auto"
            className="min-h-11 w-full rounded-lg border border-[#7d8799] bg-white py-2 pe-11 ps-9 text-base text-slate-800 outline-none focus:border-indigo-500"
          />
        </label>
        {input && (
          <button
            type="button"
            onClick={clearSearch}
            aria-label="Clear search"
            className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-slate-500 hover:text-slate-700"
          >
            <IconClose size={18} />
          </button>
        )}
      </form>

      {status === 'error' && <ListError error={error} onRetry={() => setReload((n) => n + 1)} />}

      {loading && !rows.length && <ListSkeleton />}

      {status === 'ready' && !rows.length && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="font-semibold text-slate-700">
            {page > 1 ? 'No more profiles' : query ? 'No profiles match that search' : 'No customer profiles yet'}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {page > 1
              ? 'This page is past the end of the list.'
              : query
                ? 'The search covers name, email and phone.'
                : 'A profile is created when a shopper makes an account on the site.'}
          </p>
          {(page > 1 || query) && (
            <button
              type="button"
              onClick={page > 1 ? () => setPage(1) : clearSearch}
              className="mt-4 min-h-11 rounded-lg border border-[#7d8799] bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              {page > 1 ? 'Back to the first page' : 'Clear the search'}
            </button>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div aria-busy={loading} className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <div className="profiles-table-wrap">
            <table className="admin-table profiles-table w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-slate-500">
                  <th scope="col" className="py-2 text-start font-semibold">Name</th>
                  <th scope="col" className="py-2 text-start font-semibold">Email</th>
                  <th scope="col" className="py-2 text-start font-semibold">Phone</th>
                  <th scope="col" className="py-2 text-start font-semibold">Joined</th>
                  <th scope="col" className="py-2 text-start font-semibold">Last login</th>
                  <th scope="col" className="py-2 text-end font-semibold">Orders</th>
                  <th scope="col" className="py-2 text-end font-semibold">Paid</th>
                  <th scope="col" className="py-2 text-start font-semibold">Last order</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr
                    key={p.id}
                    onClick={(e) => onOpen(p.id, e.currentTarget.querySelector('button'))}
                    className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                  >
                    <td className="py-2 font-semibold text-slate-800">
                      <button
                        type="button"
                        data-profile-id={p.id}
                        onClick={(e) => { e.stopPropagation(); onOpen(p.id, e.currentTarget) }}
                        dir="auto"
                        className="min-h-10 text-start font-semibold text-indigo-700 hover:underline"
                      >
                        {display(p)}
                      </button>
                    </td>
                    <td className="profiles-cell-email py-2 text-slate-600" title={p.email}><bdi>{p.email || '—'}</bdi></td>
                    <td className="py-2 tabular-nums text-slate-600"><bdi>{p.phone || '—'}</bdi></td>
                    <td className="py-2 text-slate-500">{day(p.created_at)}</td>
                    <td className="py-2 text-slate-500" title={p.last_login_at ? undefined : 'Not recorded'}>
                      {p.last_login_at ? when(p.last_login_at) : '—'}
                    </td>
                    <td className="py-2 text-end tabular-nums">{p.order_count}</td>
                    <td className="py-2 text-end font-semibold tabular-nums">{kwd(p.paid_total)}</td>
                    <td className="py-2 text-slate-500">{p.last_order_at ? day(p.last_order_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="m-list">
            {rows.map((p) => (
              <button
                key={p.id}
                type="button"
                data-profile-id={p.id}
                onClick={(e) => onOpen(p.id, e.currentTarget)}
                className="m-row w-full min-h-11 text-start"
              >
                <div className="m-row__top">
                  <span className="m-row__title profiles-wrap" dir="auto">{display(p)}</span>
                  <span className="text-xs font-semibold text-slate-500">
                    {p.order_count} {p.order_count === 1 ? 'order' : 'orders'}
                  </span>
                </div>
                <div className="m-row__meta profiles-wrap">
                  {p.email || p.phone
                    ? <>{p.email && <bdi>{p.email}</bdi>}{p.email && p.phone ? ' · ' : ''}{p.phone && <bdi>{p.phone}</bdi>}</>
                    : '—'}
                </div>
                <div className="m-row__meta">
                  Paid {kwd(p.paid_total)}{p.last_order_at ? ` · last order ${day(p.last_order_at)}` : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {(page > 1 || hasMore) && rows.length > 0 && (
        <nav aria-label="Profile pages" className="profiles-pager flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setPage((n) => Math.max(1, n - 1))}
            disabled={page <= 1}
            className="min-h-11 rounded-lg border border-[#7d8799] bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-slate-500">Page {page}</span>
          <button
            type="button"
            onClick={() => setPage((n) => n + 1)}
            disabled={!hasMore}
            className="min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            More
          </button>
        </nav>
      )}
    </div>
  )
}

const ERROR_TITLE = {
  throttled: 'Slow down for a moment',
  signedOut: 'Signed out',
  setup: 'Customer accounts are not ready',
  invalid: 'That search was refused',
  missing: 'Not found',
  network: 'Cannot reach the server',
  server: 'Profiles could not be loaded',
}

function ListError({ error, onRetry }) {
  return (
    <Notice tone={error.kind === 'throttled' ? 'warn' : 'error'} title={ERROR_TITLE[error.kind] ?? ERROR_TITLE.server}>
      <p>{error.message}</p>
      {error.kind !== 'signedOut' && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Try again
        </button>
      )}
    </Notice>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-3 motion-safe:animate-pulse" role="status" aria-busy="true" aria-label="Loading profiles">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-14 rounded-xl bg-slate-100" />
      ))}
    </div>
  )
}

// -------------------------------------------------------------- the detail

// The addresses a customer has had orders delivered to, newest first, each
// once. The server does not keep an address book: an address IS the fields on
// an order, so this reads them back out of the orders it returned.
function addressesOf(orders) {
  const seen = new Map()
  for (const o of orders) {
    const line = formatAddress(o)
    if (!line) continue
    const key = `${line}|${o.customer_name}|${o.customer_phone}`
    const hit = seen.get(key)
    if (hit) hit.times += 1
    else seen.set(key, { key, line, name: o.customer_name, phone: o.customer_phone, last: o.created_at, times: 1 })
  }
  return [...seen.values()] // orders arrive newest first
}

function ProfileDetail({ id, onBack }) {
  const [reload, setReload] = useState(0)
  const [state, setState] = useState({ status: 'loading' })
  const headingRef = useRef(null)

  useEffect(() => {
    const ac = new AbortController()
    setState({ status: 'loading' })
    fetchProfile(id, ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return
        setState(r.ok ? { status: 'ready', ...r } : { status: 'error', error: r })
      })
      .catch((e) => {
        if (e?.name === 'AbortError' || ac.signal.aborted) return
        setState({ status: 'error', error: { kind: 'server', message: 'Something went wrong while loading this profile.' } })
      })
    return () => ac.abort()
  }, [id, reload])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  // Land on the heading once there is one: the list was under the person's
  // thumb a moment ago and a screen reader needs to hear that the page changed.
  // (Not at mount: while the profile loads there is only a placeholder.)
  const loaded = state.status !== 'loading'
  useEffect(() => {
    if (loaded) headingRef.current?.focus({ preventScroll: true })
  }, [loaded])

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onBack()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onBack])

  const { status } = state
  const profile = status === 'ready' ? state.profile : null
  const orders = status === 'ready' ? state.orders : []
  const addresses = addressesOf(orders)

  return (
    <div className="space-y-5" data-profile-detail>
      <button
        type="button"
        onClick={onBack}
        className="min-h-11 rounded-lg border border-[#7d8799] bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
      >
        ← All profiles
      </button>

      {status === 'loading' && (
        <div className="min-h-[50vh] space-y-4 motion-safe:animate-pulse" role="status" aria-busy="true" aria-label="Loading profile">
          <div className="h-8 w-56 rounded bg-slate-200" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-slate-100" />)}
          </div>
          <div className="h-40 rounded-xl bg-slate-100" />
        </div>
      )}

      {status === 'error' && (
        <>
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-slate-800 outline-none">Profile</h1>
          <ListError error={state.error} onRetry={() => setReload((n) => n + 1)} />
        </>
      )}

      {profile && (
        <>
          <header>
            <h1 ref={headingRef} tabIndex={-1} className="profiles-wrap text-2xl font-bold text-slate-800 outline-none">
              <bdi dir="auto">{display(profile)}</bdi>
            </h1>
            <p className="mt-1 text-sm text-slate-500">Customer account since {day(profile.created_at)}</p>
          </header>

          <section aria-label="Account" className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="Email" value={profile.email || '—'} />
            <Field label="Phone" value={profile.phone || '—'} />
            <Field label="Last login" value={profile.last_login_at ? when(profile.last_login_at) : 'Not recorded'} />
            <Field label="Orders" value={String(state.summary.orders)} />
            <Field label="Paid in total" value={kwd(state.summary.paid_total)} strong />
            <Field label="Last order" value={orders[0] ? day(orders[0].created_at) : '—'} />
          </section>

          {orders.length >= 100 && (
            <p className="text-xs text-slate-500">The server returns a profile’s latest 100 orders; the totals above cover those.</p>
          )}

          <section aria-labelledby="profile-addresses">
            <h2 id="profile-addresses" className="mb-2 text-sm font-bold text-slate-700">Delivery addresses used</h2>
            {addresses.length === 0 ? (
              <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No order from this profile has a delivery address yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-300 bg-white">
                {addresses.map((a) => (
                  <li key={a.key} className="px-3 py-2.5 text-sm">
                    <p className="profiles-wrap text-slate-800" dir="auto">{a.line}</p>
                    <p className="profiles-wrap mt-0.5 text-xs text-slate-500">
                      <span dir="auto">{a.name || 'No name'}</span>
                      {a.phone ? <> · <bdi>{a.phone}</bdi></> : null}
                      {' · '}{a.times} {a.times === 1 ? 'order' : 'orders'}, latest {day(a.last)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="profile-orders">
            <h2 id="profile-orders" className="mb-2 text-sm font-bold text-slate-700">Orders</h2>
            {orders.length === 0 ? (
              <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">This customer has not placed an order yet.</p>
            ) : (
              <>
                <table className="admin-table w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-300 text-slate-500">
                      <th scope="col" className="py-2 text-start font-semibold">Track ID</th>
                      <th scope="col" className="py-2 text-start font-semibold">Placed</th>
                      <th scope="col" className="py-2 text-end font-semibold">Amount</th>
                      <th scope="col" className="py-2 text-start font-semibold">Payment</th>
                      <th scope="col" className="py-2 text-start font-semibold">Method</th>
                      <th scope="col" className="py-2 text-start font-semibold">Fulfilment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className="border-b border-slate-100">
                        <td className="py-2.5 font-mono text-xs">{o.track_id}</td>
                        <td className="py-2.5 text-slate-500">{when(o.created_at)}</td>
                        <td className="py-2.5 text-end font-semibold tabular-nums">{kwd(o.amount)}</td>
                        <td className="py-2.5"><Badge tone={PAY_TONE[o.payment_status]}>{o.payment_status}</Badge></td>
                        <td className="py-2.5 text-xs font-semibold text-slate-500">{METHOD[o.payment_method] ?? o.payment_method}</td>
                        <td className="py-2.5"><Badge tone={FUL_TONE[o.fulfilment_status]}>{o.fulfilment_status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="m-list">
                  {orders.map((o) => (
                    <div key={o.id} className="m-row">
                      <div className="m-row__top">
                        <span className="m-row__title font-mono text-sm">{o.track_id}</span>
                        <Badge tone={PAY_TONE[o.payment_status]}>{o.payment_status}</Badge>
                      </div>
                      <div className="m-row__meta">
                        {kwd(o.amount)} · {METHOD[o.payment_method] ?? o.payment_method} · {o.fulfilment_status}
                      </div>
                      <div className="m-row__meta">{when(o.created_at)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function Field({ label, value, strong }) {
  return (
    <div className="rounded-xl border border-slate-300 bg-white px-3 py-2.5">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className={`profiles-wrap mt-0.5 text-sm ${strong ? 'font-bold text-slate-800' : 'text-slate-700'}`}>
        <bdi>{value}</bdi>
      </p>
    </div>
  )
}
