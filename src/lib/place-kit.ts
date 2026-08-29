/**
 * The vocabulary a place is described in — without the places.
 *
 * This module exists because of a measured cost, not a taste for small files.
 * `places.ts` holds the 36-record catalogue AND the small things everything
 * else needs: the category list, the prep/service clamps, the Arabic-Indic
 * numerals. Importing one of those dragged in all of them.
 *
 * The Footer imports `categories`. OrdersLink imports `toArabicDigits`.
 * `orders.ts` and `queue.ts` import two constants, two clamps and a TYPE.
 * None of them touches a single place record — and all of them are in the
 * root layout, so every page of the site shipped all 36 places. The privacy
 * page, which is two paragraphs about cookies, carried the whole catalogue.
 *
 * Nothing here may import the catalogue. That is the rule that makes the
 * split worth having, and `npm run audit:js` fails if a static page starts
 * carrying place records again.
 */
export type CategoryId =
  | "landmarks"
  | "restaurants"
  | "fastfood"
  | "coffee"
  | "outdoors"
  | "shopping"
  | "culture"
  | "family";

export interface Category {
  id: CategoryId;
  ar: string;
  en: string;
  /** Key consumed by <CategoryIcon /> */
  icon: string;
  blurbAr: string;
  /** Brand gradient for cards and hero panels in this category. */
  gradient: string;
}

export const DEFAULT_PREP_MINUTES = 30;
export const MIN_PREP_MINUTES = 5;
export const MAX_PREP_MINUTES = 240;

/**
 * Matches the CHECK on places.order_prep_minutes, so the form and the database
 * agree about what is allowed rather than differing by one.
 *
 * Lives here rather than in orders.ts because supabase.ts needs it to map a
 * row, and orders.ts needs supabase.ts — putting it there made an import cycle
 * out of a pure arithmetic function.
 */
export function clampPrepMinutes(value: number | undefined | null): number {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_PREP_MINUTES;
  return Math.min(MAX_PREP_MINUTES, Math.max(MIN_PREP_MINUTES, Math.round(value as number)));
}

export const DEFAULT_SERVICE_MINUTES = 20;
export const MIN_SERVICE_MINUTES = 5;
export const MAX_SERVICE_MINUTES = 180;

/** Matches the CHECK on places.queue_service_minutes. Here for the same reason
 *  as clampPrepMinutes: supabase.ts maps the row and must not depend on
 *  queue.ts, which depends on supabase.ts. */
export function clampServiceMinutes(value: number | undefined | null): number {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_SERVICE_MINUTES;
  return Math.min(MAX_SERVICE_MINUTES, Math.max(MIN_SERVICE_MINUTES, Math.round(value as number)));
}


/** Ordered the way the category rail reads on the home page. */
export const categories: Category[] = [
  {
    id: "landmarks",
    gradient: "from-sea-500 via-sea-600 to-sea-800",
    ar: "معالم الكويت",
    en: "Landmarks",
    icon: "tower",
    blurbAr: "أيقونات المدينة",
  },
  {
    id: "restaurants",
    gradient: "from-coral-500 via-coral-600 to-coral-800",
    ar: "مطاعم",
    en: "Restaurants",
    icon: "cutlery",
    blurbAr: "غدا وعشا",
  },
  {
    id: "fastfood",
    gradient: "from-sun-600 via-sun-700 to-sun-900",
    ar: "وجبات سريعة",
    en: "Fast bites",
    icon: "burger",
    blurbAr: "على السريع",
  },
  {
    id: "coffee",
    gradient: "from-sand-600 via-sand-700 to-sand-900",
    ar: "قهوة",
    en: "Coffee",
    icon: "coffee",
    blurbAr: "قهوة وچاي",
  },
  {
    id: "outdoors",
    gradient: "from-palm-500 via-palm-600 to-sea-700",
    ar: "شواطئ وحدائق",
    en: "Outdoors",
    icon: "palm",
    blurbAr: "بحر وخضرة",
  },
  {
    id: "shopping",
    gradient: "from-sun-600 via-coral-600 to-coral-800",
    ar: "تسوّق",
    en: "Shopping",
    icon: "bag",
    blurbAr: "أسواق ومولات",
  },
  {
    id: "culture",
    gradient: "from-sea-600 via-sea-800 to-ink-800",
    ar: "ثقافة",
    en: "Culture",
    icon: "masks",
    blurbAr: "متاحف وفنون",
  },
  {
    id: "family",
    gradient: "from-palm-500 via-palm-600 to-palm-800",
    ar: "عائلة",
    en: "Family",
    icon: "ferris",
    blurbAr: "طلعة العيال",
  },
];

/** Arabic-Indic digits, so numbers match the rest of the UI. */
export function toArabicDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

export interface CountForms {
  /** ١ — "مكان واحد" (no numeral) */
  one: string;
  /** ٢ — "مكانين" (dual, no numeral) */
  two: string;
  /** ٣–١٠ — plural after the numeral: "٣ أماكن" */
  few: string;
  /** ١١+ — singular after the numeral: "١٧ مكان" */
  many: string;
  /** ٠ — defaults to the `many` form */
  zero?: string;
}

/**
 * Arabic count agreement. Arabic does not simply append a noun to a numeral:
 * 1 takes the singular alone, 2 takes the dual, 3–10 take the plural, and
 * 11+ revert to the singular. Writing "٣ مكان" or "٢ مكان" is ungrammatical.
 */
export function countAr(n: number, forms: CountForms): string {
  const digits = toArabicDigits(n);
  if (n === 0) return forms.zero ?? `${digits} ${forms.many}`;
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  const mod100 = n % 100;
  if (mod100 >= 3 && mod100 <= 10) return `${digits} ${forms.few}`;
  return `${digits} ${forms.many}`;
}

/** "مكان واحد" / "مكانين" / "٣ أماكن" / "١٧ مكان" */
export const PLACES_COUNT: CountForms = {
  zero: "ما فيه أماكن",
  one: "مكان واحد",
  two: "مكانين",
  few: "أماكن",
  many: "مكان",
};

/** "نتيجة واحدة" / "نتيجتين" / "٥ نتائج" / "١٧ نتيجة" */
export const RESULTS_COUNT: CountForms = {
  zero: "ما فيه نتائج",
  one: "نتيجة وحدة",
  two: "نتيجتين",
  few: "نتائج",
  many: "نتيجة",
};

