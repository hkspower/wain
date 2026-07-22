import { createContext, useContext, useEffect, useMemo, useState } from 'react'

// localStorage-backed shopping cart. Items: { slug, name{}, price, image, qty }.
const CartContext = createContext(null)
const KEY = 'sporta_cart'

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]')
    } catch {
      return []
    }
  })

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items))
  }, [items])

  const add = (product, qty = 1) =>
    setItems((prev) => {
      const found = prev.find((i) => i.slug === product.slug)
      if (found) {
        return prev.map((i) => (i.slug === product.slug ? { ...i, qty: i.qty + qty } : i))
      }
      return [...prev, { slug: product.slug, name: product.name, price: product.price, image: product.image, qty }]
    })

  const setQty = (slug, qty) =>
    setItems((prev) =>
      prev.flatMap((i) => (i.slug === slug ? (qty <= 0 ? [] : [{ ...i, qty }]) : [i])),
    )

  const remove = (slug) => setItems((prev) => prev.filter((i) => i.slug !== slug))
  const clear = () => setItems([])

  const count = useMemo(() => items.reduce((n, i) => n + i.qty, 0), [items])
  const total = useMemo(() => items.reduce((s, i) => s + i.price * i.qty, 0), [items])

  const value = { items, add, setQty, remove, clear, count, total }
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
