import { createContext, useContext, useEffect, useMemo, useState } from 'react'

// Saved items, persisted locally. Small but important: a wishlist ♡ that does
// nothing erodes trust, and saved items bring shoppers back.
const WishlistContext = createContext(null)
const KEY = 'sporta_wishlist'

export function WishlistProvider({ children }) {
  const [slugs, setSlugs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]')
    } catch {
      return []
    }
  })

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(slugs))
  }, [slugs])

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
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== KEY) return
      try {
        const next = JSON.parse(e.newValue || '[]')
        if (Array.isArray(next)) {
          // Replace only when it differs, so this cannot loop: setSlugs with an
          // equal-but-new array would rerun the writer effect above, which
          // would fire storage in the other tab, which would come back here.
          setSlugs((prev) =>
            prev.length === next.length && prev.every((s, i) => s === next[i]) ? prev : next,
          )
        }
      } catch {
        /* another tab wrote something unparseable; keep what we have */
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = (slug) =>
    setSlugs((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]))
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
