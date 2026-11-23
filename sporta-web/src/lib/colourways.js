import { AHED_PRODUCTS, ahedDetail } from './ahed'
import { PRODUCTS } from './products'

// Colourways are loaded only where they are drawn (the product page), so the
// AHED product table stays out of the storefront's first-load chunk.

// The other colourways of the SAME garment in the SAME collection.
//
// This is not a per-line option the way size and fit are: a colour is a
// different product with its own slug, price, stock and photographs. So the
// swatches are LINKS, and picking one navigates — which is also what makes the
// stock on the page honest, because it is that product's own stock.
export function colourwaysOf(slug) {
  const mine = AHED_PRODUCTS[slug]
  if (!mine) return []
  const family = PRODUCTS.filter((p) => {
    const o = AHED_PRODUCTS[p.slug]
    return o && o.collection === mine.collection && o.garment === mine.garment
  })
  if (family.length < 2) return []
  return family
    .map((p) => {
      const colour = ahedDetail(p.slug)?.colour
      return colour
        ? { slug: p.slug, name: colour, hex: colour.hex, current: p.slug === slug }
        : null
    })
    .filter(Boolean)
    .sort((a, b) => a.slug.localeCompare(b.slug))
}

