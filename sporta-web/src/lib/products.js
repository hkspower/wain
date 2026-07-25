// Product catalog. Bilingual (en/ar). Replace with your real Sporta products,
// or load from Supabase (see loadProducts). Prices are in KWD.
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
const ph = (label, c1, c2) =>
  `data:image/svg+xml;utf8,` +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/><text x="50%" y="52%" font-family="Arial" font-size="42" font-weight="bold" fill="white" text-anchor="middle">${label}</text></svg>`,
  )

// Placeholder sportswear catalog matching the real Sporta range (activewear,
// gym clothing, outerwear, accessories). Replace with real products/prices via
// the admin or Supabase.
export const PRODUCTS = [
  {
    slug: 'rheo-seamless-set',
    name: { en: 'RHEO Seamless Set', ar: 'طقم ريو سيملس' },
    desc: { en: 'Women’s seamless leggings + top set.', ar: 'طقم ليقنز وتوب حريمي سيملس.' },
    price: 24.0, category: 'women', image: ph('RHEO Set', '#7c2d12', '#431407'),
    badge: { en: 'Bestseller', ar: 'الأكثر مبيعًا' },
  },
  {
    slug: 'rheo-zip-top',
    name: { en: 'RHEO Zip Top', ar: 'توب ريو بسحاب' },
    desc: { en: 'Long-sleeve zip training top.', ar: 'توب تدريب بأكمام طويلة وسحاب.' },
    price: 14.5, category: 'women', image: ph('Zip Top', '#F26522', '#C24E12'),
  },
  {
    slug: 'sporta-compression-tee',
    name: { en: 'SPORTA Compression Tee', ar: 'تيشيرت سبورتا ضاغط' },
    desc: { en: 'Men’s performance compression tee.', ar: 'تيشيرت رجالي ضاغط للأداء.' },
    price: 11.0, category: 'men', image: ph('SPORTA Tee', '#0d0d0d', '#1a1a1a'),
    badge: { en: 'New', ar: 'جديد' },
  },
  {
    slug: 'vanquish-tank',
    name: { en: 'Vanquish Training Tank', ar: 'فانكويش تانك' },
    desc: { en: 'Breathable sleeveless training tank.', ar: 'تانك تدريب خفيف وقابل للتهوية.' },
    price: 9.5, category: 'men', image: ph('Tank', '#1e3a5f', '#0f2038') },
  {
    slug: 'ate-felpa-hoodie',
    name: { en: 'ATE Felpa Hoodie — Navy', ar: 'هودي ATE فيلبا — كحلي' },
    desc: { en: 'Heavyweight cotton-blend hoodie.', ar: 'هودي قطني ثقيل عالي الجودة.' },
    price: 19.0, category: 'outerwear', image: ph('Hoodie', '#1e293b', '#0f172a') },
  {
    slug: 'ate-smart-jacket',
    name: { en: 'ATE Smart Jacket', ar: 'جاكيت ATE سمارت' },
    desc: { en: 'Lightweight zip training jacket.', ar: 'جاكيت تدريب خفيف بسحاب.' },
    price: 22.0, category: 'outerwear', image: ph('Jacket', '#0d0d0d', '#262626') },
  {
    slug: 'nba-cap',
    name: { en: 'NBA Team Cap', ar: 'كاب NBA' },
    desc: { en: 'Official-style team snapback cap.', ar: 'كاب فريق بتصميم رسمي.' },
    price: 8.0, category: 'accessories', image: ph('Cap', '#1e3a8a', '#172554') },
  {
    slug: 'gymshark-phone-strap',
    name: { en: 'Gymshark Phone Strap', ar: 'حزام جوال جيمشارك' },
    desc: { en: 'Running arm phone strap.', ar: 'حزام ذراع للجوال أثناء الجري.' },
    price: 5.5, category: 'accessories', image: ph('Phone Strap', '#F26522', '#C24E12') },
]

// Sizes per category — apparel needs a size, accessories don't.
export const SIZES_FOR = (category) =>
  ['women', 'men', 'outerwear'].includes(category) ? ['S', 'M', 'L', 'XL'] : null

export const getProduct = (slug) => PRODUCTS.find((p) => p.slug === slug)
export const byCategory = (cat) =>
  cat === 'all' ? PRODUCTS : PRODUCTS.filter((p) => p.category === cat)

// Optional: load products from Supabase instead of the static list.
// Falls back to PRODUCTS if Supabase isn't configured or the query fails.
export async function loadProducts() {
  try {
    const { supabase } = await import('./supabase')
    if (!supabase) return PRODUCTS
    const { data, error } = await supabase.from('products').select('*').eq('active', true)
    if (error || !data?.length) return PRODUCTS
    return data
  } catch {
    return PRODUCTS
  }
}
