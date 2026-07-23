import { amountForGateway } from './format'

// Base URL of the PHP payment endpoints on Hostinger (public_html/pay/).
const PAY_BASE = import.meta.env.VITE_PAY_BASE_URL || 'https://www.sporta.com.kw/pay'

// Unique, CBK-safe track id (alphanumeric, <= 30 chars).
export function makeTrackId(prefix = 'SP') {
  const r = crypto.getRandomValues(new Uint32Array(2))
  return `${prefix}${r[0].toString(36)}${r[1].toString(36)}`.slice(0, 30).toUpperCase()
}

// Create a pending order (best-effort) then redirect to CBK payment.
export async function startCheckout({ items, total, lang = 'en', ref = 'Sporta order' }) {
  const trackId = makeTrackId()
  const amount = amountForGateway(total)

  // Create a pending order + line items in Supabase if configured. The DB
  // trigger computes the authoritative amount from product prices — the client
  // never sets the price it pays (see supabase/schema.sql). Non-blocking.
  try {
    const { supabase } = await import('./supabase')
    if (supabase) {
      const { data: order, error } = await supabase
        .from('orders')
        .insert({ track_id: trackId }) // amount defaults 0, computed by trigger
        .select('id')
        .single()
      if (!error && order && items?.length) {
        // Map cart slugs -> product ids so items reference real products.
        const { data: prods } = await supabase
          .from('products')
          .select('id, slug')
          .in('slug', items.map((i) => i.slug))
        const idBySlug = Object.fromEntries((prods ?? []).map((p) => [p.slug, p.id]))
        const rows = items
          .filter((i) => idBySlug[i.slug])
          .map((i) => ({ order_id: order.id, product_id: idBySlug[i.slug], qty: i.qty }))
        if (rows.length) await supabase.from('order_items').insert(rows)
      }
    }
  } catch {
    /* proceed to payment even if the pre-record fails */
  }

  // pay.php uses the order's server-computed amount when the DB is configured;
  // the client amount is only a fallback for the no-DB (static) case.
  const params = new URLSearchParams({ amount, trackid: trackId, ref, lang })
  window.location.href = `${PAY_BASE}/pay.php?${params.toString()}`
}
