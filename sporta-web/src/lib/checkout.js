import { configValue } from './runtimeConfig'

// Base URL of the PHP payment endpoints on Hostinger. Classic KNET (KPG) lives
// in public_html/knet/. (For the CBK REST-JSON T-Pay model it would be /pay.)
// Settable from /config.js so the endpoints can move without a rebuild.
const PAY_BASE =
  configValue('payBaseUrl', import.meta.env.VITE_PAY_BASE_URL) || 'https://www.sporta.com.kw/knet'

// Unique, CBK-safe track id (alphanumeric, <= 30 chars).
export function makeTrackId(prefix = 'SP') {
  const r = crypto.getRandomValues(new Uint32Array(2))
  return `${prefix}${r[0].toString(36)}${r[1].toString(36)}`.slice(0, 30).toUpperCase()
}

// Carries the machine token raised by create_order, so the page can show a
// translated message instead of raw database text.
export class CheckoutError extends Error {
  constructor(token, detail) {
    super(token)
    this.name = 'CheckoutError'
    this.token = token
    this.detail = detail
  }
}

// create_order raises stable tokens ('invalid_phone', 'unavailable_nba-cap').
// Anything else — a network drop, a paused project — becomes a generic
// failure rather than leaking a Postgres message to a shopper.
function tokenFor(error) {
  const m = String(error?.message ?? '').match(
    /\b(invalid_track_id|order_not_pending|empty_cart|cart_too_large|invalid_phone|invalid_governorate|invalid_qty|zero_amount|missing_[a-z]+|too_long_[a-z]+|unavailable_[\w-]+)\b/,
  )
  return m ? m[1] : 'failed'
}

// Create the order, then hand the shopper to the bank.
//
// Everything goes through the create_order RPC, which is now the only path
// that can write an order. It validates the delivery details, resolves the
// cart against the products table, and returns the total it computed from the
// stored prices.
//
// No price is sent from here, and pay.php is called with no `amount`
// parameter at all — it reads the figure from the order it looks up. That is
// what makes the amount untamperable end to end.
export async function startCheckout({ items, lang = 'en', customer }) {
  const { supabase } = await import('./supabase')

  // Fail closed. With no database there is nowhere to record the order or the
  // address, and pay.php would fall back to charging whatever the browser
  // asked for. Taking money for an order nobody wrote down, to an address
  // nobody captured, is worse than not taking it.
  if (!supabase) throw new CheckoutError('unconfigured')

  const trackId = makeTrackId()
  const { data, error } = await supabase.rpc('create_order', {
    p_track_id: trackId,
    p_items: items.map((i) => ({ slug: i.slug, qty: i.qty })),
    p_customer: customer,
  })
  if (error) throw new CheckoutError(tokenFor(error), error.message)
  if (!data?.track_id) throw new CheckoutError('failed')

  const params = new URLSearchParams({ trackid: data.track_id, lang })
  window.location.href = `${PAY_BASE}/pay.php?${params.toString()}`
  return data
}
