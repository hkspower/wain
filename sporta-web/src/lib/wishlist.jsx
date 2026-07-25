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
