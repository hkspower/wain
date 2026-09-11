/**
 * The catalogue types, and a bundled copy of the catalogue itself.
 *
 * The bundled copy is not sample data to be deleted later — it is the offline
 * fallback. A phone in a basement gym has no signal, and a shop that shows a
 * spinner there has nothing to sell. `api.ts` fetches the live catalogue and
 * falls back to this, so the app always opens onto a working storefront.
 *
 * Prices are FILS, always. See lib/money.ts.
 */

import type { Fils } from '@/lib/money';

export type CategoryId = 'men' | 'women' | 'accessories' | 'outlet';

export interface Category {
  id: CategoryId;
  name: string;
  nameAr: string;
  kicker: string;
  kickerAr: string;
  /** Tile background, showing until the photograph loads and if it never does. */
  color: string;
  emoji: string;
  /** Outlet wears its line as an orange pill rather than as plain copy. */
  badge?: boolean;
}

export interface Variant {
  /** Size label as printed on the garment: S/M/L, or 40/41/42 for shoes. */
  size: string;
  stock: number;
}

export interface Product {
  slug: string;
  name: string;
  nameAr: string;
  brand: string;
  category: CategoryId;
  price: Fils;
  /** Pre-discount price, when there is one. */
  was?: Fils;
  emoji: string;
  color: string;
  /** The photograph's URL, as the shop gave it. Absent on the bundled
   *  catalogue, which ships its pictures inside the app. */
  photo?: string;
  blurb: string;
  blurbAr: string;
  details: string[];
  detailsAr: string[];
  variants: Variant[];
  featured?: boolean;
  /** Shows the "new" badge. Set by the shop, not derived from a date — a
   *  product added months ago in a quiet week is not new, and a date would
   *  make it so. */
  isNew?: boolean;
}

// GROUNDS TAKEN FROM THE LIVE TILES, which the owner sent as the reference.
// They are charcoal because the photographs are charcoal: this layer shows
// while the picture decodes and instead of it when there is none, so a bright
// ground would mean the tile changes character the moment the shop is
// reachable. White copy sits on all four at better than 10:1.
export const categories: Category[] = [
  { id: 'men', name: 'Men', nameAr: 'رجالي', kicker: 'Performance gear', kickerAr: 'معدات الأداء', color: '#26292e', emoji: '🏋️' },
  { id: 'women', name: 'Women', nameAr: 'نسائي', kicker: 'Move with confidence', kickerAr: 'تحرّكي بثقة', color: '#2e2622', emoji: '🤸' },
  { id: 'accessories', name: 'Accessories', nameAr: 'إكسسوارات', kicker: 'Everyday essentials', kickerAr: 'معدات أساسية', color: '#2b3138', emoji: '🧢' },
  { id: 'outlet', name: 'Outlet', nameAr: 'سبورتا أوتلت', kicker: 'Up to 60% off', kickerAr: 'خصومات حتى ٦٠٪', color: '#24262a', emoji: '🏷️', badge: true },
];

const S_M_L = (stock: number[]): Variant[] =>
  ['S', 'M', 'L', 'XL'].map((size, i) => ({ size, stock: stock[i] ?? 0 }));

export const products: Product[] = [
  {
    slug: 'sculpt-top-grey',
    name: 'Sculpt training top',
    nameAr: 'تيشيرت سكالبت للتمرين',
    brand: 'Sporta',
    category: 'women',
    price: 12_500,
    emoji: '👚',
    color: '#8a3ca8',
    blurb: 'Seamless, high-stretch, and it stays where you put it.',
    blurbAr: 'بدون خياطات، مرن، ويبقى بمكانه أثناء الحركة.',
    details: ['Seamless knit', 'Four-way stretch', 'Machine wash cold'],
    detailsAr: ['نسيج بدون خياطات', 'مرونة بأربع اتجاهات', 'غسيل آلي بارد'],
    variants: S_M_L([4, 7, 6, 2]),
    featured: true,
    isNew: true,
  },
  {
    slug: 'core-compression-tee',
    name: 'Core compression tee',
    nameAr: 'تيشيرت كور ضاغط',
    brand: 'Sporta',
    category: 'men',
    price: 11_000,
    was: 14_000,
    emoji: '👕',
    color: '#c8490f',
    blurb: 'Holds the muscle, moves the sweat, survives the heat.',
    blurbAr: 'يثبّت العضلة، ينقل العرق، ويتحمّل الحر.',
    details: ['Compression fit', 'Moisture wicking', 'Flat-lock seams'],
    detailsAr: ['قصة ضاغطة', 'يمتص الرطوبة', 'خياطة مسطحة'],
    variants: S_M_L([6, 9, 8, 3]),
    featured: true,
  },
  {
    slug: 'desert-runner-short',
    name: 'Desert runner short',
    nameAr: 'شورت ديزرت للجري',
    brand: 'Sporta',
    category: 'men',
    price: 9_750,
    emoji: '🩳',
    color: '#8a6a4f',
    blurb: 'Seven inches, zip pocket, weighs almost nothing.',
    blurbAr: 'سبع إنشات، جيب بسحّاب، خفيف جداً.',
    details: ['7" inseam', 'Zip back pocket', 'Reflective hit'],
    detailsAr: ['طول ٧ إنش', 'جيب خلفي بسحّاب', 'شريط عاكس'],
    variants: S_M_L([5, 6, 4, 0]),
  },
  {
    slug: 'high-rise-legging',
    name: 'High-rise legging',
    nameAr: 'ليقنز عالي الخصر',
    brand: 'Sporta',
    category: 'women',
    price: 15_000,
    emoji: '🩱',
    color: '#8a3ca8',
    blurb: 'Squat-proof, pocket on each thigh, no waistband dig.',
    blurbAr: 'غير شفاف، جيب على كل فخذ، وخصر مريح.',
    details: ['Squat-proof knit', 'Side pockets', 'High rise'],
    detailsAr: ['نسيج غير شفاف', 'جيوب جانبية', 'خصر عالٍ'],
    // Four left across every size: the "almost gone" badge exists for this
    // case and no product in the bundled catalogue reached it, so the badge
    // was unreachable code until this line.
    variants: S_M_L([1, 2, 0, 1]),
    featured: true,
  },
  {
    slug: 'grip-training-glove',
    name: 'Grip training glove',
    nameAr: 'قفاز التمرين',
    brand: 'Sporta',
    category: 'accessories',
    price: 5_500,
    emoji: '🧤',
    color: '#2b3138',
    blurb: 'Padded palm, wrist wrap, no more torn hands.',
    blurbAr: 'كف مبطّن ورباط للمعصم، وداعاً للتشققات.',
    details: ['Padded palm', 'Wrist wrap', 'Washable'],
    detailsAr: ['كف مبطّن', 'رباط معصم', 'قابل للغسل'],
    // Sold out, deliberately. A catalogue where nothing is ever unavailable
    // never shows the state a customer meets most often on a real shop.
    variants: [
      { size: 'S', stock: 0 },
      { size: 'M', stock: 0 },
      { size: 'L', stock: 0 },
    ],
  },
  {
    slug: 'club-cap',
    name: 'Club cap',
    nameAr: 'كاب سبورتا',
    brand: 'Sporta',
    category: 'accessories',
    price: 4_250,
    emoji: '🧢',
    color: '#363d45',
    blurb: 'Six panels, curved brim, one honest logo.',
    blurbAr: 'ستة أقسام، حافة منحنية، وشعار واحد.',
    details: ['Cotton twill', 'Adjustable strap', 'One size'],
    detailsAr: ['قطن تويل', 'حزام قابل للتعديل', 'مقاس واحد'],
    variants: [{ size: 'OS', stock: 20 }],
  },
  {
    slug: 'shaker-bottle',
    name: 'Shaker bottle 700ml',
    nameAr: 'شيكر ٧٠٠ مل',
    brand: 'Sporta',
    category: 'accessories',
    price: 3_000,
    emoji: '🥤',
    color: '#2b3138',
    blurb: 'Leak-proof lid, steel whisk, dishwasher safe.',
    blurbAr: 'غطاء محكم، خلاط معدني، آمن بغسالة الصحون.',
    details: ['700 ml', 'Leak-proof', 'BPA free'],
    detailsAr: ['٧٠٠ مل', 'لا يسرّب', 'خالٍ من BPA'],
    variants: [{ size: 'OS', stock: 30 }],
  },
  {
    slug: 'last-season-hoodie',
    name: 'Last-season hoodie',
    nameAr: 'هودي الموسم الماضي',
    brand: 'Sporta',
    category: 'outlet',
    price: 8_000,
    was: 20_000,
    emoji: '🧥',
    color: '#8a6a4f',
    blurb: 'Same fleece, previous colourway, sixty per cent off.',
    blurbAr: 'نفس الخامة، لون الموسم الماضي، بخصم ٦٠٪.',
    details: ['Brushed fleece', 'Kangaroo pocket', 'Unisex fit'],
    detailsAr: ['صوف ناعم', 'جيب أمامي', 'قصة للجنسين'],
    variants: S_M_L([2, 3, 0, 1]),
  },
  {
    slug: 'trail-shoe-40',
    name: 'Trail shoe',
    nameAr: 'حذاء تريل',
    brand: 'Sporta',
    category: 'men',
    price: 24_000,
    emoji: '👟',
    color: '#c8490f',
    blurb: 'Grips gravel, drains sand, laughs at the corniche.',
    blurbAr: 'يمسك الحصى، يطرد الرمل، ومناسب للكورنيش.',
    details: ['Rock plate', 'Drainage ports', '8 mm drop'],
    detailsAr: ['حماية من الحصى', 'فتحات تصريف', 'فرق ٨ مم'],
    variants: [40, 41, 42, 43, 44].map((n, i) => ({ size: String(n), stock: [2, 4, 5, 3, 1][i] })),
    featured: true,
    isNew: true,
  },
];

export const brands = ['Sporta'];

export const findProduct = (slug: string, list: Product[] = products) =>
  list.find((p) => p.slug === slug);

export const inStock = (p: Product) => p.variants.some((v) => v.stock > 0);

/** Everything on the shelf, across sizes. */
export const totalStock = (p: Product) => p.variants.reduce((n, v) => n + v.stock, 0);

/** The threshold the "almost gone" badge fires at. Low enough to be true, high
 *  enough to still be actionable: at one or two a customer who wants a
 *  particular size has probably already missed it. */
export const LOW_STOCK = 5;

/**
 * UNTRACKED PRODUCTS ARE NOT OUT OF STOCK. A product with no rows in
 * product_variants — the backpack, the caps, the phone strap — has no stock
 * figure anywhere, and the server says so explicitly: store_price_lines only
 * demands a size when rows exist, and store_stock_claim skips those lines
 * rather than invent a count. The website sells them.
 *
 * The app did not. `?? 0` read "no row" as "none left", so every accessory in
 * the shop had a size row that could not be picked and an Add button that
 * answered "choose a size" forever. Untracked means untracked: the only cap
 * left is the server's own per-line limit.
 */
export const UNTRACKED_CAP = 99; // store.php: qty > 99 is invalid_qty

export const isTracked = (p: Product) => p.variants.length > 0;

export const stockFor = (p: Product, size: string) =>
  isTracked(p) ? (p.variants.find((v) => v.size === size)?.stock ?? 0) : UNTRACKED_CAP;

/** Localised accessors, so screens never branch on language themselves. */
export const productName = (p: Product, lang: 'ar' | 'en') => (lang === 'ar' ? p.nameAr : p.name);
export const productBlurb = (p: Product, lang: 'ar' | 'en') => (lang === 'ar' ? p.blurbAr : p.blurb);
export const productDetails = (p: Product, lang: 'ar' | 'en') =>
  lang === 'ar' ? p.detailsAr : p.details;
export const categoryName = (c: Category, lang: 'ar' | 'en') => (lang === 'ar' ? c.nameAr : c.name);
export const categoryKicker = (c: Category, lang: 'ar' | 'en') =>
  lang === 'ar' ? c.kickerAr : c.kicker;
