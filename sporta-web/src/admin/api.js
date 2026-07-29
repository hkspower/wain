import { supabase } from '../lib/supabase'
import { PRODUCTS } from '../lib/products'

// Every admin query lives here so screens stay presentational and there is one
// place to look when a policy or column changes.
//
// Reads require the policies in supabase/admin-migration.sql. Without them the
// queries return an empty set rather than an error, so each helper reports
// `needsMigration` and the UI can say what to do instead of showing "no orders".

const NOT_CONFIGURED =
  'Supabase is not configured — add your Project URL and anon key to public_html/config.js.'

// This account signed in but is not on the admin allowlist. Being signed in is
// no longer enough: admin-allowlist-migration.sql gates every admin policy and
// RPC on a row in public.admin_users, because in Supabase `authenticated` means
// "anyone who signed up", and sign-up is open to the internet.
export const NOT_ADMIN =
  'This account is signed in but is not an admin.\n\n' +
  'Add it in the Supabase SQL editor:\n' +
  "  insert into public.admin_users (user_id, email)\n" +
  "  select id, email from auth.users where email = 'you@example.com'\n" +
  '  on conflict (user_id) do nothing;'

export const PAYMENT_STATES = ['paid', 'pending', 'review', 'failed']
export const FULFILMENT_STATES = ['unfulfilled', 'packed', 'shipped', 'delivered', 'cancelled']

function ready() {
  return Boolean(supabase)
}

// The allowlist RPCs raise not_admin with SQLSTATE 42501. RLS on the tables is
// silent instead — it returns zero rows — so a denial shows up as either.
function isDeniedError(error) {
  if (!error) return false
  return error.code === '42501' || `${error.message || ''}`.includes('not_admin')
}

// A missing table/column/function reads as a schema problem, not a data problem.
function isSchemaError(error) {
  if (!error) return false
  const m = `${error.message || ''} ${error.details || ''}`.toLowerCase()
  return (
    error.code === '42P01' || // undefined_table
    error.code === '42703' || // undefined_column
    error.code === 'PGRST202' || // function not found
    m.includes('does not exist') ||
    m.includes('schema cache')
  )
}

export async function fetchStats() {
  if (!ready()) return { error: NOT_CONFIGURED }
  const { data, error } = await supabase.rpc('admin_order_stats')
  if (error) {
    if (isDeniedError(error)) return { notAdmin: true }
    return isSchemaError(error) ? { needsMigration: true } : { error: error.message }
  }
  const row = Array.isArray(data) ? data[0] : data
  return { stats: row ?? null }
}

export async function fetchRevenueDaily(days = 14) {
  if (!ready()) return { series: [] }
  const { data, error } = await supabase.rpc('admin_revenue_daily', { p_days: days })
  if (error) {
    if (isDeniedError(error)) return { notAdmin: true, series: [] }
    return isSchemaError(error) ? { needsMigration: true, series: [] } : { series: [] }
  }
  return { series: data ?? [] }
}

export async function fetchOrders({ payment = 'all', fulfilment = 'all', search = '', limit = 100 } = {}) {
  if (!ready()) return { error: NOT_CONFIGURED, orders: [] }
  let q = supabase
    .from('orders')
    .select(
      'id, track_id, amount, payment_status, payment_method, fulfilment_status, paid_at, created_at,' +
        ' customer_name, customer_phone, customer_area, customer_note,' +
        ' customer_governorate, customer_block, customer_street, customer_building,' +
        ' customer_floor, customer_flat,' +
        ' cbk_paymentid, cbk_reference, cbk_status',
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (payment !== 'all') q = q.eq('payment_status', payment)
  if (fulfilment !== 'all') q = q.eq('fulfilment_status', fulfilment)
  const term = search.trim()
  if (term) q = q.ilike('track_id', `%${term}%`)

  const { data, error } = await q
  if (error) {
    return isSchemaError(error)
      ? { needsMigration: true, orders: [] }
      : { error: error.message, orders: [] }
  }
  return { orders: data ?? [] }
}

// Line items for one order, with the product names resolved.
export async function fetchOrderItems(orderId) {
  if (!ready()) return { items: [] }
  const { data, error } = await supabase
    .from('order_items')
    .select('id, qty, unit_price, products ( slug, name_en, name_ar )')
    .eq('order_id', orderId)
  if (error) return { items: [], error: error.message }
  return { items: data ?? [] }
}

export async function setFulfilment(orderId, status) {
  if (!ready()) return { error: NOT_CONFIGURED }
  const { error } = await supabase
    .from('orders')
    .update({ fulfilment_status: status })
    .eq('id', orderId)
  return error ? { error: error.message } : {}
}

// Settle (or un-settle) a cash-on-delivery order.
//
// Goes through an RPC rather than a direct update on purpose: the
// orders_admin_update policy deliberately forbids changing payment_status, so
// that nobody signed into /admin can assert a card payment the bank never
// confirmed. admin_set_cod_paid is the one narrow exception — it refuses any
// order whose payment_method is not 'cod', and it maintains paid_at, which the
// revenue stats and the daily chart filter on.
export async function setCodPaid(orderId, paid = true) {
  if (!ready()) return { error: NOT_CONFIGURED }
  const { data, error } = await supabase.rpc('admin_set_cod_paid', {
    p_order_id: orderId,
    p_paid: paid,
  })
  if (error) {
    if (isDeniedError(error)) return { notAdmin: true }
    if (isSchemaError(error)) return { needsMigration: true }
    // The function raises named errors; turn them into something an operator
    // can act on rather than showing raw Postgres text.
    const m = `${error.message || ''}`
    if (m.includes('not_a_cash_order')) return { error: 'That is not a cash order — card payments are confirmed by the bank, not here.' }
    if (m.includes('order_not_pending')) return { error: 'Only a pending cash order can be marked paid.' }
    if (m.includes('order_not_paid')) return { error: 'That order is not marked paid.' }
    if (m.includes('order_not_found')) return { error: 'Order not found — refresh the list.' }
    return { error: error.message }
  }
  const row = Array.isArray(data) ? data[0] : data
  return { order: row ?? null }
}

export async function saveCustomer(orderId, fields) {
  if (!ready()) return { error: NOT_CONFIGURED }
  const { error } = await supabase.from('orders').update(fields).eq('id', orderId)
  return error ? { error: error.message } : {}
}

// ---------------------------------------------------------------------------
// Catalogue sync.
//
// Orders are priced from the products table, so an empty table means every
// checkout dies with "Order has no payable amount". This pushes the catalogue
// that ships with the front end into Supabase, matching on slug so re-running
// it updates rather than duplicating.
// ---------------------------------------------------------------------------
export function catalogRows() {
  return PRODUCTS.map((p) => ({
    slug: p.slug,
    name_en: p.name.en,
    name_ar: p.name.ar,
    desc_en: p.desc?.en ?? null,
    desc_ar: p.desc?.ar ?? null,
    price: Number(p.price),
    category: p.category ?? null,
    // Placeholder art is a data: URI and far too long for a row; leave the
    // column empty so real photo URLs can be pasted in later.
    image: p.image?.startsWith('http') ? p.image : null,
    active: true,
  }))
}

export async function fetchCatalogState() {
  if (!ready()) return { error: NOT_CONFIGURED, rows: [] }
  const { data, error } = await supabase.from('products').select('slug, price, active')
  if (error) {
    return isSchemaError(error) ? { needsMigration: true, rows: [] } : { error: error.message, rows: [] }
  }
  const bySlug = new Map((data ?? []).map((r) => [r.slug, r]))
  const local = catalogRows()
  return {
    rows: local.map((r) => {
      const remote = bySlug.get(r.slug)
      return {
        slug: r.slug,
        name_en: r.name_en,
        price: r.price,
        state: !remote
          ? 'missing'
          : Number(remote.price) !== r.price
            ? 'differs'
            : 'ok',
        remotePrice: remote ? Number(remote.price) : null,
      }
    }),
    extra: (data ?? []).filter((r) => !local.some((l) => l.slug === r.slug)).map((r) => r.slug),
  }
}

export async function syncCatalog() {
  if (!ready()) return { error: NOT_CONFIGURED }
  const rows = catalogRows()
  const { error } = await supabase.from('products').upsert(rows, { onConflict: 'slug' })
  return error ? { error: error.message } : { count: rows.length }
}

// ---------------------------------------------------------------------------

export function toCsv(orders) {
  // Ordered so the sheet reads left to right as order → money → who → where,
  // which is how it gets handed to a courier.
  const cols = [
    // payment_method belongs next to the money: without it the courier sheet
    // cannot tell the driver which deliveries have cash to collect, which is
    // the one thing the driver has to know.
    'track_id', 'created_at', 'paid_at', 'amount', 'payment_status', 'payment_method',
    'fulfilment_status', 'customer_name', 'customer_phone',
    'customer_governorate', 'customer_area', 'customer_block', 'customer_street',
    'customer_building', 'customer_floor', 'customer_flat', 'customer_note',
    'cbk_paymentid', 'cbk_reference',
  ]
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...orders.map((o) => cols.map((c) => esc(o[c])).join(','))].join('\n')
}
