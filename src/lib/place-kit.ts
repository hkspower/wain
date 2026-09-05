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

/**
 * A decimal number in Arabic — digits AND the separator.
 *
 * `toArabicDigits` converts the digits and leaves the dot alone, which is
 * exactly half a translation: «٤.٧» is Arabic-Indic numerals around a Latin
 * full stop, and in Arabic that stop is the THOUSANDS mark. The rating on
 * every place card read as forty-seven hundred rather than four point seven.
 *
 * media.ts and orders.ts already knew this — «the decimal separator is the
 * Arabic one too, since ٧٫٢ with a Latin dot reads as a thousands mark» — and
 * each fixed it locally with its own `.replace(".", "٫")`. Three rating
 * displays and the distance label never got the memo. One helper now, so the
 * convention is a function rather than a habit.
 *
 * U+066B ARABIC DECIMAL SEPARATOR. voice-lines.ts converts it back to a dot
 * before speech, because TTS engines read «٫» as a pause.
 */
export function toArabicNumber(value: number, digits = 1): string {
  return toArabicDigits(value.toFixed(digits)).replace(".", "٫");
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

/**
 * "دقيقة" / "دقيقتين" / "٥ دقايق" / "١٥ دقيقة"
 *
 * Durations were the one place the rule was written out by hand each time, and
 * both hands got it wrong. The queue said «تقريباً ٥ دقيقة» for every wait it
 * ever showed a first-in-line customer, and the order tracker said «من ١ دقايق»
 * for an order placed a minute ago — the plural where the singular belongs, and
 * the singular where the plural belongs, in the same site.
 */
export const MINUTES_COUNT: CountForms = {
  one: "دقيقة",
  two: "دقيقتين",
  few: "دقايق",
  many: "دقيقة",
};

/** "ساعة" / "ساعتين" / "٣ ساعات" / "١٣ ساعة" */
export const HOURS_COUNT: CountForms = {
  one: "ساعة",
  two: "ساعتين",
  few: "ساعات",
  many: "ساعة",
};

/** "نتيجة واحدة" / "نتيجتين" / "٥ نتائج" / "١٧ نتيجة" */
export const RESULTS_COUNT: CountForms = {
  zero: "ما فيه نتائج",
  one: "نتيجة وحدة",
  two: "نتيجتين",
  few: "نتائج",
  many: "نتيجة",
};


/**
 * How far one place is from another, said the way a person says it.
 *
 * `toArabicNumber(km)` was the whole formatter, and it renders three hundred
 * metres as «٠٫٣ كم». Nobody says that. Worse, it is the wrong shape of
 * answer: a tenth of a kilometre reads as a measurement, and what a visitor
 * wants at that range is «walk it».
 *
 * The same rule شوق's brief uses (scripts/wain-ai-brief.mjs), so the page and
 * the voice cannot say two different things about one pair of places: metres
 * below a kilometre, one decimal above it.
 *
 * `rough` is for the places whose pin is the right AREA rather than the right
 * building — `coordsUnverified` in the catalogue. «٣٠٠ متر» about one of those
 * is a decimal place of invented confidence, so under a kilometre it says so
 * in words and above one it rounds to the half and hedges.
 */
export function distanceAr(km: number, rough = false): string {
  if (rough) {
    return km < 1
      ? "قريب جداً"
      : `${toArabicNumber(Math.round(km * 2) / 2)} كم تقريباً`;
  }
  if (km < 1) return `${toArabicDigits(Math.round((km * 1000) / 100) * 100)} متر`;
  // «٢ كم», not «٢٫٠ كم». A decimal place that is always zero is not
  // precision, it is furniture — and it made the shortest label the widest.
  const one = Math.round(km * 10) / 10;
  return `${Number.isInteger(one) ? toArabicDigits(one) : toArabicNumber(one)} كم`;
}
