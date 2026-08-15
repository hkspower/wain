import { phpStock } from './backend'

// Per-size availability for one product, read from /api.
//
// WHY THE PUBLIC ENDPOINT AND NOT THE TABLE
// product_variants also holds cost_aed — what Sporta paid AHED per piece. That
// is not shop-window data, so ?r=stock selects the shop-window columns only
// and the wholesale cost never leaves the server on this path. (The admin's
// own route does return it; that one is behind the session.)
//
// EVERY FAILURE RETURNS null, NOT AN EMPTY MAP
// null means "we do not know", and the caller then offers the full size range
// exactly as it did before this table existed. An empty map would mean
// "nothing is in stock" and would take every size button away — so a shop mid
// migration, or a moment of bad connectivity, must never produce one.

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

// Deliberately module state and not sessionStorage: availability is the one
// value here that must NOT survive a reload. A shopper who reloads because
// something looked wrong should get the truth.

async function loadAll() {
  try {
    return shape(await phpStock())
  } catch {
    return null
  }
}

// Rows -> { slug: { size: { sku, stock, inStock } } }
function shape(data) {
  if (!Array.isArray(data) || !data.length) return null
  const bySlug = {}
  for (const r of data) {
    ;(bySlug[r.slug] ??= {})[r.size] = { sku: r.sku, stock: r.stock, inStock: r.in_stock }
  }
  return bySlug
}

// The WHOLE table, or null if we do not have it.
//
// fetchStock(slug) collapses two different answers into null — "this product
// has no size rows" and "we could not load the table" — and the grid needs to
// tell them apart. On an accessory, quick-add is correct; on a garment whose
// sizes we cannot see, it is not, because the server refuses a size-less line
// for anything that has sizes. Same cache, same shared request: a grid of
// twelve cards asking at once still makes one.
export async function fetchStockTable() {
  if (cache) {
    if (Date.now() - cache.at >= TTL_MS) revalidate()
    return cache.bySlug
  }
  await revalidate()
  return cache?.bySlug ?? null
}

export async function fetchStock(slug) {
  if (!slug) return null
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
