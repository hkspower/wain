import { phpBase } from '../lib/backend'

// The two customer-profile routes of admin.php, for the Profiles screen.
//
//   profiles_list    ?q=<search, 80 chars max>&page=<1..500>   20 per page
//                    -> { profiles: [...], page, has_more }
//   profile_detail   ?id=<profile id>
//                    -> { profile, orders: [... newest 100], summary }
//
// WHY THIS IS NOT api.js's php()
// Searching a list as the operator types needs to CANCEL the request the next
// keystroke makes pointless, and php() -> phpAdmin() cannot take an
// AbortSignal. The headers are the same ones phpAdmin sends (the session cookie
// and X-Sporta-Admin, which admin.php wants on every route); if that contract
// ever changes, change both.
//
// WHAT NEVER HAPPENS HERE
// Nothing read from these routes is written anywhere: not localStorage, not
// sessionStorage, not the console. The caller keeps it in component state, and
// it goes when the screen does.

export const PAGE_SIZE = 20
export const THROTTLE_PER_MINUTE = 90 // admin.php: store_throttle(..., 'profiles_read', 90, 60)

const fail = (kind, message, extra = {}) => ({ ok: false, kind, message, ...extra })

async function get(route, params, signal) {
  const query = new URLSearchParams({ r: route, ...params })
  let res
  try {
    res = await fetch(`${phpBase()}/admin.php?${query}`, {
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
      credentials: 'include',
      cache: 'no-store',
      signal,
    })
  } catch (e) {
    // The caller aborted this on purpose (the query changed, the screen
    // closed): not a failure, and nothing to show.
    if (signal?.aborted || e?.name === 'AbortError') throw e
    return fail('network', 'Cannot reach the server. Check your connection, then try again.')
  }
  const data = await res.json().catch(() => null)
  const token = typeof data?.error === 'string' ? data.error : ''

  if (res.ok && !token && data && typeof data === 'object') return { ok: true, data }

  if (res.status === 401 || res.status === 403) {
    return fail('signedOut', 'Your admin session has ended. Reload this page and sign in again.')
  }
  if (res.status === 429) {
    const header = Number.parseInt(res.headers.get('Retry-After') ?? '', 10)
    const body = Number.parseInt(data?.retry_after, 10)
    const seconds = [body, header].find((n) => Number.isFinite(n) && n > 0) ?? 60
    return fail(
      'throttled',
      `Too many lookups in a minute (the server allows ${THROTTLE_PER_MINUTE}). Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
      { retryAfter: seconds },
    )
  }
  if (res.status === 404 || token === 'not_found') {
    return fail('missing', 'This profile no longer exists.')
  }
  if (token === 'invalid_filter') {
    return fail('invalid', 'That search is not valid. Use up to 80 characters, without control characters.')
  }
  if (token === 'invalid_profile') return fail('invalid', 'That profile id is not valid.')
  if (token === 'no_table') {
    return fail('setup', 'Customer accounts are not set up on this database yet. Import api/customers.mysql.sql in phpMyAdmin, then try again.')
  }
  // A 2xx whose body is not JSON (or not the expected shape) is an answer this
  // screen cannot read, not an HTTP failure: "HTTP 200" would name a success.
  if (res.ok) return fail('server', 'The server answered with something this screen cannot read.')
  return fail('server', `The server could not load profiles (${res.status ? `HTTP ${res.status}` : 'no answer'}). Try again in a moment.`)
}

const text = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const nullable = (v) => (v == null || v === '' ? null : String(v))
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// Only the fields the screen draws, in the types it expects. The reply is
// untrusted in shape (a proxy error page, a newer server), and everything
// below reads these as plain strings and numbers.
function profileRow(p) {
  return {
    id: num(p.id),
    name: text(p.name),
    email: text(p.email),
    phone: text(p.phone),
    created_at: nullable(p.created_at),
    last_login_at: nullable(p.last_login_at), // null on every database without the column
    order_count: num(p.order_count),
    paid_total: num(p.paid_total),
    last_order_at: nullable(p.last_order_at),
  }
}

function orderRow(o) {
  return {
    id: num(o.id),
    track_id: text(o.track_id),
    amount: num(o.amount),
    payment_method: text(o.payment_method),
    payment_status: text(o.payment_status),
    fulfilment_status: text(o.fulfilment_status),
    customer_name: text(o.customer_name),
    customer_phone: text(o.customer_phone),
    customer_governorate: text(o.customer_governorate),
    customer_area: text(o.customer_area),
    customer_block: text(o.customer_block),
    customer_street: text(o.customer_street),
    customer_building: text(o.customer_building),
    customer_floor: text(o.customer_floor),
    customer_flat: text(o.customer_flat),
    created_at: nullable(o.created_at),
    paid_at: nullable(o.paid_at),
    fulfilled_at: nullable(o.fulfilled_at),
  }
}

export async function fetchProfiles({ query = '', page = 1, signal } = {}) {
  const params = { page: String(page) }
  if (query) params.q = query
  const r = await get('profiles_list', params, signal)
  if (!r.ok) return r
  if (!Array.isArray(r.data.profiles)) return fail('server', 'The server answered with something this screen cannot read.')
  return {
    ok: true,
    profiles: r.data.profiles.filter((p) => p && typeof p === 'object').map(profileRow),
    page: num(r.data.page) || page,
    hasMore: r.data.has_more === true,
  }
}

export async function fetchProfile(id, signal) {
  const r = await get('profile_detail', { id: String(id) }, signal)
  if (!r.ok) return r
  const { profile, orders, summary } = r.data
  if (!profile || typeof profile !== 'object') return fail('server', 'The server answered with something this screen cannot read.')
  const list = Array.isArray(orders) ? orders.filter((o) => o && typeof o === 'object').map(orderRow) : []
  return {
    ok: true,
    profile: profileRow(profile),
    orders: list,
    summary: { orders: num(summary?.orders ?? list.length), paid_total: num(summary?.paid_total) },
  }
}
