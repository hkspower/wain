/**
 * The game's icons, drawn.
 *
 * They used to be emoji — 🏁 on START ENGINE, 🔧 on GARAGE, 🎮 on HOW TO
 * PLAY. An emoji is not an icon: it is a small full-colour cartoon,
 * rendered by whichever font the operating system happens to supply, at
 * whatever weight and palette that vendor chose. Five of them down the
 * left of a menu set in condensed italic caps on near-black was the one
 * thing in this UI that looked like a toy, and it looked like a
 * different toy on every machine.
 *
 * These are line art on a 24-unit grid: one stroke weight, round caps,
 * `currentColor` so each icon takes the colour of the row it sits in and
 * changes with it on hover and selection. That is what makes them read
 * as instrumentation rather than decoration — the same reason a car's
 * switchgear is engraved in one weight and lit in one colour rather than
 * printed in five.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 22, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/**
 * The chequered flag.
 *
 * Two filled quarters on a plain rectangle rather than a waving pennant
 * with fine squares in it. The chequer is the whole point of the icon
 * and it has to survive at 22 px — the first version put four small
 * squares inside a curved flag and at menu size it read as a blank
 * pennant on a stick.
 */
export const IconFlag = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 21V3.4" />
    <rect x="5" y="4.2" width="13" height="9" />
    <path d="M5 4.2h6.5v4.5H5zM11.5 8.7H18v4.5h-6.5z" fill="currentColor" stroke="none" />
  </Svg>
);

/** Combination spanner — the garage. */
export const IconWrench = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.5 4.2a4.4 4.4 0 0 0-5.2 5.6L4 16.1a1.9 1.9 0 0 0 2.7 2.7l6.3-6.3a4.4 4.4 0 0 0 5.6-5.2l-2.7 2.7-2.4-.6-.6-2.4z" />
  </Svg>
);

/**
 * Settings: three sliders on a console.
 *
 * A cog drawn as a small circle with radial ticks reads as a sunburst at
 * menu size, which is what the first attempt did. Sliders say the same
 * thing without ambiguity, and they look like the equipment this game is
 * about rather than like clockwork.
 */
export const IconGear = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.6 7h9.6M18.4 7h2M3.6 12h3.2M12 12h8.4M3.6 17h8M17.2 17h3.2" />
    <circle cx="15.6" cy="7" r="2.1" />
    <circle cx="9.4" cy="12" r="2.1" />
    <circle cx="14.6" cy="17" r="2.1" />
  </Svg>
);

/** Controller — how to play. */
export const IconPad = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.4 7.5h9.2a4.6 4.6 0 0 1 4.5 3.7l.7 4.1a2.6 2.6 0 0 1-4.7 1.9l-1.5-2.1H8.4l-1.5 2.1a2.6 2.6 0 0 1-4.7-1.9l.7-4.1a4.6 4.6 0 0 1 4.5-3.7z" />
    <path d="M6.6 11.4v2.2M5.5 12.5h2.2M16.2 11.6h.01M18.4 13.4h.01" />
  </Svg>
);

/** Star — the credits. Struck, not sparkling. */
export const IconStar = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.4l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z" />
  </Svg>
);

/** The showroom: a car in profile. */
export const IconCar = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 14.6v2.6h2.2M21 14.6v2.6h-2.2" />
    <path d="M3 14.6l1.5-4.2A2.6 2.6 0 0 1 7 8.6h10a2.6 2.6 0 0 1 2.5 1.8l1.5 4.2z" />
    <circle cx="7.2" cy="17.2" r="1.9" />
    <circle cx="16.8" cy="17.2" r="1.9" />
    <path d="M6.6 11.9h10.8" />
  </Svg>
);

/** Style: the paint gun. */
export const IconPaint = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.8 4.2h6.4v4.6H9.8zM12 8.8v2.4M8.2 11.2h7.6v8.6H8.2z" />
    <path d="M18.4 5.2h2.4M18.4 7.5h2.4" />
  </Svg>
);

/** Crown — champion. One line, five points, no jewels. */
export const IconCrown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.4 7.6l3.1 3.4L12 4.6l5.5 6.4 3.1-3.4-1.4 11H4.8z" />
    <path d="M4.8 18.6h14.4" />
  </Svg>
);

/** Headlight flash — the challenge. A lamp throwing a beam. */
export const IconFlash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.2 9.2h4.1a5 5 0 0 1 4.6 3l.5 1.2a1.4 1.4 0 0 1-1.3 1.9H4.2z" />
    <path d="M15.6 8.2l3.4-2.1M16.6 12h4M15.6 15.8l3.4 2.1" />
  </Svg>
);


/** Key — something unlocked. */
export const IconKey = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8.4" r="3.8" />
    <path d="M10.7 11.1L20 20.4M17.4 17.8l1.9-1.9M14.9 15.3l1.9-1.9" />
  </Svg>
);

/** A run of wins: chevrons stacked, climbing. A flame here would be a
 *  cartoon; this is the shape a streak actually has. */
export const IconStreak = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 15.2l7-5.4 7 5.4M5 19.4l7-5.4 7 5.4M5 11l7-5.4 7 5.4" />
  </Svg>
);

/**
 * The flag of Kuwait, drawn.
 *
 * Three bands and the black trapezoid at the hoist. As an emoji this was
 * a regional-indicator pair, which is a picture supplied by the platform
 * — Apple draws it one way, Windows refuses to draw national flags at
 * all and falls back to the letters "KW". Drawn here, it is the same
 * flag on every machine.
 */
export const IconFlagKW = ({ size = 18, ...rest }: IconProps) => (
  <svg
    width={(size * 4) / 3}
    height={size}
    viewBox="0 0 24 18"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <rect x="0" y="0" width="24" height="6" fill="#007a3d" />
    <rect x="0" y="6" width="24" height="6" fill="#f4f4f2" />
    <rect x="0" y="12" width="24" height="6" fill="#ce1126" />
    <path d="M0 0h8.4L6 6v6l2.4 6H0z" fill="#0b0b0d" />
    <rect x="0" y="0" width="24" height="18" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="0.9" />
  </svg>
);

export const ICONS = {
  flag: IconFlag,
  wrench: IconWrench,
  gear: IconGear,
  pad: IconPad,
  star: IconStar,
  car: IconCar,
  paint: IconPaint,
  crown: IconCrown,
  flash: IconFlash,
  key: IconKey,
  streak: IconStreak,
} as const;

export type IconName = keyof typeof ICONS;
