// KWD money formatting via the Intl API — correct digits, grouping and
// currency placement per locale, instead of hand-built strings.
// Kuwaiti Dinar uses 3 decimal places.
const formatters = new Map()

function formatter(lang) {
  let f = formatters.get(lang)
  if (!f) {
    f = new Intl.NumberFormat(lang === 'ar' ? 'ar-KW' : 'en-KW', {
      style: 'currency',
      currency: 'KWD',
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
      // Keep Latin digits in Arabic so prices stay scannable next to the
      // Latin brand names used across the catalogue.
      numberingSystem: 'latn',
    })
    formatters.set(lang, f)
  }
  return f
}

export function formatKWD(amount, lang = 'en') {
  const n = typeof amount === 'string' ? Number.parseFloat(amount) : amount
  return formatter(lang).format(Number.isFinite(n) ? n : 0)
}
