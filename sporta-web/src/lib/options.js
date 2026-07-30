import { AHED_PRODUCTS, ahedDetail } from './ahed'
import { PRODUCTS } from './products'

// The choices a shopper makes on a product page: size, colour and fit.
//
// Each is bilingual, each has a stable machine value that goes into the cart
// and the order, and each is defined ONCE here rather than in the page — the
// page is where they are drawn, not where they are decided.

// ---------------------------------------------------------------- SIZE
// S through 5XL, in the order a rail is hung.
//
// The catalogue only ever offered S–XL, which is what SIZES_FOR returns, so a
// 3XL customer had no way to say so and no way to tell whether the shop simply
// does not carry it. The full ladder is now always drawn: the sizes actually
// carried are pickable, the rest are struck through — "this size exists and we
// do not have it" is the truth, and hiding them says "we never made it".
//
// Machine values are the labels: they are already ASCII, already unambiguous,
// and already what is printed on the garment. '2XL' rather than 'XXL' because
// that is what the packing slips use past XL.
export const SIZE_LADDER = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL']

// What the packing slip calls a size, normalised onto the ladder. XXL and 2XL
// are the same shelf, and a product whose data says one must not draw a chip
// the ladder cannot match.
const SIZE_ALIASES = {
  XXL: '2XL',
  XXXL: '3XL',
  XXXXL: '4XL',
  XXXXXL: '5XL',
}
export const normalizeSize = (s) => {
  const up = String(s ?? '').trim().toUpperCase()
  return SIZE_ALIASES[up] ?? up
}

// ---------------------------------------------------------------- FIT
// How the garment sits. This is a real choice on a sportswear page — the same
// tee is bought oversized for training and slim for wearing out — and it is
// the question customers ask before they ask anything else.
export const FITS = [
  { id: 'normal',   en: 'Normal',    ar: 'عادي' },
  { id: 'slim',     en: 'Slim fit',  ar: 'ضيق' },
  { id: 'loose',    en: 'Loose fit', ar: 'واسع' },
  { id: 'oversize', en: 'Oversize',  ar: 'أوفرسايز' },
  { id: 'boxy',     en: 'Boxy',      ar: 'بوكسي' },
  { id: 'tank',     en: 'Tank',      ar: 'حمالات' },
]
export const fitLabel = (id, lang) => FITS.find((f) => f.id === id)?.[lang] ?? id

// Which fits a garment can actually be had in, and which one it is by default.
//
// Not every fit belongs on every garment, and offering all six everywhere is
// how a shop takes an order for a "tank legging". The default is the cut the
// garment is designed as, so a shopper who never touches the box still gets a
// coherent order.
const FIT_BY_GARMENT = {
  jacket:     { fits: ['normal', 'slim', 'loose', 'oversize', 'boxy'], default: 'normal' },
  leggings:   { fits: ['slim', 'normal'],                              default: 'slim' },
  top:        { fits: ['slim', 'normal', 'loose', 'oversize', 'boxy', 'tank'], default: 'slim' },
  sweatshirt: { fits: ['normal', 'loose', 'oversize', 'boxy'],          default: 'normal' },
  't-shirt':  { fits: ['normal', 'slim', 'loose', 'oversize', 'boxy', 'tank'], default: 'normal' },
}
// Anything not in the map, and anything not apparel, gets the general set.
const FIT_DEFAULT = { fits: ['normal', 'slim', 'loose', 'oversize', 'boxy'], default: 'normal' }

// Accessories have no cut. A backpack does not come in oversize.
const NO_FIT = new Set(['accessories'])

export function fitsFor(product) {
  if (!product || NO_FIT.has(product.category)) return null
  const garment = AHED_PRODUCTS[product.slug]?.garment
  const spec = FIT_BY_GARMENT[garment] ?? guessFromName(product) ?? FIT_DEFAULT
  return { options: FITS.filter((f) => spec.fits.includes(f.id)), default: spec.default }
}

// Products outside the AHED range have no garment field, so the name is the
// only thing that says what they are. Deliberately conservative: it matches the
// words that change the answer and gives up otherwise.
function guessFromName(product) {
  const n = (product.name?.en ?? '').toLowerCase()
  if (/legging|tight/.test(n)) return FIT_BY_GARMENT.leggings
  if (/t-?shirt|tee\b/.test(n)) return FIT_BY_GARMENT['t-shirt']
  if (/sweatshirt|hoodie/.test(n)) return FIT_BY_GARMENT.sweatshirt
  if (/jacket/.test(n)) return FIT_BY_GARMENT.jacket
  if (/\btop\b|bra\b/.test(n)) return FIT_BY_GARMENT.top
  return null
}

// ---------------------------------------------------------------- COLOUR
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

// "L · Oversize" — the chosen options as one line, for the bag, the drawer and
// the order summary. Absent options simply do not appear, so a product with no
// size and no fit renders nothing rather than a row of separators.
export function optionLine(item, lang) {
  return [item?.size, item?.fit ? fitLabel(item.fit, lang) : null].filter(Boolean).join(' · ')
}
