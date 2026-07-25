import { createContext, useContext, useEffect, useMemo, useState } from 'react'

// localStorage-backed bag. Items are keyed by slug + size so the same product
// in two sizes are separate lines (required for apparel).
const CartContext = createContext(null)
const KEY = 'sporta_cart'

const lineKey = (slug, size) => `${slug}__${size ?? '-'}`

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '[]')
      // migrate older carts that have no key/size
      return saved.map((i) => ({ size: null, key: i.key ?? lineKey(i.slug, i.size), ...i }))
    } catch {
      return []
    }
  })

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items))
  }, [items])

  const add = (product, qty = 1, size = null) =>
    setItems((prev) => {
      const key = lineKey(product.slug, size)
      const found = prev.find((i) => i.key === key)
      if (found) return prev.map((i) => (i.key === key ? { ...i, qty: i.qty + qty } : i))
      return [
        ...prev,
        { key, slug: product.slug, size, name: product.name, price: product.price, image: product.image, qty },
      ]
    })

  const setQty = (key, qty) =>
    setItems((prev) => prev.flatMap((i) => (i.key === key ? (qty <= 0 ? [] : [{ ...i, qty }]) : [i])))

  const remove = (key) => setItems((prev) => prev.filter((i) => i.key !== key))
  const clear = () => setItems([])

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
