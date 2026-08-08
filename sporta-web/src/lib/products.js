// Product catalog. Bilingual (en/ar). Replace with your real Sporta products,
// or load from the API (see loadProducts). Prices are in KWD.
//
// Each product: slug, name{en,ar}, desc{en,ar}, price, category, image, badge?
export const CATEGORIES = [
  { id: 'all', name: { en: 'All', ar: 'الكل' } },
  { id: 'women', name: { en: 'Women', ar: 'نساء' } },
  { id: 'men', name: { en: 'Men', ar: 'رجال' } },
  { id: 'outerwear', name: { en: 'Hoodies & Jackets', ar: 'هوديز وجواكيت' } },
  { id: 'accessories', name: { en: 'Accessories', ar: 'إكسسوارات' } },
]

// Inline SVG placeholder so the app runs with zero external images.
//
// The label argument is accepted and IGNORED, on purpose. It used to be painted
// into the SVG, which meant every product page and every card showed the English
// product name burnt into the picture — including on the Arabic side, where the
// name directly underneath was in Arabic and the one in the image was not. It
// also duplicated a name the page already states in a real heading, and it made
// each data URI carry text no screen reader could ever reach.
//
// The argument stays in the signature because ~40 catalogue rows and
// scripts/generate-seed.mjs pass it, and because it still reads as documentation
// of which product a row is for.
const ph = (_label, c1, c2) =>
  `data:image/svg+xml;utf8,` +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/></svg>`,
  )

// Every image for a product, best first.
//
// The catalogue and the products table both carry a single `image`. The admin
// uploader can now put a whole shoot in Storage, so this also accepts `images` —
// a Postgres text[] comes back as an array, and a hand-edited row is allowed to
// be a comma-separated string. Absent, it is exactly the single image it always
// was, so nothing changes for a shop that has not filled it in.
export function productImages(p) {
  if (!p) return []
  const extra = Array.isArray(p.images)
    ? p.images
    : typeof p.images === 'string'
      ? p.images.split(',')
      : []
  const all = [p.image, ...extra].map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
  return [...new Set(all)]
}

// Placeholder sportswear catalog matching the real Sporta range (activewear,
// gym clothing, outerwear, accessories). Replace with real products/prices via
// the admin or the products table.
export const PRODUCTS = [
  {
    slug: "cagliari-calcio-backpack",
    name: {"en": "Cagliari Calcio Backpack", "ar": "حقيبة ظهر كالياري كالتشو"},
    desc: {"en": "Cagliari Calcio Backpack.", "ar": "حقيبة ظهر كالياري كالتشو."},
    price: 4.0, category: "accessories", image: ph("Cagliari Calcio Ba", "#171A1E", "#333a42"),
    badge: {"en": "Bestseller", "ar": "الأكثر مبيعًا"},
  },
  {
    slug: "cagliari-calcio-backpack-navy",
    name: {"en": "Cagliari Calcio Backpack — Navy", "ar": "حقيبة ظهر كالياري كالتشو — كحلي"},
    desc: {"en": "Cagliari Calcio Backpack in navy.", "ar": "حقيبة ظهر كالياري كالتشو، كحلي."},
    price: 9.0, category: "accessories", image: ph("Cagliari Calcio Ba", "#171A1E", "#333a42"),
  },
  {
    slug: "cagliari-calcio-sweatshirt-navy",
    name: {"en": "Cagliari Calcio Sweatshirt — Navy", "ar": "سويت شيرت كالياري كالتشو — كحلي"},
    desc: {"en": "Cagliari Calcio Sweatshirt in navy.", "ar": "سويت شيرت كالياري كالتشو، كحلي."},
    price: 10.0, category: "outerwear", image: ph("Cagliari Calcio Sw", "#E0561C", "#B8430F"),
    badge: {"en": "Bestseller", "ar": "الأكثر مبيعًا"},
  },
  {
    slug: "cheetahs-rugby-t-shirt",
    name: {"en": "Cheetahs Rugby T-Shirt", "ar": "تيشيرت تشيتاز رَغبي"},
    desc: {"en": "Cheetahs Rugby T-Shirt.", "ar": "تيشيرت تشيتاز رَغبي."},
    price: 8.0, category: "men", image: ph("Cheetahs Rugby T-S", "#1e293b", "#0f172a"),
  },
  {
    slug: "cloudsoft-jacket-army-green",
    name: {"en": "Cloudsoft Jacket — Army Green", "ar": "جاكيت كلاودسوفت — أخضر عسكري"},
    desc: {"en": "Cloudsoft Jacket in army green.", "ar": "جاكيت كلاودسوفت، أخضر عسكري."},
    price: 10.0, category: "outerwear", image: ph("Cloudsoft Jacket", "#E0561C", "#B8430F"),
  },
  {
    slug: "cloudsoft-jacket-cherry-red",
    name: {"en": "Cloudsoft Jacket — Cherry Red", "ar": "جاكيت كلاودسوفت — أحمر كرزي"},
    desc: {"en": "Cloudsoft Jacket in cherry red.", "ar": "جاكيت كلاودسوفت، أحمر كرزي."},
    price: 8.0, category: "outerwear", image: ph("Cloudsoft Jacket", "#E0561C", "#B8430F"),
  },
  {
    slug: "cloudsoft-jacket-coffee-brown",
    name: {"en": "Cloudsoft Jacket — Coffee Brown", "ar": "جاكيت كلاودسوفت — بني قهوة"},
    desc: {"en": "Cloudsoft Jacket in coffee brown.", "ar": "جاكيت كلاودسوفت، بني قهوة."},
    price: 10.0, category: "outerwear", image: ph("Cloudsoft Jacket", "#E0561C", "#B8430F"),
  },
  {
    slug: "cloudsoft-leggings-army-green",
    name: {"en": "Cloudsoft Leggings — Army Green", "ar": "ليقنز كلاودسوفت — أخضر عسكري"},
    desc: {"en": "Cloudsoft Leggings in army green.", "ar": "ليقنز كلاودسوفت، أخضر عسكري."},
    price: 8.0, category: "women", image: ph("Cloudsoft Leggings", "#7c2d12", "#431407"),
  },
  {
    slug: "cloudsoft-leggings-cherry-red",
    name: {"en": "Cloudsoft Leggings — Cherry Red", "ar": "ليقنز كلاودسوفت — أحمر كرزي"},
    desc: {"en": "Cloudsoft Leggings in cherry red.", "ar": "ليقنز كلاودسوفت، أحمر كرزي."},
    price: 8.0, category: "women", image: ph("Cloudsoft Leggings", "#7c2d12", "#431407"),
  },
  {
    slug: "cloudsoft-leggings-coffee-brown",
    name: {"en": "Cloudsoft Leggings — Coffee Brown", "ar": "ليقنز كلاودسوفت — بني قهوة"},
    desc: {"en": "Cloudsoft Leggings in coffee brown.", "ar": "ليقنز كلاودسوفت، بني قهوة."},
    price: 8.0, category: "women", image: ph("Cloudsoft Leggings", "#7c2d12", "#431407"),
  },
  {
    slug: "cloudsoft-leggings-grey",
    name: {"en": "Cloudsoft Leggings — Grey", "ar": "ليقنز كلاودسوفت — رمادي"},
    desc: {"en": "Cloudsoft Leggings in grey.", "ar": "ليقنز كلاودسوفت، رمادي."},
    price: 4.5, category: "women", image: ph("Cloudsoft Leggings", "#7c2d12", "#431407"),
  },
  {
    slug: "cloudsoft-leggings-navy",
    name: {"en": "Cloudsoft Leggings — Navy", "ar": "ليقنز كلاودسوفت — كحلي"},
    desc: {"en": "Cloudsoft Leggings in navy.", "ar": "ليقنز كلاودسوفت، كحلي."},
    price: 8.0, category: "women", image: ph("Cloudsoft Leggings", "#7c2d12", "#431407"),
  },
  {
    slug: "cloudsoft-leggings-onyx-black",
    name: {"en": "Cloudsoft Leggings — Onyx Black", "ar": "ليقنز كلاودسوفت — أسود أونيكس"},
    desc: {"en": "Cloudsoft Leggings in onyx black.", "ar": "ليقنز كلاودسوفت، أسود أونيكس."},
    price: 8.0, category: "women", image: ph("Cloudsoft Leggings", "#7c2d12", "#431407"),
  },
  {
    slug: "cloudsoft-top-grey",
    name: {"en": "Cloudsoft Top — Grey", "ar": "توب كلاودسوفت — رمادي"},
    desc: {"en": "Cloudsoft Top in grey.", "ar": "توب كلاودسوفت، رمادي."},
    price: 6.0, category: "women", image: ph("Cloudsoft Top", "#7c2d12", "#431407"),
  },
  {
    slug: "cloudsoft-top-navy",
    name: {"en": "Cloudsoft Top — Navy", "ar": "توب كلاودسوفت — كحلي"},
    desc: {"en": "Cloudsoft Top in navy.", "ar": "توب كلاودسوفت، كحلي."},
    price: 6.0, category: "women", image: ph("Cloudsoft Top", "#7c2d12", "#431407"),
  },
  {
    slug: "cloudsoft-top-onyx-black",
    name: {"en": "Cloudsoft Top — Onyx Black", "ar": "توب كلاودسوفت — أسود أونيكس"},
    desc: {"en": "Cloudsoft Top in onyx black.", "ar": "توب كلاودسوفت، أسود أونيكس."},
    price: 7.0, category: "women", image: ph("Cloudsoft Top", "#7c2d12", "#431407"),
  },
  {
    slug: "define-jacket-iris-purple",
    name: {"en": "Define Jacket — Iris Purple", "ar": "جاكيت ديفاين — بنفسجي"},
    desc: {"en": "Define Jacket in iris purple.", "ar": "جاكيت ديفاين، بنفسجي."},
    price: 10.0, category: "outerwear", image: ph("Define Jacket", "#E0561C", "#B8430F"),
  },
  {
    slug: "define-jacket-onyx-black",
    name: {"en": "Define Jacket — Onyx Black", "ar": "جاكيت ديفاين — أسود أونيكس"},
    desc: {"en": "Define Jacket in onyx black.", "ar": "جاكيت ديفاين، أسود أونيكس."},
    price: 10.0, category: "outerwear", image: ph("Define Jacket", "#E0561C", "#B8430F"),
  },
  {
    slug: "define-jacket-steel-grey",
    name: {"en": "Define Jacket — Steel Grey", "ar": "جاكيت ديفاين — رمادي فولاذي"},
    desc: {"en": "Define Jacket in steel grey.", "ar": "جاكيت ديفاين، رمادي فولاذي."},
    price: 10.0, category: "outerwear", image: ph("Define Jacket", "#E0561C", "#B8430F"),
  },
  {
    slug: "denver-nuggets-cap-navy",
    name: {"en": "Denver Nuggets Cap — Navy", "ar": "كاب دنفر ناغتس — كحلي"},
    desc: {"en": "Denver Nuggets Cap in navy.", "ar": "كاب دنفر ناغتس، كحلي."},
    price: 12.3, category: "accessories", image: ph("Denver Nuggets Cap", "#171A1E", "#333a42"),
  },
  {
    slug: "energy-t-shirt-red-white",
    name: {"en": "Energy T-Shirt — Red/White", "ar": "تيشيرت إنرجي — أحمر وأبيض"},
    desc: {"en": "Energy T-Shirt in red/white.", "ar": "تيشيرت إنرجي، أحمر وأبيض."},
    price: 5.0, category: "men", image: ph("Energy T-Shirt", "#1e293b", "#0f172a"),
  },
  {
    slug: "flash-shorts-green",
    name: {"en": "Flash Shorts — Green", "ar": "شورت فلاش — أخضر"},
    desc: {"en": "Flash Shorts in green.", "ar": "شورت فلاش، أخضر."},
    price: 3.0, category: "men", image: ph("Flash Shorts", "#1e293b", "#0f172a"),
  },
  {
    slug: "flash-shorts-red",
    name: {"en": "Flash Shorts — Red", "ar": "شورت فلاش — أحمر"},
    desc: {"en": "Flash Shorts in red.", "ar": "شورت فلاش، أحمر."},
    price: 3.0, category: "men", image: ph("Flash Shorts", "#1e293b", "#0f172a"),
    badge: {"en": "Bestseller", "ar": "الأكثر مبيعًا"},
  },
  {
    slug: "gymshark-phone-strap",
    name: {"en": "Gymshark Phone Strap", "ar": "حزام هاتف جيمشارك"},
    desc: {"en": "Gymshark Phone Strap.", "ar": "حزام هاتف جيمشارك."},
    price: 6.5, category: "accessories", image: ph("Gymshark Phone Str", "#171A1E", "#333a42"),
  },
  {
    slug: "naples-leggings-black",
    name: {"en": "Naples Leggings — Black", "ar": "ليقنز نابولي — أسود"},
    desc: {"en": "Naples Leggings in black.", "ar": "ليقنز نابولي، أسود."},
    price: 7.0, category: "women", image: ph("Naples Leggings", "#7c2d12", "#431407"),
  },
  {
    slug: "naples-sports-bra-pink",
    name: {"en": "Naples Sports Bra — Pink", "ar": "برا رياضية نابولي — وردي"},
    desc: {"en": "Naples Sports Bra in pink.", "ar": "برا رياضية نابولي، وردي."},
    price: 5.0, category: "women", image: ph("Naples Sports Bra", "#7c2d12", "#431407"),
  },
  {
    slug: "sculpt-jacket-black",
    name: {"en": "Sculpt Jacket — Black", "ar": "جاكيت سكالبت — أسود"},
    desc: {"en": "Sculpt Jacket in black.", "ar": "جاكيت سكالبت، أسود."},
    price: 10.0, category: "outerwear", image: ph("Sculpt Jacket", "#E0561C", "#B8430F"),
  },
  {
    slug: "sculpt-jacket-grey",
    name: {"en": "Sculpt Jacket — Grey", "ar": "جاكيت سكالبت — رمادي"},
    desc: {"en": "Sculpt Jacket in grey.", "ar": "جاكيت سكالبت، رمادي."},
    price: 8.0, category: "outerwear", image: ph("Sculpt Jacket", "#E0561C", "#B8430F"),
  },
  {
    slug: "sculpt-jacket-navy",
    name: {"en": "Sculpt Jacket — Navy", "ar": "جاكيت سكالبت — كحلي"},
    desc: {"en": "Sculpt Jacket in navy.", "ar": "جاكيت سكالبت، كحلي."},
    price: 8.0, category: "outerwear", image: ph("Sculpt Jacket", "#E0561C", "#B8430F"),
  },
  {
    slug: "sculpt-jacket-taupe-brown",
    name: {"en": "Sculpt Jacket — Taupe Brown", "ar": "جاكيت سكالبت — بني فاتح"},
    desc: {"en": "Sculpt Jacket in taupe brown.", "ar": "جاكيت سكالبت، بني فاتح."},
    price: 6.0, category: "outerwear", image: ph("Sculpt Jacket", "#E0561C", "#B8430F"),
  },
  {
    slug: "sculpt-leggings-black",
    name: {"en": "Sculpt Leggings — Black", "ar": "ليقنز سكالبت — أسود"},
    desc: {"en": "Sculpt Leggings in black.", "ar": "ليقنز سكالبت، أسود."},
    price: 8.0, category: "women", image: ph("Sculpt Leggings", "#7c2d12", "#431407"),
  },
  {
    slug: "sculpt-leggings-grey",
    name: {"en": "Sculpt Leggings — Grey", "ar": "ليقنز سكالبت — رمادي"},
    desc: {"en": "Sculpt Leggings in grey.", "ar": "ليقنز سكالبت، رمادي."},
    price: 8.0, category: "women", image: ph("Sculpt Leggings", "#7c2d12", "#431407"),
  },
  {
    slug: "sculpt-leggings-navy",
    name: {"en": "Sculpt Leggings — Navy", "ar": "ليقنز سكالبت — كحلي"},
    desc: {"en": "Sculpt Leggings in navy.", "ar": "ليقنز سكالبت، كحلي."},
    price: 4.2, category: "women", image: ph("Sculpt Leggings", "#7c2d12", "#431407"),
  },
  {
    slug: "sculpt-leggings-taupe-brown",
    name: {"en": "Sculpt Leggings — Taupe Brown", "ar": "ليقنز سكالبت — بني فاتح"},
    desc: {"en": "Sculpt Leggings in taupe brown.", "ar": "ليقنز سكالبت، بني فاتح."},
    price: 8.0, category: "women", image: ph("Sculpt Leggings", "#7c2d12", "#431407"),
  },
  {
    slug: "sculpt-top-black",
    name: {"en": "Sculpt Top — Black", "ar": "توب سكالبت — أسود"},
    desc: {"en": "Sculpt Top in black.", "ar": "توب سكالبت، أسود."},
    price: 6.0, category: "women", image: ph("Sculpt Top", "#7c2d12", "#431407"),
  },
  {
    slug: "sculpt-top-grey",
    name: {"en": "Sculpt Top — Grey", "ar": "توب سكالبت — رمادي"},
    desc: {"en": "Sculpt Top in grey.", "ar": "توب سكالبت، رمادي."},
    price: 8.0, category: "women", image: ph("Sculpt Top", "#7c2d12", "#431407"),
  },
  {
    slug: "sculpt-top-navy",
    name: {"en": "Sculpt Top — Navy", "ar": "توب سكالبت — كحلي"},
    desc: {"en": "Sculpt Top in navy.", "ar": "توب سكالبت، كحلي."},
    price: 8.0, category: "women", image: ph("Sculpt Top", "#7c2d12", "#431407"),
  },
  {
    slug: "sculpt-top-taupe-brown",
    name: {"en": "Sculpt Top — Taupe Brown", "ar": "توب سكالبت — بني فاتح"},
    desc: {"en": "Sculpt Top in taupe brown.", "ar": "توب سكالبت، بني فاتح."},
    price: 8.0, category: "women", image: ph("Sculpt Top", "#7c2d12", "#431407"),
  },
  {
    slug: "sgomma-t-shirt-navy",
    name: {"en": "Sgomma T-Shirt — Navy", "ar": "تيشيرت سغوما — كحلي"},
    desc: {"en": "Sgomma T-Shirt in navy.", "ar": "تيشيرت سغوما، كحلي."},
    price: 5.0, category: "men", image: ph("Sgomma T-Shirt", "#1e293b", "#0f172a"),
  },
  {
    slug: "street-pants-navy",
    name: {"en": "Street Pants — Navy", "ar": "بنطال ستريت — كحلي"},
    desc: {"en": "Street Pants in navy.", "ar": "بنطال ستريت، كحلي."},
    price: 3.0, category: "men", image: ph("Street Pants", "#1e293b", "#0f172a"),
  },
  {
    slug: "tekno-shorts-black",
    name: {"en": "Tekno Shorts — Black", "ar": "شورت تكنو — أسود"},
    desc: {"en": "Tekno Shorts in black.", "ar": "شورت تكنو، أسود."},
    price: 3.0, category: "men", image: ph("Tekno Shorts", "#1e293b", "#0f172a"),
  },
  {
    slug: "tekno-shorts-royal",
    name: {"en": "Tekno Shorts — Royal", "ar": "شورت تكنو — أزرق ملكي"},
    desc: {"en": "Tekno Shorts in royal.", "ar": "شورت تكنو، أزرق ملكي."},
    price: 3.0, category: "men", image: ph("Tekno Shorts", "#1e293b", "#0f172a"),
  },
  {
    slug: "vanquish-stringer-vest-white",
    name: {"en": "Vanquish Stringer Vest — White", "ar": "ستراينجر فانكويش — أبيض"},
    desc: {"en": "Vanquish Stringer Vest in white.", "ar": "ستراينجر فانكويش، أبيض."},
    price: 8.0, category: "men", image: ph("Vanquish Stringer ", "#1e293b", "#0f172a"),
  },
  {
    slug: "vanquish-t-shirt-navy-blue",
    name: {"en": "Vanquish T-Shirt — Navy Blue", "ar": "تيشيرت فانكويش — كحلي"},
    desc: {"en": "Vanquish T-Shirt in navy blue.", "ar": "تيشيرت فانكويش، كحلي."},
    price: 10.0, category: "men", image: ph("Vanquish T-Shirt", "#1e293b", "#0f172a"),
  },
  {
    slug: "vanquish-t-shirt-white",
    name: {"en": "Vanquish T-Shirt — White", "ar": "تيشيرت فانكويش — أبيض"},
    desc: {"en": "Vanquish T-Shirt in white.", "ar": "تيشيرت فانكويش، أبيض."},
    price: 8.0, category: "men", image: ph("Vanquish T-Shirt", "#1e293b", "#0f172a"),
  },
  {
    slug: "vanquish-tank-navy",
    name: {"en": "Vanquish Tank — Navy", "ar": "تانك فانكويش — كحلي"},
    desc: {"en": "Vanquish Tank in navy.", "ar": "تانك فانكويش، كحلي."},
    price: 9.0, category: "men", image: ph("Vanquish Tank", "#1e293b", "#0f172a"),
  },
]

// Sizes per category — apparel needs a size, accessories don't.
export const SIZES_FOR = (category) =>
  ['women', 'men', 'outerwear'].includes(category) ? ['S', 'M', 'L', 'XL'] : null

export const getProduct = (slug) => PRODUCTS.find((p) => p.slug === slug)
export const byCategory = (cat) =>
  cat === 'all' ? PRODUCTS : PRODUCTS.filter((p) => p.category === cat)

// The live catalogue from /api, falling back to the SHIPPED list.
//
// The fallback is not politeness. PRODUCTS is bundled with the site, so a
// database that is unreachable for a moment shows a shop rather than an empty
// page — and the prices that matter are the ones api.php reads at order time,
// which the browser never sees or influences either way.
export async function loadProducts() {
  try {
    const { phpProducts } = await import('./backend')
    const data = await phpProducts()
    return Array.isArray(data) && data.length ? data.map(fromApi) : PRODUCTS
  } catch {
    return PRODUCTS
  }
}

// The API's row shape, turned into the shape every component already reads.
//
// The database has flat name_en / name_ar columns; the shipped catalogue has
// name: {en, ar}. Converting HERE, at the one boundary, is what lets
// ProductCard, the cart and the wishlist stay unaware that a database exists —
// and is why they render identically whether the shop is live or on its
// bundled fallback. Getting this wrong is silent: the cards render, with every
// name blank.
function fromApi(row) {
  // The shipped record for the same slug, when there is one. It is richer than
  // the table — placeholder artwork, a bilingual badge — and those are exactly
  // the fields the database has no column for.
  const shipped = PRODUCTS.find((p) => p.slug === row.slug)
  return {
    slug: row.slug,
    name: { en: row.name_en, ar: row.name_ar },
    desc: { en: row.desc_en ?? '', ar: row.desc_ar ?? '' },
    // Already the effective price — a live sale replaced it server-side.
    price: Number(row.price),
    list_price: row.list_price === undefined ? undefined : Number(row.list_price),
    on_sale: !!row.on_sale,
    featured: !!row.featured,
    featured_sort: Number(row.featured_sort ?? 0),
    category: row.category,
    // Which brand made it. Null for a product the admin has not assigned yet,
    // and for the whole shipped fallback catalogue — the plate then shows what
    // it always showed.
    // The brand, joined in by the API rather than fetched separately — see the
    // note on ?r=products. `brand` is null when the product has none, or when
    // the slug points at a brand that has since been hidden.
    brand: row.brand_slug
      ? {
          slug: row.brand_slug,
          name: { en: row.brand_name_en, ar: row.brand_name_ar },
          hasLogo: Number(row.brand_has_logo) === 1,
          v: row.brand_logo_v,
        }
      : null,
    // Women's clothing cannot be exchanged. The server decides which products
    // those are (products.no_exchange) rather than the browser inferring it
    // from the category: the women's Sculpt, Cloudsoft and Define jackets sit
    // under 'outerwear', so a category rule would have offered an exchange the
    // shop will refuse at the pickup.
    //
    // The shipped fallback catalogue has no such column, so it defaults to
    // false — which is the safe direction: it offers an exchange that a human
    // can decline, rather than refusing one the customer is entitled to.
    noExchange: !!row.no_exchange,
    // products.image is NULL for the whole seeded catalogue — the seed has no
    // image column to fill, because the artwork is generated in the front end.
    // Passing that null straight through rendered <img src={null}> on every
    // card: a broken-image glyph where the product should be. The shipped
    // placeholder is the answer until real photography exists.
    image: row.image || shipped?.image,
    // Extra photographs, comma-separated in display order. productImages()
    // splits this and puts `image` first. Absent for the shipped catalogue,
    // which has one picture per product and always will.
    images: row.images ?? null,
    // The shipped catalogue carries a bilingual badge; the database does not
    // have that column, and a badge is decoration. Keeping the shipped one
    // when the slug matches means switching to the live catalogue does not
    // silently strip "Bestseller" off every card.
    badge: shipped?.badge,
  }
}
