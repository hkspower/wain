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
    slug: 'rheo-flex-leggings',
    name: { en: 'RHEO Flex Leggings', ar: 'ليقنز ريو فليكس' },
    desc: { en: 'High-waist squat-proof leggings.', ar: 'ليقنز بخصر عالٍ غير شفاف.' },
    price: 16.0, category: 'women', image: ph('Flex Leggings', '#3f2d1e', '#1a1109') },
  {
    slug: 'rheo-sports-bra',
    name: { en: 'RHEO Sports Bra', ar: 'حمالة رياضية ريو' },
    desc: { en: 'Medium-support training bra.', ar: 'حمالة تدريب بدعم متوسط.' },
    price: 10.5, category: 'women', image: ph('Sports Bra', '#7f1d1d', '#450a0a') },
  {
    slug: 'rheo-crop-tee',
    name: { en: 'RHEO Crop Tee', ar: 'تيشيرت كروب ريو' },
    desc: { en: 'Soft cropped training tee.', ar: 'تيشيرت تدريب قصير وناعم.' },
    price: 8.5, category: 'women', image: ph('Crop Tee', '#4d7c0f', '#1a2e05') },
  {
    slug: 'eyesport-shorts',
    name: { en: 'Eyesportwear Training Shorts', ar: 'شورت تدريب آي سبورت' },
    desc: { en: 'Quick-dry 7" training shorts.', ar: 'شورت تدريب سريع الجفاف.' },
    price: 9.0, category: 'men', image: ph('Shorts', '#171a1e', '#000000') },
  {
    slug: 'sporta-joggers',
    name: { en: 'SPORTA Joggers', ar: 'بنطلون سبورتا جوجر' },
    desc: { en: 'Tapered fleece joggers.', ar: 'بنطلون رياضي بقصة مضيّقة.' },
    price: 15.0, category: 'men', image: ph('Joggers', '#1f2937', '#0b1220'),
    badge: { en: 'New', ar: 'جديد' } },
  {
    slug: 'vanquish-long-sleeve',
    name: { en: 'Vanquish Long Sleeve', ar: 'فانكويش أكمام طويلة' },
    desc: { en: 'Fitted long-sleeve training top.', ar: 'توب تدريب ضيق بأكمام طويلة.' },
    price: 13.0, category: 'men', image: ph('Long Sleeve', '#0f172a', '#020617') },
  {
    slug: 'sporta-zip-hoodie',
    name: { en: 'SPORTA Zip Hoodie', ar: 'هودي سبورتا بسحاب' },
    desc: { en: 'Full-zip brushed-back hoodie.', ar: 'هودي بسحاب كامل ومبطن.' },
    price: 21.0, category: 'outerwear', image: ph('Zip Hoodie', '#E0561C', '#7c2d12') },
  {
    slug: 'ate-windbreaker',
    name: { en: 'ATE Windbreaker', ar: 'جاكيت ATE ويندبريكر' },
    desc: { en: 'Water-resistant packable shell.', ar: 'جاكيت خفيف مقاوم للماء.' },
    price: 24.0, category: 'outerwear', image: ph('Windbreaker', '#334155', '#0f172a') },
  {
    slug: 'sporta-gym-bag',
    name: { en: 'SPORTA Gym Bag', ar: 'حقيبة سبورتا الرياضية' },
    desc: { en: 'Duffel with shoe compartment.', ar: 'حقيبة رياضية بجيب للأحذية.' },
    price: 12.0, category: 'accessories', image: ph('Gym Bag', '#0d0d0d', '#3f3f46'),
    badge: { en: 'Bestseller', ar: 'الأكثر مبيعًا' } },
  {
    slug: 'shaker-bottle',
    name: { en: 'Protein Shaker 700ml', ar: 'شيكر بروتين ٧٠٠ مل' },
    desc: { en: 'Leak-proof shaker with mixer.', ar: 'شيكر محكم الإغلاق مع خلاط.' },
    price: 3.5, category: 'accessories', image: ph('Shaker', '#E0561C', '#B8430F') },
  {
    slug: 'lifting-straps',
    name: { en: 'Lifting Straps', ar: 'أحزمة رفع الأثقال' },
    desc: { en: 'Padded cotton lifting straps.', ar: 'أحزمة رفع قطنية مبطّنة.' },
    price: 4.5, category: 'accessories', image: ph('Straps', '#292524', '#0c0a09') },
  {
    slug: 'sporta-socks-3pack',
    name: { en: 'SPORTA Socks (3 pack)', ar: 'جوارب سبورتا (٣ أزواج)' },
    desc: { en: 'Cushioned crew training socks.', ar: 'جوارب تدريب مبطّنة.' },
    price: 5.0, category: 'accessories', image: ph('Socks', '#1e3a8a', '#0f172a') },
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
