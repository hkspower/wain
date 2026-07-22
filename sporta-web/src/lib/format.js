// KWD money formatting. Kuwait Dinar has 3 decimal places.
export function formatKWD(amount, lang = 'en') {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount
  const value = Number.isFinite(n) ? n.toFixed(3) : '0.000'
  return lang === 'ar' ? `${value} د.ك` : `${value} KWD`
}

// CBK expects the amount as a plain number string with up to 3 decimals.
export function amountForGateway(amount) {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount
  return Number.isFinite(n) ? n.toFixed(3) : '0.000'
}
