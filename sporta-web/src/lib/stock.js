import { configValue } from './runtimeConfig'
import { usingPhp, phpStock } from './backend'

// Per-size availability for one product, read from the public product_stock
// view (see supabase/ahed-inventory-migration.sql).
//
// ===================== WHY THIS DOES NOT USE supabase-js =====================
// It did, and it cost 201 kB of JavaScript on every product page. Measured with
// V8 coverage at 390pt: /product/<slug> parsed 493 kB of JS and executed 148 kB,
// and the single worst entry was supabase-CVdYv1wD.js — 194 kB of 201 kB never
// executed. The whole client library, its auth, realtime and storage modules,
// pulled in to read five columns from one view.
//
// PostgREST is a REST API. One GET with two headers is the entire request that
// supabase-js would have built, so the library buys nothing here. The auth,
// session refresh and realtime machinery are genuinely needed on the admin and
// at checkout, and those pages still import the client — this is the storefront
// path, where none of it is.
//
// WHY A VIEW AND NOT THE TABLE
// product_variants also holds cost_aed — what Sporta paid AHED per piece. That
// is not shop-window data, so the anon key can only reach the view, which does
// not select it.
//
// EVERY FAILURE RETURNS null, NOT AN EMPTY MAP
// null means "we do not know", and the caller then offers the full size range
// exactly as it did before this table existed. An empty map would mean "nothing
// is in stock" and would take every size button away — so a shop that has not
// run the migration, or a moment of bad connectivity, must never produce one.
const url = configValue('supabaseUrl', import.meta.env.VITE_SUPABASE_URL)
const anonKey = configValue('supabaseAnonKey', import.meta.env.VITE_SUPABASE_ANON_KEY)

// One request for the whole table, cached, rather than one per product page.
//
// The first version asked for a single slug every time a product page mounted,
// so browsing six products was six round trips for 42 rows that in total are a
// couple of kilobytes — and clicking back to a product already seen went to the
// network again. This fetches all of it once and answers from memory afterwards.
//
// TTL is short because stock is the one thing on the page that goes stale in a
// way that matters: two minutes is long enough to cover a browsing session and
// short enough that a size selling out is reflected while someone is still
// shopping. The authority is not this cache in any case — an order is priced and
// recorded server-side, so a stale "in stock" costs an apology, not money.
const TTL_MS = 2 * 60 * 1000

let cache = null // { at: epochMs, bySlug: { slug: { size: {...} } } }
let inflight = null // shared promise, so six mounts at once make one request

// Deliberately module state and not sessionStorage. Availability is the one
// value here that must not survive a reload — a shopper who reloads because
// something looked wrong should get the truth, and this is also the reason the
// site stores no more in the browser than it already does.
export function clearStockCache() {
  cache = null
  inflight = null
}

async function loadAll() {
  // Native mode: same rows, same columns, one origin. The cache, the TTL and
  // the shared in-flight promise above apply identically — only the transport
  // differs.
  if (usingPhp()) {
    try {
      const data = await phpStock()
      return shape(data)
    } catch {
      return null
    }
  }
  if (!url || !anonKey) return null
  // Exactly the request supabase-js would have sent for
  // .from('product_stock').select('slug, size, sku, stock, in_stock')
  const res = await fetch(
    `${url}/rest/v1/product_stock?select=slug,size,sku,stock,in_stock`,
    {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      // No credentials: the anon key is the whole authentication, and sending
      // cookies to Supabase would be pointless as well as unnecessary.
      credentials: 'omit',
    },
  )
  if (!res.ok) return null
  const data = await res.json()
  return shape(data)
}

// Rows -> { slug: { size: { sku, stock, inStock } } }, shared by both backends
// so the two cannot drift in how availability is read.
function shape(data) {
  if (!Array.isArray(data) || !data.length) return null
  const bySlug = {}
  for (const r of data) {
    ;(bySlug[r.slug] ??= {})[r.size] = { sku: r.sku, stock: r.stock, inStock: r.in_stock }
  }
  return bySlug
}

export async function fetchStock(slug) {
  if (!slug) return null
  // The Supabase guard only applies on the Supabase path — native mode has no
  // anon key and must not be silenced by its absence.
  if (!usingPhp() && (!url || !anonKey)) return null

  // Stale-while-revalidate, matching what the .htaccess now does for the shell:
  // answer from the copy in hand at once and refresh behind it, so only the very
  // first product page of a visit waits on the network.
  if (cache) {
    if (Date.now() - cache.at >= TTL_MS) revalidate()
    return cache.bySlug[slug] ?? null
  }

  // Nothing cached yet: this one has to wait. Six product cards mounting at
  // once share the single request rather than making six.
  await revalidate()
  return cache?.bySlug?.[slug] ?? null
}

function revalidate() {
  if (inflight) return inflight
  inflight = loadAll()
    .then((bySlug) => {
      // A failed refresh must not throw away a good cache — that would turn one
      // dropped request into every size button reverting to the generic range.
      if (bySlug) cache = { at: Date.now(), bySlug }
      return bySlug
    })
    .catch(() => null)
    .finally(() => {
      inflight = null
    })
  return inflight
}

// The last few of something is a real reason to decide now, and it is also the
// only honest use of urgency: it is a fact about the shelf, not a countdown we
// invented. Above this, say nothing.
export const LOW_STOCK_AT = 3
