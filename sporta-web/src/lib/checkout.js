import { configValue } from './runtimeConfig'
import { attemptTrackId, clearAttempt, makeTrackId } from './attempt'
import { phpCreateOrder } from './backend'

// Re-exported so the pages that use them keep importing from one place: a page
// should not have to know that the attempt logic lives in its own file to be
// testable.
export { attemptTrackId, clearAttempt, makeTrackId }

// Base URL of the PHP payment endpoints on Hostinger. Classic KNET (KPG) lives
// in public_html/knet/. (For the CBK REST-JSON T-Pay model it would be /pay.)
// Settable from /config.js so the endpoints can move without a rebuild.
// Two gateways, two folders. They are separate integrations with separate
// credentials, not two names for one thing:
//   /knet  classic KNET — Tranportal id + resource key, AES trandata
//   /pay   CBK hosted   — ClientId + ClientSecret + ENCRP_KEY, and the only
//                         one that can do T-Pay QR (tij_MerchPayType = 2)
const PAY_BASE =
  configValue('payBaseUrl', import.meta.env.VITE_PAY_BASE_URL) || 'https://www.sporta.com.kw/knet'
const CBK_BASE =
  configValue('cbkBaseUrl', import.meta.env.VITE_CBK_BASE_URL) || 'https://www.sporta.com.kw/pay'

// Carries the machine token raised by create_order, so the page can show a
// translated message instead of raw database text.
class CheckoutError extends Error {
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
    /\b(invalid_track_id|order_not_pending|empty_cart|cart_too_large|invalid_phone|invalid_governorate|invalid_qty|zero_amount|missing_[a-z]+|too_long_[a-z]+|unavailable_[\w-]+|invalid_payment_method)\b/,
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
export async function startCheckout({ items, lang = 'en', customer, paymentMethod = 'knet', discountCode = '' }) {
  // ONE TRACK ID PER ATTEMPT, NOT PER TAP.
  //
  // create_order has an idempotency guard — same track_id, same pending order,
  // returned rather than duplicated — and it could never fire, because this
  // line minted a fresh id on every call. So a shopper who tapped Pay, hit a
  // slow network, and tapped again got TWO orders; so did anyone who backed out
  // of the bank page and came back to try a different card. The shop then has
  // two pending orders for one bag and no way to tell they are the same one.
  //
  // The id is now derived from what is being ordered: the same bag to the same
  // address is the same attempt and reuses it. Change the bag and it changes,
  // because that is genuinely a different order.
  // The code is part of the attempt: entering one after a first tap is a
  // genuinely different order, and reusing the id would return the earlier
  // pending order at the OLD price and quietly ignore the code.
  const trackId = attemptTrackId({ items, customer, paymentMethod, discountCode })

  // size and fit travel with the line on BOTH backends. They are options, not
  // prices: each server validates them against a fixed list and still reads
  // the price from its products table, so nothing here can change what is
  // charged.
  const line = (i) => ({
    slug: i.slug,
    qty: i.qty,
    ...(i.size ? { size: i.size } : {}),
    ...(i.fit ? { fit: i.fit } : {}),
  })

  // The order is created by /api on the same host as the payment endpoints.
  // phpCreateOrder throws with .token carrying the machine tokens api.php
  // raises, so messageFor() in Checkout.jsx turns them into a sentence.
  let data
  try {
    // The code travels; the AMOUNT never does. api.php looks the code up,
    // decides what it is worth and writes orders.amount — which is the number
    // pay.php later hands the bank. A discount the browser could name would be
    // a price the browser could set.
    data = await phpCreateOrder({
      trackId, items: items.map(line), customer, paymentMethod, discountCode,
    })
  } catch (e) {
    throw new CheckoutError(e.token ?? 'failed', e.message)
  }
  if (!data?.track_id) throw new CheckoutError('failed')

  // Cash on delivery never touches the bank. The order is recorded and the
  // shopper goes straight to the result page — sending them to pay.php would
  // ask them to pay twice.
  if (paymentMethod === 'cod') {
    window.location.href = `/payment/result?status=cod&trackid=${encodeURIComponent(data.track_id)}`
    return data
  }

  // T-Pay is the CBK hosted page with the QR payment type selected. No amount
  // is sent here either — pay.php reads the order's stored amount, so the
  // browser cannot influence what is charged on either gateway.
  if (paymentMethod === 'tpay') {
    const p = new URLSearchParams({ trackid: data.track_id, lang, paytype: '2' })
    window.location.href = `${CBK_BASE}/pay.php?${p.toString()}`
    return data
  }

  const params = new URLSearchParams({ trackid: data.track_id, lang })
  window.location.href = `${PAY_BASE}/pay.php?${params.toString()}`
  return data
}
