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

  // Record a pending order in Supabase if configured (non-blocking).
  try {
    const { supabase } = await import('./supabase')
    if (supabase) {
      await supabase.from('orders').insert({
        track_id: trackId,
        amount,
        payment_status: 'pending',
        items: items?.map((i) => ({ slug: i.slug, qty: i.qty, price: i.price })) ?? null,
      })
    }
  } catch {
    /* proceed to payment even if the pre-record fails */
  }

  const params = new URLSearchParams({ amount, trackid: trackId, ref, lang })
  window.location.href = `${PAY_BASE}/pay.php?${params.toString()}`
}
