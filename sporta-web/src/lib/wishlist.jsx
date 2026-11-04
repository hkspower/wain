import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'

// Saved items, persisted locally. Small but important: a wishlist ♡ that does
// nothing erodes trust, and saved items bring shoppers back.
const WishlistContext = createContext(null)
const KEY = 'sporta_wishlist'

// What is stored right now, or null when nothing readable is (storage blocked, unreadable JSON, not a list).
function readStored() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

const sameList = (a, b) => a.length === b.length && a.every((s, i) => s === b[i])

export function WishlistProvider({ children }) {
  const [slugs, setSlugs] = useState(() => readStored() ?? [])
  // The newest list this tab knows of; used only when storage cannot be read.
  const latest = useRef(slugs)

  // Keep every tab and window in step.
  //
  // Without this, two tabs open on the shop was silent data loss: each held its
  // own copy of the list in React state and wrote the whole array on every
  // change, so a heart added in one tab was erased the next time the other tab
  // wrote. The `storage` event fires only in the OTHER tabs, which is exactly
  // the ones that need telling.
  //
  // This is as far as syncing goes, and the limit is worth stating: the list
  // lives in the browser, so it follows the DEVICE, not the person. Carrying it
  // to a phone would need a customer account, and this shop deliberately has
  // none — checkout is guest-only and no email is collected. A wishlist that
  // demanded a sign-up to survive would cost more shoppers than it kept.
  //
  // RACE K3-W (wishlist, second look): the `storage` event is not delivered to a page the browser froze (a background
  // tab, the back/forward cache), and the list used to be written back from this tab's React state after every change.
  // A tab that missed another tab's heart therefore erased it with its own next one. Now a toggle starts from the list
  // that is STORED at that moment and writes the result back in the same breath (as the bag does, see cart.jsx), and a
  // tab that comes back to the foreground or out of the cache reads the list again.
  useEffect(() => {
    const adopt = (list) => {
      latest.current = list
      // Replace only when it differs, so this cannot loop.
      setSlugs((prev) => (sameList(prev, list) ? prev : list))
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

  const toggle = (slug) => {
    const base = readStored() ?? latest.current
    const next = base.includes(slug) ? base.filter((s) => s !== slug) : [...base, slug]
    latest.current = next
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* private mode or a full quota: the list keeps working in memory for this tab */
    }
    setSlugs(next)
  }
  const has = (slug) => slugs.includes(slug)
  const count = useMemo(() => slugs.length, [slugs])

  return (
    <WishlistContext.Provider value={{ slugs, toggle, has, count }}>{children}</WishlistContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWishlist() {
  const ctx = useContext(WishlistContext)
  if (!ctx) throw new Error('useWishlist must be used within WishlistProvider')
  return ctx
}
