// Where this visit came from.
//
// THE PROBLEM THIS SOLVES. A shopper clicks an Instagram ad, lands on a product
// deep link carrying ?utm_source=instagram, then taps through to the shop, the
// bag and the checkout. By the time they order, the URL that named the campaign
// is four navigations in the past and the order records nothing. The owner sees
// forty sales and cannot tell which campaign paid for them.
//
// So the campaign is read once, on arrival, and kept for the visit.
//
// sessionStorage, NOT localStorage, and the difference is the whole policy: a
// campaign is a property of THIS visit. In localStorage an ad clicked in March
// would still be claiming credit for an order placed in June, which is worse
// than no attribution because it is confidently wrong. Session scope ends when
// the tab closes, which is what "this visit" means.
//
// LAST TOUCH WINS. If a shopper arrives from one ad, leaves, and comes back
// from another in the same session, the newer one is recorded. That matches how
// every ad platform reports and avoids the owner reading one answer here and a
// different one in their dashboard. Nothing is overwritten by a plain internal
// navigation — only a genuinely new campaign replaces the old one.

const KEY = 'sporta_attribution'

// Only these, and nothing else. An allow-list rather than "everything that
// starts with utm_" because the query string is attacker-controlled: a link
// with fifty invented parameters must not become fifty things to store.
//
// Click identifiers (fbclid, gclid) are deliberately absent — see
// attribution.mysql.sql. They are the most identifying part of an ad URL and
// are only useful for a conversions API this shop does not have.
const FIELDS = ['utm_source', 'utm_medium', 'utm_campaign']

// Short. These are labels the owner typed into an ad platform, not prose, and a
// cap here means the server never has to reject an order over a long URL.
const MAX = 60

const clean = (v) => {
  if (typeof v !== 'string') return null
  // Printable, trimmed, capped. Anything else is not a campaign name.
  const s = v.trim().slice(0, MAX)
  return s === '' ? null : s
}

// The host we came FROM, never the full URL — a referrer can carry a search
// query or the path of a private page, and neither is the shop's business.
function referrerHost() {
  try {
    if (!document.referrer) return null
    const h = new URL(document.referrer).hostname
    // Our own pages are not a referrer worth recording.
    if (h === location.hostname) return null
    return h.slice(0, 120)
  } catch {
    return null
  }
}

// Read the current URL and remember it if it names a campaign. Called once on
// boot; safe to call again.
export function captureAttribution() {
  try {
    const q = new URLSearchParams(location.search)
    const found = {}
    for (const f of FIELDS) {
      const v = clean(q.get(f))
      if (v) found[f] = v
    }

    const prev = read()

    // A new campaign replaces the old one. A page with no campaign params does
    // NOT clear what is already remembered — otherwise the second click of the
    // visit would erase the ad that brought them.
    if (found.utm_source) {
      const ref = prev?.referrer_host ?? referrerHost()
      write(ref ? { ...found, referrer_host: ref } : found)
      return
    }

    // No campaign, and nothing remembered yet: keep the referrer, which is how
    // an organic visit from a social post is told apart from a direct one.
    if (!prev) {
      const ref = referrerHost()
      if (ref) write({ referrer_host: ref })
    }
  } catch {
    // Private mode, storage disabled, a malformed URL. Attribution is a
    // reporting nicety and must never be the reason a shop fails to load.
  }
}

function read() {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function write(v) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    /* storage full or blocked — see above */
  }
}

// What the order should carry. Returns undefined when there is nothing to say,
// so the checkout payload stays clean rather than gaining four nulls.
export function orderAttribution() {
  const a = read()
  if (!a) return undefined
  const out = {}
  for (const f of [...FIELDS, 'referrer_host']) if (a[f]) out[f] = a[f]
  return Object.keys(out).length ? out : undefined
}
