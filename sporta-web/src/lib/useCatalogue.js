import { useEffect, useState } from 'react'
import { PRODUCTS, loadProducts } from './products'

// THE CATALOGUE THE STOREFRONT SHOWS: the live one, with the bundled list
// standing in until it arrives.
//
// WHY THIS EXISTS. Every page that lists products used to reach straight into
// PRODUCTS — the list baked into the JavaScript at build time — and the
// consequence was a trap rather than a limitation: a product added in
// /backends was saved, returned by the API, and then shown NOWHERE. It drew a
// broken card on the home page (the only page reading the live list) and its
// own URL answered "product not found". The admin's Add Product form appeared
// to work and produced nothing a customer could reach.
//
// STARTING FROM THE BUNDLE IS NOT A FALLBACK, IT IS THE FIRST PAINT. The grid
// draws immediately from bytes already in the page and is replaced when the
// request lands. Waiting on the database to draw anything would undo the work
// the whole site is built around — FCP is ~430ms on a throttled phone
// precisely because nothing above the fold waits on a network. It is also what
// keeps the shop looking like a shop when /api is briefly unreachable.
//
// It lives in its own module rather than in products.js because that file is
// deliberately free of imports — pure data and pure functions, importable by
// the Node test scripts. A React hook in it would make it a component module.
export function useCatalogue() {
  const [products, setProducts] = useState(PRODUCTS)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    loadProducts()
      .then((all) => { if (alive && all?.length) setProducts(all) })
      // loadProducts already falls back to PRODUCTS on failure; this catches a
      // rejection it did not expect. It must still mark the wait over, or a
      // product page would sit on "loading" for ever.
      .catch(() => {})
      .finally(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [])

  return { products, ready }
}
