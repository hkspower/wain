import type { CSSProperties, SVGProps } from "react";
import CategoryIcon from "@/components/CategoryIcon";
import { getCategory, places } from "@/lib/places";

/**
 * One bespoke line icon per place.
 *
 * Drawn on a 48×48 grid — double the 24 grid the UI icon set uses — so each
 * mark carries real architectural detail (the towers' three spheres, the wind
 * tower on a Freej courtyard house, the arcade roof of the Avenues) and stays
 * exact when a card renders it at 100px+.
 *
 * Every icon is a single colour: stroke and fill both inherit currentColor, so
 * one class on the parent sets the whole set. Shared geometry — a size-aware
 * stroke (see below), round caps and joins, a common 4px margin and a 40px
 * baseline — keeps seventeen different subjects reading as one family.
 */
type Props = SVGProps<SVGSVGElement> & { slug: string; className?: string };

const S = {
  viewBox: "0 0 48 48",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/**
 * Optical stroke weight.
 *
 * Stroke width is in viewBox units, so a fixed value means the rendered
 * weight is a fixed *fraction* of the display size. The UI set draws 1.8 on a
 * 24 grid — 0.075 of the size. This set drew 2.4 on a 48 grid — 0.050. Same
 * apparent size, two-thirds the weight: at size-4 the marks came out 0.80
 * device pixels against 1.20 for every icon beside them, which is a hairline,
 * not a light touch. In a search result row that put a starved mark next to a
 * normal one.
 *
 * So the weight follows the size instead of being constant. Small marks match
 * the UI family exactly; the weight eases off as the mark grows, which is what
 * optical sizing means and keeps the 80px hero at the 2.4 it was drawn for.
 */
const HERO_PX = 80;
const SMALL_PX = 16;

/** Tailwind `size-N` is N × 4px. */
function renderedPx(className: string): number {
  const m = /(?:^|[\s:])size-(\d+(?:\.\d+)?)(?:\s|$)/.exec(className);
  return m ? parseFloat(m[1]) * 4 : 40;
}

function strokeFor(px: number): number {
  const t = Math.min(1, Math.max(0, (px - SMALL_PX) / (HERO_PX - SMALL_PX)));
  // 3.6 == 0.075 × 48, the UI family's ratio. 2.4 is the hero's drawn weight.
  return +(3.6 - t * 1.2).toFixed(3);
}

/**
 * Secondary detail lines sit at 2.2/2.4 of the main weight, at every size.
 * Presentation attributes can't resolve var(), so these ride on `style`.
 */
const DETAIL_RATIO = 2.2 / 2.4;
const DETAIL = { strokeWidth: "var(--w2)" } as const;

/** Soft tint used for volumes, so the marks read as objects not wireframes. */
const F = { fill: "currentColor", fillOpacity: 0.14, stroke: "none" } as const;

const GROUND = <path d="M6 40h36" opacity={0.45} />;

function Art({ slug }: { slug: string }) {
  switch (slug) {
    /* أبراج الكويت — the three tapered towers and their spheres */
    case "kuwait-towers":
      return (
        <>
          <circle {...F} cx="20" cy="17" r="7" />
          <circle cx="20" cy="17" r="7" />
          <circle {...F} cx="20" cy="7.5" r="3" />
          <circle cx="20" cy="7.5" r="3" />
          <path d="M20 10.5V10M17.6 23.6 16 40M22.4 23.6 24 40" />
          <circle {...F} cx="32" cy="27" r="4.4" />
          <circle cx="32" cy="27" r="4.4" />
          <path d="M32 22.6V19M30.5 31.2 29.5 40M33.5 31.2 34.5 40" />
          <path d="M10 40l1.5-13M14.5 40 13 27M12.25 27v-4" />
          {GROUND}
        </>
      );

    /* سوق المباركية — arcade of shop arches with a hanging lamp */
    case "souq-al-mubarakiya":
      return (
        <>
          <path {...F} d="M9 40V22a6 6 0 0 1 12 0v18Z" />
          <path d="M9 40V22a6 6 0 0 1 12 0v18" />
          <path {...F} d="M27 40V25a5 5 0 0 1 10 0v15Z" />
          <path d="M27 40V25a5 5 0 0 1 10 0v15" />
          <path d="M6 18h36" />
          <path d="M24 8v4" />
          <path {...F} d="M20.5 18 24 12l3.5 6Z" />
          <path d="M20.5 18 24 12l3.5 6" />
          {GROUND}
        </>
      );

    /* حديقة الشهيد — layered canopy over the park path */
    case "al-shaheed-park":
      return (
        <>
          <path {...F} d="M14 22a11 8 0 0 1 22 0 9 7 0 0 1-3 5H17a9 7 0 0 1-3-5Z" />
          <path d="M14 22a11 8 0 0 1 22 0" />
          <path d="M16 27a10 7 0 0 0 18 0" />
          <path d="M14.5 22h21" opacity={0.5} style={DETAIL} />
          <path d="M25 27v13" />
          <path d="M25 33l-4.5-4M25 36l4.5-4" style={DETAIL} />
          <path {...F} d="M6 30a5 4 0 0 1 10 0 4 3 0 0 1-1.5 2.5h-7A4 3 0 0 1 6 30Z" />
          <path d="M6 30a5 4 0 0 1 10 0" />
          <path d="M7.5 32.5a4.5 3 0 0 0 7 0M11 32.5V40" style={DETAIL} />
          {GROUND}
        </>
      );

    /* ميس الغانم — skewers over the grill */
    case "mais-alghanim":
      return (
        <>
          <path {...F} d="M10 26h28l-2.5 10a4 4 0 0 1-4 3H16.5a4 4 0 0 1-4-3Z" />
          <path d="M10 26h28l-2.5 10a4 4 0 0 1-4 3H16.5a4 4 0 0 1-4-3Z" />
          <path d="M7 26h34" />
          <path d="M17 21V9M24 21V7M31 21V9" style={DETAIL} />
          <circle {...F} cx="17" cy="15" r="2.6" />
          <circle {...F} cx="24" cy="13" r="2.6" />
          <circle {...F} cx="31" cy="15" r="2.6" />
          <circle cx="17" cy="15" r="2.6" style={DETAIL} />
          <circle cx="24" cy="13" r="2.6" style={DETAIL} />
          <circle cx="31" cy="15" r="2.6" style={DETAIL} />
        </>
      );

    /* فريج صويلح — courtyard house with a wind tower */
    case "freej-swaileh":
      return (
        <>
          <path {...F} d="M10 40V21h16v19Z" />
          <path d="M10 40V21h16v19" />
          <path d="M8 21h20" />
          <path {...F} d="M30 40V27h9v13Z" />
          <path d="M30 40V27h9v13" />
          <path d="M28.5 27h12" />
          <path {...F} d="M32 27V14h5v13Z" />
          <path d="M32 27V14h5v13M31 14h7" />
          <path d="M16 40v-8h5v8" />
          <path d="M13 26h2M21 26h2" />
          {GROUND}
        </>
      );

    /* مقاهي المباركية — dallah pouring into a finjan */
    case "mubarakiya-tea-houses":
      return (
        <>
          <path {...F} d="M16 17h12l2.4 17a4 4 0 0 1-4 4.6h-8.8a4 4 0 0 1-4-4.6Z" />
          <path d="M16 17h12l2.4 17a4 4 0 0 1-4 4.6h-8.8a4 4 0 0 1-4-4.6Z" />
          <path d="M16.4 17 14 12h16l-2.4 5" />
          <path d="M20 8h4M22 8V5.5" />
          <path d="M30.4 21.5c3.4.6 5.6 2.5 5.6 5.2 0 2-1.4 3.6-3.8 4.3" />
          <path d="M13.6 21.5C10.6 20.4 9 18.2 9 15.6" />
          <path {...F} d="M34 34h8v3a4 4 0 0 1-8 0Z" />
          <path d="M34 34h8v3a4 4 0 0 1-8 0ZM33 41h10" style={DETAIL} />
        </>
      );

    /* شارع سالم المبارك — shopfronts under street lamps */
    case "salem-al-mubarak-street":
      return (
        <>
          <path {...F} d="M8 40V24h13v16Z" />
          <path d="M8 40V24h13v16" />
          <path {...F} d="M25 40V28h11v12Z" />
          <path d="M25 40V28h11v12" />
          <path d="M6 24h17M23 28h15" />
          <path d="M12 40v-7h5v7" />
          <path d="M41 40V16" />
          <circle {...F} cx="41" cy="12.5" r="3.5" />
          <circle cx="41" cy="12.5" r="3.5" />
          <path d="M28 34h5" style={DETAIL} />
          {GROUND}
        </>
      );

    /* الأفنيوز — barrel-vaulted mall arcade */
    case "the-avenues":
      return (
        <>
          <path {...F} d="M7 22a17 17 0 0 1 34 0v18H7Z" />
          <path d="M7 40V22a17 17 0 0 1 34 0v18" />
          <path d="M7 27h34M16 22.5V40M32 22.5V40" opacity={0.6} style={DETAIL} />
          <path {...F} d="M19 40v-9h10v9Z" />
          <path d="M19 40v-9h10v9" />
          <path d="M24 31v9" style={DETAIL} />
          {GROUND}
        </>
      );

    /* سوق شرق — waterfront mall with a dhow sail */
    case "souq-sharq":
      return (
        <>
          <path {...F} d="M6 32V19h16v13Z" />
          <path d="M6 32V19h16v13" />
          <path d="M4 19h20M10 26h2M16 26h2" />
          <path {...F} d="M28 30 38 12v18Z" />
          <path d="M38 12v18M38 12 28 30h10" />
          <path d="M41 16v14" style={DETAIL} />
          <path d="M4 34c4 0 4 3 8 3s4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" opacity={0.8} />
          <path d="M8 40c4 0 4 2.5 8 2.5" opacity={0} />
          <path d="M4 40c4 0 4 3 8 3s4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" opacity={0.4} />
        </>
      );

    /* المسجد الكبير — dome, arches and minarets */
    case "grand-mosque":
      return (
        <>
          <path {...F} d="M24 9c1.6 8 9 10.5 9 17H15c0-6.5 7.4-9 9-17Z" />
          <path d="M24 9c1.6 8 9 10.5 9 17H15c0-6.5 7.4-9 9-17Z" />
          <path d="M24 9V5.5" />
          <path d="M14 40V31a10 6 0 0 1 20 0v9" />
          <path {...F} d="M19 40v-6a5 5 0 0 1 10 0v6Z" />
          <path d="M19 40v-6a5 5 0 0 1 10 0v6" />
          <path d="M8 40V19M6.5 19h3l-1.5-4Z" />
          <path {...F} d="M6.5 19h3L8 15Z" />
          <path d="M40 40V19M38.5 19h3L40 15Z" />
          <path {...F} d="M38.5 19h3L40 15Z" />
          {GROUND}
        </>
      );

    /* شاطئ المارينا — parasol over the shoreline */
    case "marina-beach":
      return (
        <>
          <path {...F} d="M9 22a13 13 0 0 1 26 0Z" />
          <path d="M9 22a13 13 0 0 1 26 0Z" />
          <path d="M22 22v13" />
          <path d="M22 9V6" />
          <circle {...F} cx="38" cy="12" r="5" />
          <circle cx="38" cy="12" r="5" style={DETAIL} />
          <path d="M4 31c4 0 4 3 8 3s4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" />
          <path d="M4 39c4 0 4 3 8 3s4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" opacity={0.45} />
        </>
      );

    /* مركز الشيخ جابر الثقافي — the overlapping curved shells */
    case "jacc":
      return (
        <>
          <path {...F} d="M5 37c0-9 5-16 12-16s12 7 12 16Z" />
          <path d="M5 37c0-9 5-16 12-16s12 7 12 16" />
          <path {...F} d="M19 37c0-11 6-19 14-19s10 8 10 19Z" />
          <path d="M19 37c0-11 6-19 14-19s10 8 10 19" />
          <path d="M26 22.5V37" opacity={0.5} style={DETAIL} />
          <path d="M33 18v-4" />
          <path d="M17 21v-3" />
          <path d="M4 40h40" opacity={0.45} />
        </>
      );

    /* جزيرة فيلكا — a ruined colonnade on the island */
    case "failaka-island":
      return (
        <>
          <path {...F} d="M11 14h26v-3.5H11Z" />
          <path d="M10 14h20M10 10.5h20" />
          <path d="M14 14v18M22 14v18M30 14v13" />
          <path d="M13 32h3M21 32h3" opacity={0.6} style={DETAIL} />
          <path d="M34 20v12" opacity={0.55} />
          <path {...F} d="M8 32h32v3a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2Z" />
          <path d="M8 32h32" />
          <path d="M4 41c4 0 4 3 8 3s4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" opacity={0.6} />
        </>
      );

    /* بيت المرايا — facetted house catching light */
    case "mirror-house":
      return (
        <>
          <path {...F} d="M10 40V21l14-10 14 10v19Z" />
          <path d="M10 40V21l14-10 14 10v19" />
          <path d="M10 21 24 31l14-10" opacity={0.6} style={DETAIL} />
          <path d="M24 31v9" opacity={0.6} style={DETAIL} />
          <path d="M17 26.5 20 40M31 26.5 28 40" opacity={0.35} style={DETAIL} />
          <path d="M40 8.5 41 6l1 2.5 2.5 1-2.5 1L41 13l-1-2.5-2.5-1Z" />
          {GROUND}
        </>
      );

    /* أكوا بارك — the flume */
    case "aqua-park":
      return (
        <>
          <path d="M12 40V15a5 5 0 0 1 10 0v6" />
          <path {...F} d="M22 21c9 0 9 8 0 8s-9 8 0 8h14v3H22c-13 0-13-11 0-11 4 0 4-5 0-5Z" />
          <path d="M22 21c9 0 9 8 0 8s-9 8 0 8h14" />
          <path d="M9 40h6" />
          <path d="M38 34v6" style={DETAIL} />
          <path d="M4 43c4 0 4 2.5 8 2.5" opacity={0} />
          <path d="M4 41c4 0 4 3 8 3s4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" opacity={0.45} />
        </>
      );

    /* متحف طارق رجب — vitrine holding an Islamic-art vessel */
    case "tareq-rajab-museum":
      return (
        <>
          <path {...F} d="M9 40V14h30v26Z" />
          <path d="M9 40V14h30v26" />
          <path d="M7 14h34M7 40h34" />
          <path d="M24 14V9" />
          <path {...F} d="M19 32c0-4-2-5-2-8a7 7 0 0 1 14 0c0 3-2 4-2 8Z" />
          <path d="M19 32c0-4-2-5-2-8a7 7 0 0 1 14 0c0 3-2 4-2 8" />
          <path d="M18 32h12" style={DETAIL} />
          <path d="M24 20v5M21.5 22.5h5" opacity={0.55} style={DETAIL} />
        </>
      );

    /* الجزيرة الخضراء — planted island ringed by water */
    case "green-island":
      return (
        <>
          <path d="M24 30V17" />
          <path {...F} d="M24 17c-5-4-10-2-11 3 4-1 8-1 11-.4Z" />
          <path d="M24 17c-5-4-10-2-11 3 4-1 8-1 11-.4Z" />
          <path {...F} d="M24 17c5-4 10-2 11 3-4-1-8-1-11-.4Z" />
          <path d="M24 17c5-4 10-2 11 3-4-1-8-1-11-.4Z" />
          <path {...F} d="M24 17c-2-5-6-7-11-6 4 2 8 4 10 6Z" />
          <path d="M24 17c-2-5-6-7-11-6 4 2 8 4 10 6Z" />
          <path {...F} d="M24 17c2-5 7-7 12-5-4 2-8 3-10 5Z" />
          <path d="M24 17c2-5 7-7 12-5-4 2-8 3-10 5Z" />
          <path {...F} d="M9 30h30v3a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2Z" />
          <path d="M9 30h30" />
          <path d="M4 40c4 0 4 3 8 3s4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" opacity={0.6} />
        </>
      );

    /* Fallback: a pin, so a newly added place still gets a mark. */
    default:
      return null;
  }
}

export default function PlaceIcon({ slug, className = "size-10", style, ...rest }: Props) {
  // A place with no drawing of its own shows what kind of place it is. The
  // fallback used to be one generic pin, which was fine while every place had
  // bespoke art — but the moment the catalogue grew past the drawn set, a
  // results list turned into a column of identical pins that told the reader
  // nothing. The category mark at least separates a mosque from a beach.
  if (Art({ slug }) === null) {
    const category = places.find((p) => p.slug === slug)?.category;
    const icon = category ? (getCategory(category)?.icon ?? "all") : "all";
    return <CategoryIcon name={icon} className={className} />;
  }

  const w = strokeFor(renderedPx(className));
  return (
    <svg
      {...S}
      className={className}
      strokeWidth={w}
      style={{ ["--w2"]: +(w * DETAIL_RATIO).toFixed(3), ...style } as CSSProperties}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <Art slug={slug} />
    </svg>
  );
}
