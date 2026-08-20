/**
 * Hero art for the places that are famous enough to be recognised by outline.
 *
 * The hero used to draw the CATEGORY's scene, which meant the four most
 * distinctive buildings in the country — the Grand Mosque, JACC, the Mirror
 * House and the Tareq Rajab Museum — arrived on their own pages sharing one
 * picture. A two-hundred-year-old souq and the largest mall in the Gulf got
 * the same drawing of shopping bags. Meanwhile the 20px icon on the card was
 * already place-specific, so the small art said more than the large art.
 *
 * These are per place. Anything without one here still falls back to its
 * category scene, which is the right answer for a place whose identity IS its
 * category — a restaurant is a restaurant.
 *
 * ---------------------------------------------------------------------------
 * THE SAFE BOX — measured, not assumed.
 *
 * The frame is `preserveAspectRatio="slice"`, so the 400×160 viewBox is
 * cropped to fill, and it crops on a DIFFERENT AXIS at each breakpoint:
 *
 *   desktop  848×256 hero  →  only y 20–140 survives (top and bottom cut)
 *   mobile   358×224 hero  →  only x 72–328 survives (both sides cut)
 *
 * So everything that must be seen lives inside x 78–322, y 26–136. A ground
 * line at y 160 or sea at y 150 — the obvious places to put them — is simply
 * invisible on a desktop hero. Hence BASE at 134.
 * ---------------------------------------------------------------------------
 *
 * Same drawing language as CategoryArt so the two sit together: white strokes
 * at 3.5, round caps and joins, translucent white for mass.
 */

import type { Place } from "@/lib/places";

const S = {
  stroke: "#fff",
  strokeWidth: 3.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  fill: "none",
};
/** Translucent white reads as mass without competing with the strokes. */
const MASS = { fill: "#ffffff", fillOpacity: 0.2 } as const;
const MASS_SOFT = { fill: "#ffffff", fillOpacity: 0.12 } as const;

/** The line everything stands on — inside the desktop crop, unlike y 160. */
const BASE = <path d="M84 134h232" strokeWidth={4.5} />;

/** Water, kept above y 136 so a desktop hero still shows it. */
const SEA = (
  <>
    <path d="M84 122q14-7 28 0t28 0 28 0 28 0 28 0 28 0 28 0 28 0" opacity={0.7} strokeWidth={2.8} />
    <path d="M96 133q14-7 28 0t28 0 28 0 28 0 28 0 28 0 28 0" opacity={0.42} strokeWidth={2.6} />
  </>
);

export function hasPlaceArt(slug: string): boolean {
  return slug in SCENES;
}

const SCENES: Record<string, React.ReactElement> = {
  // Dome, arcade beneath it, a minaret each side.
  "grand-mosque": (
    <g {...S}>
      <path d="M158 130V98a42 40 0 0 1 84 0v32Z" {...MASS} />
      <path d="M200 60c-13 9-20 22-20 38h40c0-16-7-29-20-38Z" {...MASS_SOFT} />
      <path d="M200 60V50" />
      <path d="M197 44a6 6 0 1 0 6 5" strokeWidth={2.6} />
      <path d="M170 130v-18a10 10 0 0 1 20 0v18M210 130v-18a10 10 0 0 1 20 0v18" opacity={0.9} />
      {/* minarets, standing on the same base */}
      <path d="M116 130V76M130 130V76M123 76V60" />
      <path d="M113 76h20" />
      <path d="M120 54a5 5 0 1 0 5 4" strokeWidth={2.4} />
      <path d="M270 130V76M284 130V76M277 76V60" />
      <path d="M267 76h20" />
      <path d="M274 54a5 5 0 1 0 5 4" strokeWidth={2.4} />
      {BASE}
    </g>
  ),

  // The cultural centre: its ribbed shells, stepping down.
  jacc: (
    <g {...S}>
      <path d="M96 130c0-36 26-58 56-58s56 22 56 58Z" {...MASS} />
      <path d="M122 130c0-26 16-44 34-44" opacity={0.7} />
      <path d="M148 130c0-20 10-34 22-36" opacity={0.5} />
      <path d="M216 130c0-25 18-42 40-42s40 17 40 42Z" {...MASS_SOFT} />
      <path d="M238 130c0-18 10-30 22-30" opacity={0.55} />
      {BASE}
    </g>
  ),

  // A house whose entire facade is mirror mosaic.
  "mirror-house": (
    <g {...S}>
      <path d="M128 130V80l72-30 72 30v50Z" {...MASS} />
      <path d="M120 82 200 48l80 34" strokeWidth={4} />
      <g strokeWidth={2.3} opacity={0.85}>
        <path d="M152 130V88M176 130V78M200 130V72M224 130V78M248 130V88" />
        <path d="M136 100h128M136 116h128" />
      </g>
      <path d="M188 130v-22a12 12 0 0 1 24 0v22Z" {...MASS_SOFT} />
      <path d="M158 94l6-6M240 106l6-6M198 84l5-5" strokeWidth={2.6} opacity={0.9} />
      {BASE}
    </g>
  ),

  // Museum: an arched vitrine holding a piece, a reed pen beside it.
  "tareq-rajab-museum": (
    <g {...S}>
      <path d="M142 130V92a58 42 0 0 1 116 0v38Z" {...MASS} />
      <path d="M166 130V96a34 26 0 0 1 68 0v34Z" {...MASS_SOFT} />
      <path d="M184 128v-20a16 16 0 0 1 32 0v20Z" {...MASS} />
      <path d="M195 90h10l-2 8h-6Z" />
      <path d="M200 82v8" strokeWidth={2.6} />
      <path d="M180 128h40" strokeWidth={3.5} />
      <path d="M298 84l-20 34" strokeWidth={3} />
      <path d="M278 118l-5 11 11-5Z" {...MASS} />
      <path d="M286 130q12-9 24 0" strokeWidth={2.6} opacity={0.8} />
      <path d="M92 130q11-8 22 0" strokeWidth={2.6} opacity={0.55} />
      {BASE}
    </g>
  ),

  // The old souq: a low colonnade under a roof beam, lanterns hung from it.
  "souq-al-mubarakiya": (
    <g {...S}>
      <path d="M92 130V96q0-16 16-16t16 16v34Z" {...MASS} />
      <path d="M140 130V96q0-16 16-16t16 16v34Z" {...MASS} />
      <path d="M188 130V96q0-16 16-16t16 16v34Z" {...MASS} />
      <path d="M236 130V96q0-16 16-16t16 16v34Z" {...MASS} />
      <path d="M284 130V96q0-16 16-16t16 16v34Z" {...MASS} />
      {/* roof beam sits ABOVE the arches, not across them */}
      <path d="M84 74h232" strokeWidth={4.5} />
      <path d="M92 74l8-12h200l8 12" {...MASS_SOFT} />
      {/* lanterns: cap, body, finial — hung below the beam */}
      <g strokeWidth={2.8}>
        <path d="M130 74v8M126 82h8l3 14h-14Z" {...MASS_SOFT} />
        <path d="M130 96v4" />
        <path d="M270 74v8M266 82h8l3 14h-14Z" {...MASS_SOFT} />
        <path d="M270 96v4" />
      </g>
      {BASE}
    </g>
  ),

  // The mall: one grand vault with skylight ribs over a run of shopfronts.
  "the-avenues": (
    <g {...S}>
      <path d="M88 130V92a112 40 0 0 1 224 0v38Z" {...MASS} />
      <g strokeWidth={2.5} opacity={0.8}>
        <path d="M124 130V68M162 130V58M200 130V55M238 130V58M276 130V68" />
      </g>
      <path d="M88 102h224" opacity={0.5} />
      <path d="M112 130v-20h44v20ZM178 130v-20h44v20ZM244 130v-20h44v20Z" {...MASS_SOFT} />
      {BASE}
    </g>
  ),

  // Waterfront mall: masts over a low roofline, on the marina.
  "souq-sharq": (
    <g {...S}>
      <path d="M108 116V88h184v28Z" {...MASS} />
      <path d="M108 88l24-20h136l24 20" {...MASS_SOFT} />
      <path d="M152 88V38M152 44l24 28h-24Z" {...MASS} />
      <path d="M244 88V50M244 56l20 24h-20Z" {...MASS_SOFT} />
      <path d="M100 116h200" strokeWidth={4.5} />
      {SEA}
    </g>
  ),

  // The island: Hellenistic columns standing ON the shore, ferry offshore.
  "failaka-island": (
    <g {...S}>
      <path d="M96 116h208q-18-14-52-17t-56 2-50 5-50 10Z" {...MASS} />
      {/* colonnade, feet on the shore line */}
      <path d="M140 108V64M158 108V64M176 108V68M206 108V62M224 108V72" />
      <path d="M132 64h52M198 62h34" strokeWidth={3} />
      <path d="M128 58h60l-6-8h-48Z" {...MASS_SOFT} />
      <path d="M194 56h42l-5-8h-32Z" {...MASS_SOFT} />
      {/* ferry, kept inside the mobile crop */}
      <path d="M256 106h44l-7 12h-30Z" {...MASS} />
      <path d="M272 106V88h18v18" {...MASS_SOFT} />
      <path d="M279 88V78" strokeWidth={2.6} />
      {SEA}
    </g>
  ),

  // The park: a green rise, the lake, a path around it.
  "al-shaheed-park": (
    <g {...S}>
      <path d="M84 130q38-38 92-38t72 22 68 16v16Z" {...MASS_SOFT} />
      <path d="M132 118V100M132 100a15 15 0 1 1 .1 0Z" {...MASS} />
      <path d="M176 122V106M176 106a12 12 0 1 1 .1 0Z" {...MASS} />
      <path d="M272 120V102M272 102a14 14 0 1 1 .1 0Z" {...MASS} />
      <path d="M190 130q34-14 78 0-34 12-78 0Z" {...MASS} />
      <path d="M208 130q15-5 30 0" opacity={0.5} strokeWidth={2.3} />
      <path d="M90 128q50-20 100-13" opacity={0.55} strokeWidth={2.6} />
      {BASE}
    </g>
  ),

  // The crescent: shoreline, parasols, a moored boat.
  "marina-beach": (
    <g {...S}>
      <path d="M84 112q56-26 116-26t116 26" {...MASS_SOFT} />
      <path d="M132 110V80M116 80q16-16 32 0Z" {...MASS} />
      <path d="M194 108V78M178 78q16-16 32 0Z" {...MASS} />
      <path d="M250 104h48l-9 12h-30Z" {...MASS} />
      <path d="M272 104V76l20 24h-20" {...MASS_SOFT} />
      {SEA}
    </g>
  ),

  // Man-made island: a causeway out to the viewing tower.
  "green-island": (
    <g {...S}>
      <path d="M128 116q0-22 42-22t42 22Z" {...MASS} />
      <path d="M228 116q0-16 32-16t32 16Z" {...MASS_SOFT} />
      <path d="M170 94V54M170 54l-13 13h26Z" {...MASS} />
      <path d="M162 94h16" strokeWidth={3} />
      <path d="M256 100V78M256 78q-13-9-19 2M256 78q13-9 19 2M256 78q-4-13 6-17" strokeWidth={2.8} />
      <path d="M88 116h40" strokeWidth={4} opacity={0.75} />
      <path d="M212 116h16" strokeWidth={4} opacity={0.75} />
      {SEA}
    </g>
  ),

  // Water park: the slide is the whole silhouette.
  "aqua-park": (
    <g {...S}>
      <path d="M118 130V78a24 24 0 0 1 48 0v8" {...MASS_SOFT} />
      <path d="M166 86q38 6 48 28t52 20" strokeWidth={4} />
      <path d="M153 86q37 10 47 32t56 16" opacity={0.6} strokeWidth={2.8} />
      <g strokeWidth={2.3} opacity={0.8}>
        <path d="M128 118h28M128 104h28M128 90h28" />
      </g>
      <path d="M228 130q26-11 88 0-38 11-88 0Z" {...MASS} />
      <path d="M246 130q19-5 42 0" opacity={0.5} strokeWidth={2.3} />
      <path d="M262 120l-5-9M276 118l2-11M290 122l7-7" strokeWidth={2.6} opacity={0.85} />
      {BASE}
    </g>
  ),
};

export default function PlaceArt({
  place,
  className = "",
}: {
  place: Pick<Place, "slug">;
  className?: string;
}) {
  const scene = SCENES[place.slug];
  if (!scene) return null;
  return (
    <svg
      viewBox="0 0 400 160"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* The same soft cast CategoryArt uses, so the white strokes sit on the
          ground rather than looking cut into it. */}
      <g style={{ filter: "drop-shadow(0 1.5px 2px rgb(20 18 15 / 0.28))" }}>{scene}</g>
    </svg>
  );
}
