// Product picture rules, shared by every component that draws a product's
// photograph: the grid card, the product page, the bag, the checkout summary
// and the search results. Two decisions live here so they cannot drift apart
// from one component to the next.
//
// 1. HOW A PHOTOGRAPH FITS ITS BOX.
//    A real photograph is drawn with object-contain. The whole garment stays in
//    frame, and any space the box has left over is letterboxed in the warm
//    beige token (bg-sand-light) — the same token the page canvas uses, so the
//    gap reads as part of the shop rather than as a broken picture. object-cover
//    would crop the top and bottom of a portrait shot to fit a square frame,
//    which is how a model's head ends up outside the picture.
//
//    Generated artwork is the exception. A data: URI here is the bundled
//    gradient placeholder (products.js) or the empty-bag line art below: it has
//    no subject to protect and it is drawn to the exact size of its box, so it
//    uses object-cover and fills the box with no letterbox.
//
// 2. THE EMPTY-LINE ARTWORK.
//    A cart line keeps whatever the product had WHEN IT WAS ADDED, and the cart
//    lives in localStorage — so a bag saved before a product had artwork still
//    holds an empty image. The browser draws that as a broken-image glyph next
//    to the price, which reads as a shop that has lost the item. This is the
//    neutral stand-in for that case. It is defined once here: the bag drawer and
//    the cart page used to carry two copies, and the drawer's copy had its
//    colour percent-encoded twice, so the SVG asked for the colour "%23E2DBCE"
//    and drew it in the default black.
export const LINE_ART =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">' +
    '<rect width="80" height="80" fill="#E2DBCE"/></svg>',
  )

// The Tailwind class that fits a product picture into its box. Takes the image
// URL as the component has it, so the rule is decided by what the picture IS.
export function photoFit(src) {
  return typeof src === 'string' && src.startsWith('data:')
    ? 'object-cover'
    : 'object-contain'
}
