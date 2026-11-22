// The text a screen reader (and a crawler) gets for a product photograph.
//
// The photograph is the product, so its alt says what it is: the product's own
// name, then the maker when the admin has tagged one. Colour is not a field the
// shop stores, so it is not guessed here — it is already part of most names
// ("Cloudsoft Jacket Army Green").
//
// Built from the public product record only: name and brand, in the language
// of the page. Nothing is invented, so a product with no brand gets the name
// alone, and an empty name gets an empty alt (a decorative picture), never a
// placeholder word.
export function productAlt(product, lang = 'en') {
  if (!product) return ''
  const pick = (v) => (v && typeof v === 'object' ? (v[lang] || v.en || v.ar || '') : '')
  const name = String(pick(product.name) || '').replace(/\s+/g, ' ').trim()
  if (!name) return ''
  const brand = String((product.brand && pick(product.brand.name)) || '').replace(/\s+/g, ' ').trim()
  // Do not repeat the brand when the name already starts with it.
  if (!brand || name.toLowerCase().startsWith(brand.toLowerCase())) return name
  return `${name} — ${brand}`
}

export default productAlt
