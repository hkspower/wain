// Product catalog. Bilingual (en/ar). Replace with your real Sporta products,
// or load from Supabase (see loadProducts). Prices are in KWD.
//
// Each product: slug, name{en,ar}, desc{en,ar}, price, category, image, badge?
export const CATEGORIES = [
  { id: 'all', name: { en: 'All', ar: 'الكل' } },
  { id: 'football', name: { en: 'Football', ar: 'كرة القدم' } },
  { id: 'fitness', name: { en: 'Fitness', ar: 'اللياقة' } },
  { id: 'running', name: { en: 'Running', ar: 'الجري' } },
  { id: 'accessories', name: { en: 'Accessories', ar: 'إكسسوارات' } },
]

// Inline SVG placeholder so the app runs with zero external images.
const ph = (label, c1, c2) =>
  `data:image/svg+xml;utf8,` +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/><text x="50%" y="52%" font-family="Arial" font-size="42" font-weight="bold" fill="white" text-anchor="middle">${label}</text></svg>`,
  )

export const PRODUCTS = [
  {
    slug: 'pro-match-ball',
    name: { en: 'Pro Match Football', ar: 'كرة قدم احترافية' },
    desc: { en: 'FIFA-quality match ball, hand-stitched.', ar: 'كرة مباريات بجودة الفيفا، مخيطة يدويًا.' },
    price: 18.5, category: 'football', image: ph('Football', '#0e7a5f', '#0a5c47'),
    badge: { en: 'Bestseller', ar: 'الأكثر مبيعًا' },
  },
  {
    slug: 'training-cones-set',
    name: { en: 'Training Cones (Set of 20)', ar: 'أقماع تدريب (20 قطعة)' },
    desc: { en: 'Durable agility cones for drills.', ar: 'أقماع رشاقة متينة للتمارين.' },
    price: 6.25, category: 'football', image: ph('Cones', '#4f46e5', '#3730a3'),
  },
  {
    slug: 'adjustable-dumbbell',
    name: { en: 'Adjustable Dumbbell 24kg', ar: 'دمبل قابل للتعديل ٢٤ كجم' },
    desc: { en: 'Space-saving, 5–24 kg per side.', ar: 'موفّر للمساحة، ٥–٢٤ كجم لكل جهة.' },
    price: 42.0, category: 'fitness', image: ph('Dumbbell', '#0e7a5f', '#064e3b'),
    badge: { en: 'New', ar: 'جديد' },
  },
  {
    slug: 'yoga-mat-pro',
    name: { en: 'Pro Yoga Mat', ar: 'سجادة يوغا احترافية' },
    desc: { en: 'Non-slip, extra-thick 6 mm.', ar: 'غير قابلة للانزلاق، سماكة ٦ مم.' },
    price: 9.75, category: 'fitness', image: ph('Yoga Mat', '#6366f1', '#4338ca'),
  },
  {
    slug: 'running-shoes-air',
    name: { en: 'Air Running Shoes', ar: 'حذاء جري إير' },
    desc: { en: 'Lightweight cushioned trainers.', ar: 'حذاء رياضي خفيف ومبطّن.' },
    price: 27.9, category: 'running', image: ph('Shoes', '#0e7a5f', '#0a5c47'),
  },
  {
    slug: 'hydration-bottle',
    name: { en: 'Hydration Bottle 1L', ar: 'زجاجة ماء ١ لتر' },
    desc: { en: 'BPA-free, insulated.', ar: 'خالية من BPA، معزولة حراريًا.' },
    price: 3.5, category: 'accessories', image: ph('Bottle', '#4f46e5', '#3730a3'),
  },
  {
    slug: 'gym-gloves',
    name: { en: 'Training Gloves', ar: 'قفازات تدريب' },
    desc: { en: 'Padded grip, breathable.', ar: 'قبضة مبطّنة، قابلة للتهوية.' },
    price: 5.0, category: 'accessories', image: ph('Gloves', '#0e7a5f', '#064e3b'),
  },
  {
    slug: 'resistance-bands',
    name: { en: 'Resistance Bands Set', ar: 'أشرطة مقاومة' },
    desc: { en: '5 levels, with door anchor.', ar: '٥ مستويات، مع مثبّت باب.' },
    price: 7.8, category: 'fitness', image: ph('Bands', '#6366f1', '#4338ca'),
  },
]

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
