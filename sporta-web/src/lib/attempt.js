// The checkout ATTEMPT: one track id per attempt, not per tap.
//
// Its own module, with no import.meta.env in it, for two reasons. It is pure
// logic — no payment endpoints, no Supabase — and keeping it separate is what
// lets scripts/quick-checkout-test.mjs import and exercise it in plain Node,
// which is the only way to prove the property that matters here without
// standing up a bank.
//
// THE BUG THIS FIXES. create_order has an idempotency guard: the same track_id
// for an order still pending returns that order rather than creating a second.
// It could never fire, because the browser minted a fresh id on every call. So
// a shopper who tapped Pay, hit a slow network and tapped again got TWO orders;
// so did anyone who backed out of the bank page to try a different card. The
// shop was then holding two pending orders for one bag with nothing to say they
// were the same one.

// Unique, CBK-safe track id (alphanumeric, <= 30 chars).
export function makeTrackId(prefix = 'SP') {
  const r = crypto.getRandomValues(new Uint32Array(2))
  return `${prefix}${r[0].toString(36)}${r[1].toString(36)}`.slice(0, 30).toUpperCase()
}

// The track id for THIS attempt, stable across retries.
//
// Keyed on a fingerprint of the bag, the address and the method, and kept in
// sessionStorage — not localStorage: a track id that outlived the browser tab
// would have someone reopening the shop a week later and being handed the same
// order number for a different bag. Session scope is exactly the life of "I am
// trying to check out right now".
const ATTEMPT_KEY = 'sporta.checkout.attempt'

function fingerprint({ items, customer, paymentMethod }) {
  const lines = items
    .map((i) => `${i.slug}:${i.qty}:${i.size ?? ''}:${i.fit ?? ''}`)
    .sort()
    .join('|')
  const who = [
    customer?.phone, customer?.name, customer?.governorate, customer?.area,
    customer?.block, customer?.street, customer?.building, customer?.floor, customer?.flat,
  ].join('|')
  // djb2. Not a security hash — nothing is protected by it. It only has to
  // change when the order changes, and be the same string twice in a row.
  let h = 5381
  const src = `${lines}#${who}#${paymentMethod}`
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export function attemptTrackId(order) {
  const fp = fingerprint(order)
  try {
    const saved = JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) || 'null')
    if (saved?.fp === fp && saved?.id) return saved.id
    const id = makeTrackId()
    sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify({ fp, id }))
    return id
  } catch {
    // Private mode, or storage full. A fresh id every time is the old
    // behaviour: worse, but never a reason to fail a checkout.
    return makeTrackId()
  }
}

// Called once an order is actually placed, so the next checkout in the same tab
// starts a new attempt rather than colliding with a completed one.
export function clearAttempt() {
  try {
    sessionStorage.removeItem(ATTEMPT_KEY)
  } catch {
    /* nothing to clear */
  }
}

