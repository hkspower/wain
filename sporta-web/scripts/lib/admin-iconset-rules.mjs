// The /backends icon map: which Sporta glyph (brand/iconset/*.svg) replaces which icon of the compiled admin. Pure data, no imports,
// so the generator (build-admin-iconset.mjs), the preview (build-iconset.mjs) and the suite (admin-iconset-test.mjs) share ONE list.
//
// The live admin is a compiled build with its own inline <svg> icons (class "sporta-icon", viewBox 24, one or more shapes). Each is
// recognised by the exact shape data of that build (it is fixed; these strings are its own), the same technique as the storefront's
// ICON SET. The build draws FOUR different screens' nav items with the same heart, two with a star, two with a box, two with a lock,
// two with a globe, two with an image and two with a plus, because it has no glyph for them: those are told apart by a stable
// neighbour (the Returns item, the Topbar item, the Inventory item, first / last place in the nav), never by their text (CSS cannot
// read it, and the admin's strings are not ours to depend on). When the anchor is missing, the base glyph of the shape stays.
const SH = '.admin-shell'
const NAV = `${SH} .admin-sidebar__nav > button`
const TAB = `${SH} .m-tabbar__item`

// the shapes of the build's icons
export const SHAPE = {
  star: 'path[d^="m12 2 3.09 6.26"]',
  bag: 'path[d="M5 7H19L20 21H4Z"]',
  cartx: 'path[d^="M3 4h2l2.4 11"]',
  returns: 'path[d^="M8 3 4 7 8 11"]',
  heart: 'path[d="M12 20.5 4 12.5a5 5 0 0 1 8-6.5 5 5 0 0 1 8 6.5Z"]',
  truck: 'path[d^="M2 18V5H14V18"]',
  image: 'path[d="M21 15l-5-5L5 21"]',
  globe: 'ellipse[rx="4"][ry="9.5"]',
  plus: 'path[d="M12 5V19M5 12H19"]',
  box: 'path[d^="M21 8v8a2 2 0 0 1-1.11 1.79"]',
  lock: 'path[d="M8 10V7a4 4 0 0 1 8 0V10M12 15V17"]',
  search: 'path[d="M15.25 15.25 20.5 20.5"]',
  search2: 'path[d^="m21 21-4.35-4.35"]',
  close: 'path[d="M6 6 18 18M18 6 6 18"]',
}
const svg = (k) => `svg:has(> ${SHAPE[k]})`

// base rules: one per shape the build draws (every icon in the inventory is covered by one of these)
export const BASE = [
  { g: 'star', where: 'nav: Brands (and Overview before its own rule)', sel: [`${SH} ${svg('star')}`] },
  { g: 'bag', where: 'nav: Orders, Checkout; tab bar: Orders', sel: [`${SH} ${svg('bag')}`] },
  { g: 'cart-x', where: 'nav: Abandoned orders', sel: [`${SH} ${svg('cartx')}`] },
  { g: 'returns', where: 'nav: Returns (mirrored in RTL here)', sel: [`${SH} ${svg('returns')}`] },
  { g: 'heart', where: 'fallback for the four nav items drawn with the build\'s heart', sel: [`${SH} ${svg('heart')}`] },
  { g: 'truck', where: 'fallback for the build\'s truck', sel: [`${SH} ${svg('truck')}`] },
  { g: 'image', where: 'nav: Slides, Theme; "Choose logo" button', sel: [`${SH} ${svg('image')}`] },
  { g: 'globe', where: 'nav: Topbar, SEO', sel: [`${SH} ${svg('globe')}`] },
  { g: 'plus', where: 'fallback for the build\'s plus', sel: [`${SH} ${svg('plus')}`] },
  { g: 'box', where: 'nav: Inventory; tab bar: Stock', sel: [`${SH} ${svg('box')}`] },
  { g: 'lock', where: 'fallback for the build\'s lock', sel: [`${SH} ${svg('lock')}`] },
  { g: 'search', where: 'search boxes of Orders, Returns, CRM, Support, Profiles', sel: [`${SH} ${svg('search')}`] },
  { g: 'search', where: 'Stock search box', sel: [`${SH} ${svg('search2')}`] },
  { g: 'close', where: 'editor and drawer Close buttons', sel: [`${SH} ${svg('close')}`] },
]

// refinements: a more specific selector later in the file, so it wins over the base glyph of the same shape
const RET = `button:has(${SHAPE.returns})`
const TOP = `button:has(${SHAPE.globe})`
const INV = `button:has(${SHAPE.box}):not(:nth-last-child(2))`
export const REFINE = [
  { g: 'chart', where: 'nav: Overview (first item); tab bar: Home (first item)', sel: [`${NAV}:first-child ${svg('star')}`, `${SH} .m-tabbar > :first-child ${svg('star')}`] },
  { g: 'users', where: 'nav: CRM (the heart right after Returns)', sel: [`${NAV}:has(${SHAPE.returns}) + button ${svg('heart')}`] },
  { g: 'chat', where: 'nav: Support (second after Returns)', sel: [`${SH} .admin-sidebar__nav > ${RET} + button + button ${svg('heart')}`] },
  { g: 'user', where: 'nav: Profiles (third after Returns)', sel: [`${SH} .admin-sidebar__nav > ${RET} + button + button + button ${svg('heart')}`] },
  { g: 'shirt', where: 'nav: Catalogue', sel: [`${NAV} ${svg('truck')}`] },
  { g: 'percent', where: 'nav: Promotions (the heart right after Topbar)', sel: [`${SH} .admin-sidebar__nav > ${TOP} + button ${svg('heart')}`] },
  { g: 'tag', where: 'nav: Discounts', sel: [`${NAV} ${svg('plus')}`] },
  { g: 'menu', where: 'tab bar: More', sel: [`${TAB} ${svg('plus')}`] },
  { g: 'card', where: 'nav: Payments (the lock right after Inventory); tab bar: Payment', sel: [`${SH} .admin-sidebar__nav > ${INV} + button ${svg('lock')}`, `${TAB} ${svg('lock')}`] },
  { g: 'list', where: 'nav: Activity (second from last)', sel: [`${NAV}:nth-last-child(2) ${svg('box')}`] },
  { g: 'sliders', where: 'nav: Settings (last item)', sel: [`${NAV}:last-child ${svg('lock')}`] },
]
// mirrored in RTL (the build never turns it): the returns U-turn points back in the reading direction
export const MIRROR = [`${SH}[dir="rtl"] ${svg('returns')}`, `[dir="rtl"] ${SH} ${svg('returns')}`]

// what the suite expects, per control: [fixture state, where to look, label of the control, glyph]. Labels are the captured English
// ones (the fixtures hold the compiled admin's own strings; Arabic changes direction, not words).
export const EXPECT_NAV = {
  Overview: 'chart', Orders: 'bag', 'Abandoned orders': 'cart-x', Returns: 'returns', CRM: 'users', Support: 'chat', Profiles: 'user',
  Catalogue: 'shirt', Brands: 'star', Slides: 'image', Topbar: 'globe', Promotions: 'percent', Discounts: 'tag', Inventory: 'box',
  Payments: 'card', Checkout: 'bag', Theme: 'image', SEO: 'globe', Activity: 'list', Settings: 'sliders',
}
export const EXPECT_TAB = { Home: 'chart', Orders: 'bag', Stock: 'box', Payment: 'card', More: 'menu' }
// the glyphs every rule above names
export const GLYPHS = [...new Set([...BASE, ...REFINE].map((r) => r.g))].sort()
