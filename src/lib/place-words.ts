import type { Place } from "@/lib/places";
import { toArabicNumber } from "@/lib/place-kit";

/**
 * How a place is described in a few words — on its page, on a map pin, and
 * in the one sentence a screen reader hears for that pin.
 *
 * Not place-kit: that lives in the chunk every page pays for, /about and
 * /privacy included, and these are only read where a place is drawn. Not the
 * catalogue either — `import type` only — so a map can carry them without
 * carrying 52 records.
 */
export const SETTING_LABEL = { indoor: "مكيّف", outdoor: "برا", mixed: "داخلي وبرا" } as const;

/** By priceLevel: index 0 is unused. */
export const PRICE_LABEL = ["", "اقتصادي", "متوسط", "راقي"] as const;

/** Said wherever an approximate coordinate is drawn — the place page's own words. */
export const APPROX_PIN = "الدبوس على المنطقة تقريباً";

type PinPlace = Pick<Place, "nameAr" | "areaAr" | "rating" | "setting" | "priceLevel" | "coordsUnverified">;

/**
 * Everything a sighted visitor reads off a pin and its callout, as ONE name.
 *
 * The callout used to sit in the accessibility tree at opacity 0 on every pin,
 * so a screen reader met each place twice — «مقاهي المباركية — مدينة الكويت»
 * and then «مقاهي المباركية مدينة الكويت ٤٫٧», the rating a bare number. The
 * callout is hidden from it now and this is the one description, beginning
 * «name — area» as it always has.
 */
export function pinLabel(place: PinPlace): string {
  const parts = [`${place.nameAr} — ${place.areaAr}`];
  if (place.rating !== undefined) parts.push(`التقييم ${toArabicNumber(place.rating)} من ٥`);
  parts.push(SETTING_LABEL[place.setting], PRICE_LABEL[place.priceLevel]);
  if (place.coordsUnverified) parts.push(APPROX_PIN);
  return parts.join("، ");
}
