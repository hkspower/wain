"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import PlaceIcon from "@/components/PlaceIcon";
import { IconGo, IconStar } from "@/components/icons";
import { toArabicDigits, type CategoryId, type Place } from "@/lib/places";

/**
 * One place on a map, on both maps.
 *
 * ## Why it activates on tap
 *
 * The pins used to react only to `mouseenter`, which meant the name of a place
 * was readable on a desktop and nowhere else. On a phone — which is nearly all
 * of Kuwait's traffic — a tap fired the link immediately, so the label the map
 * was built around had no moment in which it could ever be seen, and the map
 * and the result list "staying in step" was a desktop-only feature.
 *
 * So on a device with no hover, the first tap selects and the second opens:
 * the standard behaviour of every map anybody has used, and the reason a map
 * pin can carry a name at all. Nothing changes for a mouse — hover selects,
 * one click still opens.
 *
 * `(hover: none)` rather than a touch-capability check: a laptop with a
 * touchscreen has both, and the question is not "can this device be touched"
 * but "does hovering tell this person anything".
 *
 * ## Why the colour
 *
 * Every pin used to be the same near-black circle, which made a map of eight
 * different kinds of place look like a map of one. The tint is the category's
 * own, taken from the middle of the gradient its cards already use, so the map
 * reads as part of the site rather than as an embed with dots on it. Colour
 * groups loosely — sea for landmarks and culture, warm for food and shopping —
 * and the icon inside says precisely which, exactly as a real map does it.
 */

/** Category tint, dark enough to carry a white glyph at 3:1. */
const TONE: Record<CategoryId, string> = {
  landmarks: "bg-sea-600",
  culture: "bg-sea-800",
  restaurants: "bg-coral-700",
  fastfood: "bg-sun-700",
  shopping: "bg-sun-800",
  coffee: "bg-sand-700",
  outdoors: "bg-palm-600",
  family: "bg-palm-700",
};

/** Matching ring for the halo around an active pin. */
const RING: Record<CategoryId, string> = {
  landmarks: "bg-sea-600/30",
  culture: "bg-sea-800/30",
  restaurants: "bg-coral-700/30",
  fastfood: "bg-sun-700/30",
  shopping: "bg-sun-800/30",
  coffee: "bg-sand-700/30",
  outdoors: "bg-palm-600/30",
  family: "bg-palm-700/30",
};

/** True when hovering tells this visitor nothing — so a tap has to. */
export function useHoverless(): boolean {
  const [hoverless, setHoverless] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: none)");
    const sync = () => setHoverless(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return hoverless;
}

export default function MapPin({
  place,
  active,
  onActive,
  size = 32,
  dim = false,
  align = "center",
  below = false,
  style,
}: {
  place: Place;
  active: boolean;
  onActive: (slug: string | null) => void;
  /** Diameter in px. Kept in step with the spreading, which reserves this. */
  size?: number;
  /** A neighbour rather than the subject of the page: present, not competing. */
  dim?: boolean;
  /**
   * Which way the callout opens. The frame clips its overflow so the map's
   * rounded corners hold, which means a centred callout on a pin near an edge
   * loses half of itself — the half with the name on it. The parent knows
   * where in the frame the pin landed, so it decides.
   */
  align?: "start" | "center" | "end";
  /** Open downwards, for a pin close enough to the top to be clipped upwards. */
  below?: boolean;
  style?: React.CSSProperties;
}) {
  const hoverless = useHoverless();
  /**
   * Whether this pin was already selected when the finger went down.
   *
   * Checking `active` inside the click handler does not work, and the first
   * version of this did exactly that. Tapping a link makes a browser fire a
   * *synthetic* mouseenter before the click, for compatibility with pages
   * written for mice — so the pin selected itself microseconds earlier, the
   * "is it already selected?" test passed, and the first tap navigated away
   * just as it always had. On a real phone as much as in the test.
   *
   * pointerdown lands before that synthetic hover, so it is the only place
   * that can still see the truth.
   */
  const selectedOnPress = useRef(false);

  return (
    <span
      style={style}
      className={`absolute -translate-x-1/2 -translate-y-1/2 ${active ? "z-30" : dim ? "z-10" : "z-20"}`}
    >
      {/* The halo sits behind and is the thing that makes the active pin
          findable at a glance on a busy frame. It never intercepts a tap. */}
      {active && (
        <span
          aria-hidden="true"
          style={{ width: size * 2, height: size * 2 }}
          className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full motion-reduce:animate-none ${RING[place.category]}`}
        />
      )}

      <Link
        href={`/places/${place.slug}`}
        onMouseEnter={() => onActive(place.slug)}
        onMouseLeave={() => onActive(null)}
        onFocus={() => onActive(place.slug)}
        onBlur={() => onActive(null)}
        onPointerDown={() => { selectedOnPress.current = active; }}
        onClick={(e) => {
          // First tap selects, second opens — but only where hovering could not
          // have selected it already, and only for a real pointer: a click from
          // the keyboard reports detail 0, and someone tabbing to a pin and
          // pressing Enter means to open it, not to look at it.
          if (hoverless && e.detail > 0 && !selectedOnPress.current) {
            e.preventDefault();
            onActive(place.slug);
          }
        }}
        aria-label={`${place.nameAr} — ${place.areaAr}`}
        aria-current={active ? "true" : undefined}
        style={{ width: size, height: size }}
        className={`relative grid place-items-center rounded-full border-2 border-white text-white shadow-md ring-1 ring-ink-900/10 transition duration-200 hover:scale-110 focus-visible:scale-110 ${
          TONE[place.category]
        } ${active ? "scale-110 shadow-xl" : dim ? "opacity-80" : ""}`}
      >
        <PlaceIcon slug={place.slug} className={size >= 32 ? "size-5" : "size-4"} />
      </Link>

      {/* The callout. On a phone this is the whole reason the first tap does
          not navigate: it carries the name, the area and the rating, and it is
          itself the way in — so the second tap has somewhere obvious to land. */}
      <span
        className={`pointer-events-none absolute transition duration-200 ${
          below ? "top-full mt-2" : "bottom-full mb-2"
        } ${
          align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2"
        } ${active ? "opacity-100" : "translate-y-1 opacity-0"}`}
      >
        <span className="flex items-center gap-2 whitespace-nowrap rounded-xl bg-ink-900/95 px-2.5 py-1.5 text-white shadow-xl backdrop-blur-sm">
          <span className="flex flex-col items-start leading-tight">
            <span className="text-2xs font-semibold">{place.nameAr}</span>
            <span className="text-2xs text-sand-300">{place.areaAr}</span>
          </span>
          {place.rating !== undefined && (
            <span className="flex items-center gap-0.5 rounded-full bg-white/15 px-1.5 py-0.5 text-2xs font-semibold">
              <IconStar className="size-3 text-sun-300" />
              {toArabicDigits(place.rating.toFixed(1)).replace(".", "٫")}
            </span>
          )}
          <IconGo className="size-3.5 shrink-0 text-sand-300" />
        </span>
        {/* The little nose that ties the callout to its pin. */}
        <span
          aria-hidden="true"
          className={`absolute size-2 rotate-45 rounded-[2px] bg-ink-900/95 ${
            below ? "bottom-full translate-y-1/2" : "top-full -translate-y-1/2"
          } ${
            align === "start" ? "left-3" : align === "end" ? "right-3" : "left-1/2 -translate-x-1/2"
          }`}
        />
      </span>
    </span>
  );
}
