import { configValue } from './runtimeConfig'

// Which backend is this shop running on?
//
// Two answers, and public_html/config.js decides between them with no rebuild:
//
//   backend: 'php'   -> the NATIVE backend: MySQL on the same Hostinger plan,
//                       PHP at /api on the same host as the payment endpoints.
//                       No Supabase anywhere.
//   anything else    -> Supabase, exactly as before.
//
// The native path exists so the shop can run with no third-party backend at
// all — the model the owner's previous OpenCart site used. It is a SWITCH, not
// a migration: the Supabase code paths are untouched, and flipping config.js
// back restores them. Both backends enforce the same contract (same validation
// tokens, same response shapes), which is what scripts/native-backend-test.mjs
// exists to prove.

export const usingPhp = () => configValue('backend', import.meta.env.VITE_BACKEND) === 'php'

// Where the PHP API lives. Same origin in production ('/api'); absolute only
// in tests, where the API runs on its own port.
export const phpBase = () => configValue('phpApiUrl', import.meta.env.VITE_PHP_API_URL) || '/api'

async function phpGet(route) {
  const res = await fetch(`${phpBase()}/api.php?r=${route}`, { credentials: 'omit' })
  if (!res.ok) return null
  return res.json()
}

// ------------------------------------------------------------- storefront

export const phpProducts = () => phpGet('products')
export const phpStock = () => phpGet('stock')
export const phpOrderStatus = (trackId) => phpGet(`status&id=${encodeURIComponent(trackId)}`)
export const phpOrderInvoice = (trackId) => phpGet(`invoice&id=${encodeURIComponent(trackId)}`)

// Create an order. Throws the same machine tokens create_order raises, so
// checkout.js's messageFor() translations work unchanged on both backends.
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
