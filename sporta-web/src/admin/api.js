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

export const PAYMENT_STATES = ['paid', 'pending', 'review', 'failed']
export const FULFILMENT_STATES = ['unfulfilled', 'packed', 'shipped', 'delivered', 'cancelled']

function ready() {
  return Boolean(supabase)
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
    return isSchemaError(error) ? { needsMigration: true } : { error: error.message }
  }
  const row = Array.isArray(data) ? data[0] : data
  return { stats: row ?? null }
}

export async function fetchRevenueDaily(days = 14) {
  if (!ready()) return { series: [] }
  const { data, error } = await supabase.rpc('admin_revenue_daily', { p_days: days })
  if (error) return isSchemaError(error) ? { needsMigration: true, series: [] } : { series: [] }
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
    'track_id', 'created_at', 'paid_at', 'amount', 'payment_status',
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
