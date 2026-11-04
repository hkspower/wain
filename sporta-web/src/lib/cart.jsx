import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'

// localStorage-backed bag. Items are keyed by slug + size + fit so the same
// product in two sizes, or in two cuts, are separate lines (required for
// apparel — an L oversize tee and an L slim tee are different garments to pick,
// pack and return).
const CartContext = createContext(null)
const KEY = 'sporta_cart'

const lineKey = (slug, size, fit) => `${slug}__${size ?? '-'}__${fit ?? '-'}`

// Tells public/birthday.js that THIS app keeps the bag in step between tabs itself, so the page-level guard there
// (which does the same for the compiled storefront, whose source is not in this repo) stands down instead of merging
// a second time. Set at import time, i.e. before the first bag write.
if (typeof window !== 'undefined') window.__sportaCartOwn = true

// A stored bag, with older shapes migrated. Older carts have no fit and, older still, no key or size. They keep
// whatever key they were saved with — recomputing it would split a line the shopper is already looking at into two.
function parseBag(raw) {
  const saved = JSON.parse(raw || '[]')
  if (!Array.isArray(saved)) return []
  return saved.map((i) => ({
    size: null,
    fit: null,
    key: i.key ?? lineKey(i.slug, i.size, i.fit),
    ...i,
  }))
}

// What is stored right now, or null when nothing readable is (key absent, unreadable JSON, storage blocked).
function readStored() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === null ? null : parseBag(raw)
  } catch {
    return null
  }
}

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b)

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => readStored() ?? [])
  // The newest bag this tab knows of. Actions start from the STORED bag (see apply), and fall back to this when
  // storage cannot be read, so two actions in one event handler still see each other.
  const latest = useRef(items)

  // THE BAG IS SHARED BY EVERY TAB OF THE SHOP, SO NO TAB MAY OVERWRITE IT FROM A STALE COPY.
  //
  // This used to keep the bag only in React state and write the WHOLE array to localStorage after every change, and
  // nothing ever read it back. Two tabs open on the shop was therefore silent data loss: add a jacket in tab A, add
  // leggings in tab B (which still held the bag as it was when it loaded), and B wrote [leggings] over A's [jacket].
  // The same for a removal: B put the removed line back. (The wishlist had the same hole and was closed first, see
  // wishlist.jsx.) Now every action is applied to the bag that is stored at that moment, and the result is written
  // back in the same breath, so a change made in any tab is the starting point of the next one made in any other.
  // The read and the write are two statements and localStorage has no compare-and-swap, so two tabs acting in the
  // same microsecond could still collide; that window is not reachable by a person.
  const apply = (change) => {
    const next = change(readStored() ?? latest.current)
    latest.current = next
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* private mode or a full quota: the bag keeps working in memory for this tab */
    }
    setItems(next)
  }

  // Follow the other tabs. `storage` fires only in the tabs that did NOT write, which is exactly the ones to tell.
  // It is not delivered to a page the browser froze (a background tab, or the back/forward cache), so coming back to
  // the foreground, or being restored from the cache, reads the stored bag again as well.
  useEffect(() => {
    const adopt = (bag) => {
      latest.current = bag
      setItems((prev) => (same(prev, bag) ? prev : bag))
    }
    const onStorage = (e) => {
      if (e.key !== KEY && e.key !== null) return // e.key === null: storage.clear()
      adopt(readStored() ?? [])
    }
    const resync = () => {
      const stored = readStored()
      if (stored) adopt(stored)
    }
    const onVisible = () => { if (document.visibilityState === 'visible') resync() }
    const onShow = (e) => { if (e.persisted) resync() }
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onShow)
    return () => {
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onShow)
    }
  }, [])

  const add = (product, qty = 1, size = null, fit = null) =>
    apply((prev) => {
      const key = lineKey(product.slug, size, fit)
      const found = prev.find((i) => i.key === key)
      if (found) return prev.map((i) => (i.key === key ? { ...i, qty: i.qty + qty } : i))
      return [
        ...prev,
        {
          key,
          slug: product.slug,
          size,
          fit,
          name: product.name,
          price: product.price,
          image: product.image,
          qty,
        },
      ]
    })

  const setQty = (key, qty) =>
    apply((prev) => prev.flatMap((i) => (i.key === key ? (qty <= 0 ? [] : [{ ...i, qty }]) : [i])))

  const remove = (key) => apply((prev) => prev.filter((i) => i.key !== key))
  const clear = () => apply(() => [])

  const count = useMemo(() => items.reduce((n, i) => n + i.qty, 0), [items])
  const total = useMemo(() => items.reduce((s, i) => s + i.price * i.qty, 0), [items])

  return (
    <CartContext.Provider value={{ items, add, setQty, remove, clear, count, total }}>
      {children}
    </CartContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
