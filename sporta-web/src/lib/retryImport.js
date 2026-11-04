// Loading a code-split chunk that may fail, and recovering when it does.
//
// WHY THIS EXISTS
// `React.lazy(() => import('./X'))` has two failure modes that look the same to
// a shopper: the network dropped for a second, or the page was opened before a
// deploy and the hashed file it asks for no longer exists. In both, the promise
// rejects, React.lazy remembers the rejection FOREVER, and with no error
// boundary the whole tree unmounts to an empty page. There is nothing to tap.
//
// And "just import() it again" does not work. MEASURED in Chromium 153: after a
// dynamic import fails, a second import() of the SAME specifier fails again
// without sending a request (the browser keeps the failed module record, as the
// HTML spec says it should). So a retry has to ask for a different URL.
//
// WHAT THIS GIVES
//   loadChunk(loader)    the module, loaded once. A success is remembered (so a
//                        prefetch and the component that needs it share one
//                        request); a FAILURE is not, so the next call tries again.
//   peekChunk(loader)    the module if it is already here, else undefined. Lets a
//                        component render a warm chunk on its first pass with no
//                        loading state at all.
//   retryChunk(loader)   a fresh attempt after a failure: the same chunk under a
//                        cache-busting query when the failure named its URL
//                        (Chromium and Firefox put it in the message), then a
//                        plain import for a browser that does not keep failures.
//                        The chunk's own static imports resolve to the same
//                        URLs as before, so nothing is loaded twice but the
//                        chunk itself. Rejects when the network is still down.
//
// The loader is the identity: pass the SAME function from every call site (see
// components/checkout/chunks.js) or the cache cannot tell they are one chunk.
//
// Nothing here knows about React or about checkout; components/checkout/LazyView
// is the UI that sits on top.

const ready = new Map() // loader -> module
const pending = new Map() // loader -> in-flight promise
const lastError = new Map() // loader -> the error of the most recent failure

export const peekChunk = (loader) => ready.get(loader)

function remember(loader, mod) {
  ready.set(loader, mod)
  pending.delete(loader)
  lastError.delete(loader)
  return mod
}

function forget(loader, error) {
  pending.delete(loader)
  lastError.set(loader, error)
  throw error
}

export function loadChunk(loader) {
  if (ready.has(loader)) return Promise.resolve(ready.get(loader))
  if (pending.has(loader)) return pending.get(loader)
  let p
  try {
    p = Promise.resolve(loader())
  } catch (e) {
    p = Promise.reject(e)
  }
  p = p.then((mod) => remember(loader, mod), (e) => forget(loader, e))
  pending.set(loader, p)
  return p
}

// The chunk's URL out of the error a failed import() raised. Chromium:
// "Failed to fetch dynamically imported module: https://…/X-abc.js"; Firefox:
// "error loading dynamically imported module: https://…/X-abc.js". Safari says
// only "Importing a module script failed." and gives no URL — null, and the
// caller falls back to a plain retry.
export function chunkUrlFrom(error) {
  const m = /(https?:\/\/[^\s'"]+?\.m?js)(?:\?[^\s'"]*)?(?=$|[\s'")])/.exec(String(error?.message ?? ''))
  return m ? m[1] : null
}

let bust = 0

export async function retryChunk(loader) {
  if (ready.has(loader)) return ready.get(loader)
  const url = chunkUrlFrom(lastError.get(loader))
  if (url) {
    try {
      // A different URL is a different module to the browser, so it is really
      // fetched. @vite-ignore: this is deliberately not analysable by the bundler.
      const mod = await import(/* @vite-ignore */ `${url}?retry=${Date.now().toString(36)}${++bust}`)
      return remember(loader, mod)
    } catch (e) {
      lastError.set(loader, e)
    }
  }
  return loadChunk(loader)
}
