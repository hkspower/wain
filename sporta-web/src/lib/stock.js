import { supabase } from './supabase'

// Per-size availability for one product, read from the public product_stock
// view (see supabase/ahed-inventory-migration.sql).
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
export async function fetchStock(slug) {
  if (!supabase || !slug) return null
  const { data, error } = await supabase
    .from('product_stock')
    .select('size, sku, stock, in_stock')
    .eq('slug', slug)
  if (error || !data?.length) return null
  const bySize = {}
  for (const r of data) bySize[r.size] = { sku: r.sku, stock: r.stock, inStock: r.in_stock }
  return bySize
}

// The last few of something is a real reason to decide now, and it is also the
// only honest use of urgency: it is a fact about the shelf, not a countdown we
// invented. Above this, say nothing.
export const LOW_STOCK_AT = 3
