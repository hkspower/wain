/**
 * The vocabulary a place is described in — without the places.
 *
 * This module exists because of a measured cost, not a taste for small files.
 * `places.ts` holds the whole catalogue AND the small things everything
 * else needs: the category list, the prep/service clamps, the Arabic-Indic
 * numerals. Importing one of those dragged in all of them.
 *
 * SearchHub imports `categories`. OrdersLink imports `toArabicDigits`.
 * `orders.ts` and `queue.ts` import two constants, two clamps and a TYPE.
 * None of them touches a single place record — and all of them are in the
 * root layout, so every page of the site shipped every record. The privacy
 * page, which is two paragraphs about cookies, carried the whole catalogue.
 *
 * The count used to be written out here, twice, and it said 53 against a
 * catalogue of 52 — `npm run content` is what noticed. A number in a comment
 * that has to track the data is a number that will be wrong, so this one
 * names the thing instead of counting it.
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

/**
 * A category by id.
 *
 * Moved here from `places.ts` for the reason this file exists: it reads
 * `categories`, which is already here, and touches no place record — but
 * living next to the catalogue meant any client component that needed a
 * category name imported the catalogue to get it. `places.ts` re-exports
 * everything below, so every existing import still resolves.
 */
export function getCategory(id: CategoryId): Category | undefined {
  return categories.find((c) => c.id === id);
}

/**
 * Whether a place can take a pre-order, and whether it is running a queue.
 *
 * Both live here rather than in `orders.ts` and `queue.ts`, where they were,
 * because each reads two fields off a Place and calls no service — while their
 * old homes are `"use client"` modules carrying the Supabase bridge and the
 * network layer. The search page needs the questions and none of the
 * machinery: asking them from there pulled 6KB of first-load JavaScript onto a
 * route that never places an order (measured, 148KB → 154KB).
 *
 * They are NOT in `places.ts`, which was the first attempt and the wrong one.
 * Re-exporting from there gave `orders.ts` and `queue.ts` a *value* dependency
 * on the catalogue where they had only ever had a type, and the catalogue duly
 * reappeared in the shared chunk — the exact regression the header of this file
 * describes and `audit:js` guards. `import type` below is erased at compile
 * time, so this file still imports no places.
 */
import type { Place } from "@/lib/places";

export function acceptsOrders(place: Place): boolean {
  return Boolean(place.acceptsOrders && (place.menuAr?.length ?? 0) > 0);
}

export function takesQueue(place: Place): boolean {
  return Boolean(place.takesQueue && place.salonKind);
}

/* ── Moved out of places.ts ──────────────────────────────────────────────
   Five helpers that never touch a place record: two gradient lookups, the
   slug hash behind them, the tint table and great-circle distance. They sat
   beside the catalogue, so a client component wanting a category tint
   imported the module holding all 52 records and shipped them. That is the
   same edge this file was split out to close, one layer further in.
   ──────────────────────────────────────────────────────────────────────── */
export function categoryGradient(id: CategoryId): string {
  return getCategory(id)?.gradient ?? "from-sand-600 via-sand-700 to-sand-900";
}

/**
 * Stable 0-3 derived from the slug. Places in one category share a single
 * hand-drawn scene, so without this every تسوّق card rendered the identical
 * image; the variant drives a mirrored or shifted composition plus a
 * different gradient direction, making each place's art its own.
 *
 * The constants (×38 mod 65521) were chosen so that no two places in the
 * same category land on the same variant with the current dataset — verify
 * again if that ever seems off after adding places.
 */
export function placeVariant(slug: string): 0 | 1 | 2 | 3 {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 38 + slug.charCodeAt(i)) % 65521;
  return (h % 4) as 0 | 1 | 2 | 3;
}

const GRADIENT_DIRECTION = [
  "bg-gradient-to-br",
  "bg-gradient-to-tr",
  "bg-gradient-to-b",
  "bg-gradient-to-bl",
] as const;

/**
 * The place hero: one hue per category, on the ink ramp's own lightnesses.
 *
 * The first version of this took each category's ramp directly, and the ramps
 * were not comparable — coral sits at chroma 0.21, sea at 0.086 — so the same
 * hero read twice as loud on a restaurant as on a landmark, and the heroes as
 * a group ran far more saturated than any other route. Dropping to ink fixed
 * the inconsistency by removing the variable.
 *
 * These ramps are generated instead of picked (see --color-hero-* in
 * theme.css): identical lightness and identical chroma at every step, hue
 * the only difference. So the black point and the white-stroke contrast the
 * monochrome pass established both survive, and a category is once again
 * recognisable before you have read anything.
 *
 * Written out in full because Tailwind scans for literal class names — built
 * from a template these would never be emitted.
 */
const HERO_GRADIENT: Record<CategoryId, string> = {
  landmarks: "from-hero-landmarks-1 via-hero-landmarks-2 to-hero-landmarks-3",
  restaurants: "from-hero-restaurants-1 via-hero-restaurants-2 to-hero-restaurants-3",
  fastfood: "from-hero-fastfood-1 via-hero-fastfood-2 to-hero-fastfood-3",
  coffee: "from-hero-coffee-1 via-hero-coffee-2 to-hero-coffee-3",
  outdoors: "from-hero-outdoors-1 via-hero-outdoors-2 to-hero-outdoors-3",
  shopping: "from-hero-shopping-1 via-hero-shopping-2 to-hero-shopping-3",
  culture: "from-hero-culture-1 via-hero-culture-2 to-hero-culture-3",
  family: "from-hero-family-1 via-hero-family-2 to-hero-family-3",
};

export function placeGradient(place: Pick<Place, "slug" | "category">): string {
  return `${GRADIENT_DIRECTION[placeVariant(place.slug)]} ${HERO_GRADIENT[place.category]}`;
}

/**
 * Tile and mark colour for a place's icon, so a thumbnail carries its
 * category before the name has been read. Literal strings for the same
 * reason as HERO_GRADIENT — Tailwind only emits classes it can see.
 */
const CATEGORY_TINT: Record<CategoryId, string> = {
  landmarks: "bg-cat-landmarks-tint text-cat-landmarks-ink",
  restaurants: "bg-cat-restaurants-tint text-cat-restaurants-ink",
  fastfood: "bg-cat-fastfood-tint text-cat-fastfood-ink",
  coffee: "bg-cat-coffee-tint text-cat-coffee-ink",
  outdoors: "bg-cat-outdoors-tint text-cat-outdoors-ink",
  shopping: "bg-cat-shopping-tint text-cat-shopping-ink",
  culture: "bg-cat-culture-tint text-cat-culture-ink",
  family: "bg-cat-family-tint text-cat-family-ink",
};

export function categoryTint(id: CategoryId): string {
  return CATEGORY_TINT[id];
}

/** Great-circle distance in kilometres. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

