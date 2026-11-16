// The discount badge's percentage: how much less the shopper pays than the old
// price, as a whole number.
//
// DISPLAY ONLY. The server decides every price: a sale price inside its window
// (store_effective_price) arrives as `price`, the amount charged, and the old
// price as `list_price`, which the storefront strikes through. This reads those
// two numbers and says how big the cut is. It never changes what is charged, and
// the checkout and the cart keep reading `price` alone.
//
// Returns null when there is nothing to show: no sale, a price that is not
// lower than the list price, a missing or zero number, or a cut that rounds to
// 0 or to 100 (100 would read as "free", which the badge must never imply).
export function discountPercent(list, price) {
  const l = Number(list)
  const p = Number(price)
  if (!Number.isFinite(l) || !Number.isFinite(p)) return null
  if (l <= 0 || p <= 0 || p >= l) return null
  const pct = Math.round(((l - p) / l) * 100)
  return pct >= 1 && pct <= 99 ? pct : null
}
