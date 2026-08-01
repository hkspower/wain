import { configValue } from './runtimeConfig'

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
export const phpOrderStatus = (trackId) => phpGet(`status&id=${encodeURIComponent(trackId)}`)
export const phpOrderInvoice = (trackId) => phpGet(`invoice&id=${encodeURIComponent(trackId)}`)

// Create an order. Throws the machine tokens api.php raises, so checkout.js's
// messageFor() turns them into something a shopper can act on.
export async function phpCreateOrder({ trackId, items, customer, paymentMethod }) {
  const res = await fetch(`${phpBase()}/api.php?r=order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify({
      track_id: trackId,
      items,
      customer,
      payment_method: paymentMethod,
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
