import { lazy } from 'react'

// The admin's screens, each its own chunk.
//
// They were eight static imports in AdminApp.jsx, so opening /backends
// downloaded the code of every screen (Slides, Discounts, Inventory ...)
// before the first one could draw, and each new screen made that first load
// heavier. Now AdminApp is the shell, and a screen's code travels only when its
// tab is opened — or, a moment earlier, when the pointer or a finger reaches the
// tab (warmScreen).
//
// Every entry is a literal import() on purpose: the bundler can only split on
// a specifier it can read, so a table built from strings would put everything
// back in one chunk.
const LOADERS = {
  overview: () => import('./Overview'),
  orders: () => import('./Orders'),
  profiles: () => import('./Profiles'),
  catalog: () => import('./Catalog'),
  brands: () => import('./Brands'),
  slides: () => import('./Slides'),
  promos: () => import('./Promotions'),
  discounts: () => import('./Discounts'),
  stock: () => import('./Inventory'),
  settings: () => import('./Settings'),
}

export const SCREEN_IDS = Object.keys(LOADERS)

// One import per screen, shared by the prefetch and the render, so a tab that
// was warmed on hover is not asked for twice.
const loading = new Map()

// How many times a screen's import has failed. It is also the cache-buster of
// the next try, because a browser REMEMBERS a failed module fetch: Chrome and
// Firefox keep the failure in the page's module map, so import('./Profiles')
// a second time rejects at once, without a request, however healthy the
// connection is by then. (Measured: the retry button did nothing.) A URL the
// browser has not failed on is a new entry, so a retry asks for the chunk as
// `/assets/Profiles-<hash>.js?retry=1`; its own imports are relative to the
// file, not the query, so they resolve to the modules already loaded.
const failures = new Map()
const lastError = new Map()

// The chunk's address, read out of the browser's error ("Failed to fetch
// dynamically imported module: https://.../assets/Profiles-x.js"). Safari's
// message carries no address, and then the plain import is the best there is.
function chunkUrl(error) {
  const m = /https?:\/\/[^\s"'()?#]+\.m?js/.exec(String(error?.message ?? ''))
  // Same origin only: a retry may re-ask for the app's own file, never for
  // whatever address a message happens to contain.
  return m && new URL(m[0]).origin === window.location.origin ? m[0] : null
}

function importScreen(id) {
  const n = failures.get(id) ?? 0
  const url = n > 0 ? chunkUrl(lastError.get(id)) : null
  // The address is never typed here: it comes from the failure of an import
  // this file wrote.
  if (!url) return LOADERS[id]()
  // If the address was a dependency's and not the screen's own, what comes back
  // is some other module: no default export, so no screen. Then the ordinary
  // import is the only honest answer.
  return import(/* @vite-ignore */ `${url}?retry=${n}`).then((m) => (m && m.default ? m : LOADERS[id]()))
}

export function loadScreen(id) {
  let p = loading.get(id)
  if (!p) {
    p = importScreen(id).catch((e) => {
      // A failed import is forgotten, so the next try is a real request and not
      // the same rejected promise.
      if (loading.get(id) === p) loading.delete(id)
      failures.set(id, (failures.get(id) ?? 0) + 1)
      lastError.set(id, e)
      throw e
    })
    loading.set(id, p)
  }
  return p
}

// React.lazy remembers a rejection for ever — a lazy component whose chunk
// failed once throws that same error on every later render, so "try again"
// needs a NEW lazy component. `generation` is the part of the key that changes
// when a screen is retried; a screen that loaded fine keeps its component, so
// switching back to it renders at once without going through Suspense.
const generation = new Map()
const components = new Map()

export function screenFor(id) {
  const key = `${id}#${generation.get(id) ?? 0}`
  let C = components.get(key)
  if (!C) {
    C = lazy(() => loadScreen(id))
    components.set(key, C)
  }
  return C
}

// Called when a screen's load failed and the person is about to try it again.
export function retryScreen(id) {
  generation.set(id, (generation.get(id) ?? 0) + 1)
}

// Would fetching a screen before it is asked for cost this device something it
// did not offer? Same rule as the shop's lib/prefetchRoute.js (not imported: it
// is the storefront's file, and does not export the check).
function mayWarm() {
  const c = typeof navigator === 'undefined' ? undefined : navigator.connection
  if (!c) return true
  if (c.saveData) return false
  return !/(^|-)2g$/.test(c.effectiveType ?? '')
}

// Fetch a screen's chunk ahead of the click. Swallows failure: the click that
// follows loads it for real, and shows the retry if that fails too.
export function warmScreen(id) {
  if (!LOADERS[id] || !mayWarm()) return
  loadScreen(id).catch(() => {})
}

// Spread onto a tab button. Hover on a desktop, touch on a phone (about 100 ms
// ahead of the click) and keyboard focus are all the same intent.
export const warmProps = (id) => ({
  onPointerEnter: () => warmScreen(id),
  onFocus: () => warmScreen(id),
  onTouchStart: () => warmScreen(id),
})
