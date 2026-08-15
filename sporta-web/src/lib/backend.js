import { configValue } from './runtimeConfig'
import { orderAttribution } from './attribution'

// The backend. There is one.
//
// This shop ran on a hosted Postgres backend, then on a runtime switch between
// that and a native MySQL + PHP backend on the same Hostinger plan, and now on
// the native one alone. Every hosted code path is gone: no second database to
// keep in step, no `backend` flag in config.js, no third-party account in the
// money path, no service key to leak.
//
// What that removes is not only code. Two backends meant every rule existed
// twice — validation tokens, price authority, the fulfilment outbox, the
// response shapes the admin screens read — and a fix applied to one was a bug
// waiting in the other. Not a theory: the KNET dropin was hardened against a
// browser-supplied price and the T-Pay dropin was not, and it stayed that way
// until a test went looking for it.
//
// The API lives at /api, on the same host as the payment endpoints.
// `phpApiUrl` exists only so a test rig can point somewhere else.

export const phpBase = () => configValue('phpApiUrl', import.meta.env.VITE_PHP_API_URL) || '/api'

async function phpGet(route) {
  const res = await fetch(`${phpBase()}/api.php?r=${route}`, { credentials: 'omit' })
  if (!res.ok) return null
  return res.json()
}

// ------------------------------------------------------------- storefront

export const phpProducts = () => phpGet('products')
export const phpStock = () => phpGet('stock')
export const phpBrands = () => phpGet('brands')
// The home hero, its playback settings and the promo bar, in one request —
// they are painted by the same screen at the same moment, and three round
// trips to draw one header is three too many.
// ONE request per page load, shared.
//
// Two components want this payload — the hero wants the slides, the navbar
// wants the promo bar — and they mount together on the home page. Without the
// cache that is two identical requests for one document. The promise is cached,
// not the value, so simultaneous callers join the request already in flight
// rather than starting a second one.
//
// Deliberately per page load and not longer: the shop is a SPA, and an owner
// who edits the bar and reloads must see the change.
let slidesOnce = null
export function phpSlides() {
  if (!slidesOnce) slidesOnce = phpSlidesFetch().catch((e) => { slidesOnce = null; throw e })
  return slidesOnce
}

async function phpSlidesFetch() {
  const d = await phpGet('slides')
  if (!d?.slides) return d
  // api.php returns the image as a path RELATIVE TO ITSELF, because it does not
  // know what the API is mounted at — /api by default, but config.js may point
  // it anywhere. Resolving it here is the one place that knows both. Left
  // relative it resolved against the PAGE, so the home page asked for
  // /api.php?r=slide_image and got a 404-shaped broken image.
  return { ...d, slides: d.slides.map((s) => ({ ...s, image: `${phpBase()}/${s.image}` })) }
}
// Check a coupon before the customer commits. The server re-prices the cart
// from the products table rather than trusting a subtotal, so this preview is
// the number create_order will charge — computed by the same code.
export async function phpDiscountCheck({ items, code }) {
  const res = await fetch(`${phpBase()}/api.php?r=discount`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify({ items, code }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.error) {
    const err = new Error(body?.error ?? 'failed')
    err.token = body?.error ?? 'failed'
    throw err
  }
  return body
}
export const phpOrderStatus = (trackId) => phpGet(`status&id=${encodeURIComponent(trackId)}`)
export const phpOrderInvoice = (trackId) => phpGet(`invoice&id=${encodeURIComponent(trackId)}`)

// Create an order. Throws the machine tokens api.php raises, so checkout.js's
// messageFor() turns them into something a shopper can act on.
export async function phpCreateOrder({ trackId, items, customer, paymentMethod, discountCode = '', lang }) {
  const res = await fetch(`${phpBase()}/api.php?r=order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify({
      track_id: trackId,
      items,
      customer,
      payment_method: paymentMethod,
      discount_code: discountCode,
      // Which language the shopper was READING. It picks the WhatsApp template
      // they get later, and this is the only moment it can be known — by the
      // time the message is queued the browser is gone. Falls back to the
      // <html lang> the boot script set, so an order placed from a page this
      // function was called without a language still records the right one.
      lang: lang ?? (typeof document !== 'undefined' ? document.documentElement.lang : undefined),
      // Which ad this visit came from, captured on the landing page. Omitted
      // entirely when there is nothing to say, so a direct visit does not send
      // four nulls. The server whitelists and caps it again — this is a report,
      // and a report assembled in the browser is attacker-controlled.
      attribution: orderAttribution(),
    }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.error) {
    const err = new Error(body?.error ?? 'failed')
    err.token = body?.error ?? 'failed'
    throw err
  }
  return body
}

// ------------------------------------------------------------------ admin

// Session-cookie auth, same origin. The X-Sporta-Admin header is half of the
// CSRF defence (SameSite=Strict on the cookie is the other half) — the PHP
// side refuses admin routes without it.
export async function phpAdmin(route, { method = 'GET', body } = {}) {
  const res = await fetch(`${phpBase()}/admin.php?r=${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Sporta-Admin': '1',
    },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}
