import type { CategoryId } from "@/lib/places";

/**
 * Composition per variant, so places sharing a category's scene still get
 * their own image: as drawn, mirrored, panned, or mirrored-and-panned.
 * Pure transforms — the scenes contain no text, so mirroring is safe.
 */
const VARIANT_TRANSFORM = [
  undefined,
  "translate(400 0) scale(-1 1)",
  "translate(-26 0)",
  "translate(426 0) scale(-1 1)",
] as const;

/**
 * Illustrated header art for place cards and detail heroes.
 * One hand-drawn duotone scene per category, rendered in white over the
 * category's brand gradient — vector, so it stays sharp at any density.
 * `variant` (from placeVariant) recomposes the scene per place.
 */
export default function CategoryArt({
  category,
  variant = 0,
  className = "",
}: {
  category: CategoryId;
  variant?: 0 | 1 | 2 | 3;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 400 160"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* A soft shadow cast down-right, matching the elevation shadows'
          overhead light. Without it the white strokes read as cut into the
          gradient; with it the scene sits on top of it. */}
      <g
        transform={VARIANT_TRANSFORM[variant]}
        style={{ filter: "drop-shadow(0 1.5px 2px rgb(20 18 15 / 0.28))" }}
      >
        <Scene category={category} />
      </g>
    </svg>
  );
}

function Scene({ category }: { category: CategoryId }) {
  switch (category) {
    case "landmarks":
      return (
        <g stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <circle cx="330" cy="42" r="24" fill="#ffffff" opacity="0.25" stroke="none" />
          {/* main tower */}
          <path d="M186 160 194 66M214 160 206 66" />
          <path d="M200 20v26" />
          <circle cx="200" cy="58" r="21" fill="#ffffff" fillOpacity="0.22" />
          <circle cx="200" cy="27" r="9" fill="#ffffff" fillOpacity="0.22" />
          {/* second tower */}
          <path d="M258 160 263 92M281 160 276 92" />
          <path d="M269.5 60v18" />
          <circle cx="269.5" cy="86" r="13" fill="#ffffff" fillOpacity="0.22" />
          {/* spire */}
          <path d="M132 160 138 74M150 160 144 74M141 74V44" />
          {/* birds */}
          <path d="M64 46q6-6 12 0M84 34q5-5 10 0" strokeWidth="2.5" />
          <path d="M40 160h320" opacity="0.5" />
        </g>
      );
    case "restaurants":
      return (
        <g stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          {/* cloche */}
          <path d="M130 96a70 42 0 0 1 140 0Z" fill="#ffffff" fillOpacity="0.2" />
          <path d="M196 50c0-4 3-7 4-7s4 3 4 7" />
          <path d="M110 106h180" strokeWidth="4.5" />
          <path d="M132 120h136" opacity="0.55" />
          {/* steam */}
          <path d="M172 30c-3-6 3-9 0-15M200 26c-3-6 3-9 0-15M228 30c-3-6 3-9 0-15" strokeWidth="2.6" opacity="0.8" />
          {/* cutlery */}
          <path d="M70 58v40M62 58v12a8 8 0 0 0 16 0V58" strokeWidth="3" />
          <path d="M330 58c-7 5-10 12-10 20 0 6 4 10 10 11v9" strokeWidth="3" />
        </g>
      );
    case "fastfood":
      return (
        <g stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          {/* burger */}
          <path d="M142 74c0-18 26-30 58-30s58 12 58 30Z" fill="#ffffff" fillOpacity="0.2" />
          <path d="M136 88h128" strokeWidth="4.5" />
          <path d="M142 104h116c0 12-10 20-22 20h-72c-12 0-22-8-22-20Z" fill="#ffffff" fillOpacity="0.12" />
          <path d="M168 60h.01M200 56h.01M232 60h.01" strokeWidth="4" />
          {/* fries */}
          <path d="M64 92l6-34M78 90l2-32M92 92l-2-34" strokeWidth="3" />
          <path d="M56 90h44l-5 34H61Z" fill="#ffffff" fillOpacity="0.16" />
          {/* drink */}
          <path d="M312 64h40l-6 60h-28Z" fill="#ffffff" fillOpacity="0.16" />
          <path d="M330 64l6-22" strokeWidth="3" />
        </g>
      );
    case "coffee":
      return (
        <g stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          {/* dallah */}
          <path
            d="M182 62h36l8 56a12 12 0 0 1-12 14h-28a12 12 0 0 1-12-14Z"
            fill="#ffffff"
            fillOpacity="0.18"
          />
          <path d="M184 62 176 46h48l-8 16" />
          <path d="M194 34h12" />
          <path d="M200 34v-8" />
          <path d="M226 78c11 2 18 8 18 16 0 7-5 12-13 15" />
          <path d="M172 76c-9-4-14-11-14-19" />
          {/* cups */}
          <path d="M96 106h30v10a15 15 0 0 1-30 0Z" fill="#ffffff" fillOpacity="0.2" />
          <path d="M300 106h30v10a15 15 0 0 1-30 0Z" fill="#ffffff" fillOpacity="0.2" />
          {/* steam */}
          <path d="M106 92c-2-5 2-7 0-12M116 92c-2-5 2-7 0-12M310 92c-2-5 2-7 0-12M320 92c-2-5 2-7 0-12" strokeWidth="2.4" opacity="0.8" />
        </g>
      );
    case "outdoors":
      return (
        <g stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <circle cx="300" cy="44" r="22" fill="#ffffff" fillOpacity="0.25" />
          <path d="M300 10v-2M300 80v-2M266 44h-2M336 44h-2M276 20l-1.5-1.5M325.5 68.5 324 67M324 20l1.5-1.5M274.5 68.5 276 67" strokeWidth="2.6" />
          {/* palm */}
          <path d="M132 128c2-26 5-44 9-56" />
          <path d="M141 72c-13-7-27-4-35 7 12-2 24-3 35-1Z" fill="#ffffff" fillOpacity="0.2" />
          <path d="M141 72c13-8 28-5 35 6-12-2-24-2-35-1Z" fill="#ffffff" fillOpacity="0.2" />
          <path d="M141 72c-6-13-18-19-32-17 11 6 21 12 28 20Z" fill="#ffffff" fillOpacity="0.2" />
          <path d="M141 72c8-12 21-16 34-12-12 5-22 10-29 16Z" fill="#ffffff" fillOpacity="0.2" />
          {/* waves */}
          <path d="M40 132c14 0 14 9 27 9s14-9 27-9 14 9 27 9 14-9 27-9 14 9 27 9 14-9 27-9 14 9 27 9 14-9 27-9 14 9 27 9 14-9 27-9" strokeWidth="3" opacity="0.85" />
          <path d="M60 152c14 0 14 8 27 8s14-8 27-8 14 8 27 8 14-8 27-8 14 8 27 8 14-8 27-8 14 8 27 8 14-8 27-8" strokeWidth="3" opacity="0.4" />
        </g>
      );
    case "shopping":
      return (
        <g stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          {/* big bag */}
          <path d="M156 66h88l7 62a10 10 0 0 1-10 11h-82a10 10 0 0 1-10-11Z" fill="#ffffff" fillOpacity="0.18" />
          <path d="M178 82V56a22 22 0 0 1 44 0v26" />
          {/* small bag */}
          <path d="M92 92h52l4 38a8 8 0 0 1-8 9H96a8 8 0 0 1-8-9Z" fill="#ffffff" fillOpacity="0.12" />
          <path d="M104 102V88a14 14 0 0 1 28 0v14" strokeWidth="3" />
          {/* tag */}
          <path d="m296 62 42 10-8 44-36-8a10 10 0 0 1-8-12l4-26a8 8 0 0 1 6-8Z" fill="#ffffff" fillOpacity="0.16" />
          <circle cx="304" cy="76" r="4" />
        </g>
      );
    case "culture":
      return (
        <g stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          {/* dome */}
          <path d="M200 26c2 16 22 24 22 44H178c0-20 20-28 22-44Z" fill="#ffffff" fillOpacity="0.2" />
          <path d="M200 26v-8" />
          <path d="M160 160V92a40 24 0 0 1 80 0v68" />
          {/* arches */}
          <path d="M120 160v-36a14 14 0 0 1 28 0v36M252 160v-36a14 14 0 0 1 28 0v36" fill="#ffffff" fillOpacity="0.12" />
          {/* minaret */}
          <path d="M78 160V70" />
          <path d="M70 70h16l-8-20Z" fill="#ffffff" fillOpacity="0.22" />
          <path d="M322 160V70" />
          <path d="M314 70h16l-8-20Z" fill="#ffffff" fillOpacity="0.22" />
        </g>
      );
    case "family":
      return (
        <g stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          {/* ferris wheel */}
          <circle cx="200" cy="76" r="52" fill="#ffffff" fillOpacity="0.08" />
          <circle cx="200" cy="76" r="52" />
          <circle cx="200" cy="76" r="9" fill="#ffffff" fillOpacity="0.25" />
          <path d="M200 24v104M148 76h104M163 39l74 74M237 39l-74 74" strokeWidth="2.6" />
          <path d="M176 158h48l-24-40Z" fill="#ffffff" fillOpacity="0.18" />
          {/* balloon */}
          <path d="M318 52a16 20 0 1 1 .01 0Z" fill="#ffffff" fillOpacity="0.22" />
          <path d="M318 72c-2 10 3 14 0 24" strokeWidth="2.4" />
        </g>
      );
    default:
      return null;
  }
}
