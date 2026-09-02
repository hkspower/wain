/**
 * Wain icon system.
 *
 * Every icon is drawn on a 24px grid with 1.8px rounded strokes and an
 * optional duotone wash (currentColor at 15%), so the whole set reads as one
 * family and stays crisp at any rendering scale.
 *
 * ## One path, not two
 *
 * The wash used to be a second copy of the same path stacked underneath the
 * outline — the same `d` string written twice, once filled and once stroked.
 * That cost 107 nodes across 30 icons and, worse, let the two copies drift:
 * IconPalm's underlay had ended up 0.6 units off its own outline, and the
 * icon rendered as a smear.
 *
 * `fill-opacity` is a separate attribute from `opacity`, so one path can carry
 * a 15% fill *and* a full-strength stroke. Same picture, half the nodes, and
 * the two halves can no longer disagree because there is only one of them.
 *
 * `wash` is the rare case where the filled shape genuinely is not the stroked
 * one — a knife blade whose handle continues past it, a car roof that must not
 * be stroked along the line where it meets the body.
 *
 * ## Sizes
 *
 * Most glyphs are drawn to about 17 of the 24 units and centred on the grid,
 * so a row of them looks level. Linear marks — arrows, the tick, the cross —
 * are deliberately shorter: a horizontal arrow drawn to full height would tower
 * over the label beside it. scripts/audit-icons.mjs measures this and knows
 * which is which.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function base(props: IconProps) {
  const { className = "size-5", ...rest } = props;
  return {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    ...rest,
  };
}

/** Filled at 15% and stroked at full, on one path. */
const duo = { fill: "currentColor", fillOpacity: 0.15 } as const;

/** A wash with no outline of its own, for when another path draws the edge. */
const wash = { fill: "currentColor", fillOpacity: 0.15, stroke: "none" } as const;

/** A dot. Zero-length path plus a round cap, so it matches the stroke weight
 *  everywhere instead of being sized independently. */
const dot = (x: number, y: number) => `M${x} ${y}h.01`;

export function IconSun(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* Rays pulled in to the set's 17 units. They used to reach 2.6 to 21.4,
          nearly the full grid, which made the sun a third heavier than
          everything it sat beside. Core and rays are struck from one pair of
          radii — 4.3 for the disc, 6.2 to 8.5 for the rays — so the cardinals
          and the diagonals end on the same circle. */}
      <circle {...duo} cx="12" cy="12" r="4.3" />
      <path d="M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4l1.6 1.6M18 6l-1.6 1.6M7.6 16.4 6 18" />
    </svg>
  );
}

export function IconPhone(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path {...duo} d="M5 4h4l1.8 4.2-2.2 1.9a12.5 12.5 0 0 0 5.3 5.3l1.9-2.2L20 15v4a1.5 1.5 0 0 1-1.6 1.5C10.4 20 4 13.6 3.5 5.6A1.5 1.5 0 0 1 5 4Z" />
    </svg>
  );
}

/**
 * شوق — the guide behind the call button, as a face.
 *
 * She was five vertical bars: a voice-wave mark, drawn ad-hoc inside
 * WainAi.tsx, which is a picture of *audio* rather than of the person the
 * whole feature is written around. She is «صوت كويتي شبابي — بنت», she
 * introduces herself by name, and the button beside her says «اضغط عشان تكلّم
 * شوق» — so the mark should be someone to talk to.
 *
 * Living here rather than in WainAi means audit:icons measures her like every
 * other glyph: same 24-unit grid, same 1.8 stroke, same optical size. As a
 * local component she was the one mark on the site nothing checked.
 *
 * The parts are separately addressable — `data-part` on the eyes and the mouth
 * — so the animation in globals.css can blink and speak without this file
 * knowing anything about when.
 */
export function IconShouq(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* Drawn against the sizes it is actually used at — 20px in the launcher,
          24px in the call sheet. Two earlier attempts died there: a full hair
          dome with side panels turned to mush below 40px and read as
          headphones, and a thin fringe arc over a plain circle simply vanished,
          leaving a generic smiley with nothing girlish left in it. A solid hair
          mass over an open face survives the shrink, because it is a contrast
          of areas rather than a line. */}
      <path d="M12 4.4a7.6 7.6 0 1 1 0 15.2 7.6 7.6 0 0 1 0-15.2Z" />
      <path
        {...duo}
        d="M4.6 12.4a7.6 7.6 0 0 1 14.8 0c-.9-1.4-1.9-2.1-3.2-2.5-1.4-.4-2-1.6-4.4-1.6-3.6 0-6.2 1.7-7.2 4.1Z"
      />
      <path data-part="eyes" d={`${dot(9.6, 13)}${dot(14.4, 13)}`} />
      {/* The smile is the whole point, so it is the widest mark on the face. */}
      <path data-part="mouth" d="M9.3 15.9c.7.8 1.7 1.2 2.7 1.2s2-.4 2.7-1.2" />
    </svg>
  );
}

export function IconInstagram(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect {...duo} x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle cx="12" cy="12" r="3.6" />
      {/* Drawn as a capped dot like every other dot in the set. As a stroked
          r=0.4 circle it inherited the 1.8 stroke and rendered three times the
          size it claimed. */}
      <path d={dot(16.8, 7.2)} />
    </svg>
  );
}

export function IconGlobe(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle {...duo} cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.2 3.6 5 3.6 8.5s-1.2 6.3-3.6 8.5c-2.4-2.2-3.6-5-3.6-8.5s1.2-6.3 3.6-8.5Z" />
    </svg>
  );
}

export function IconPinSolid(props: IconProps) {
  const { className = "size-5", ...rest } = props;
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden focusable={false} {...rest}>
      {/* Drawn to 17 units like the rest of the set. At its old 20 it was the
          tallest thing in the family and looked a size up from its neighbours. */}
      <path d="M12 3.5a6.1 6.1 0 0 0-6.1 6.1c0 4.4 6.1 10.9 6.1 10.9s6.1-6.5 6.1-10.9A6.1 6.1 0 0 0 12 3.5Zm0 8.6a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" />
    </svg>
  );
}

export function IconGrid(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2.2" />
      <rect {...duo} x="13.5" y="13.5" width="7" height="7" rx="2.2" />
    </svg>
  );
}

export function IconTower(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8.5 2v2.5" />
      <circle {...duo} cx="8.5" cy="7.3" r="2.8" />
      <path d="M7.6 10 6.5 21M9.4 10l1.1 11" />
      <path d="M17 6v3.2" />
      <circle cx="17" cy="10.8" r="1.9" />
      <path d="M16.4 12.6 15.7 21M17.6 12.6l.7 8.4" />
      <path d="M4.5 21h15" />
    </svg>
  );
}

export function IconCutlery(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* Three tines. With only the outer two it read as a tuning fork. */}
      <path d="M7 3v6.2a2 2 0 0 0 4 0V3" />
      <path d="M9 3v5.2" />
      <path d="M9 9.5V21" />
      {/* The blade is filled, but the outline continues down into the handle,
          so the two really are different shapes. */}
      <path {...wash} d="M17.5 3c-1.9 1.2-2.9 3.2-2.9 5.4 0 1.8 1 2.9 2.9 3.1Z" />
      <path d="M17.5 3c-1.9 1.2-2.9 3.2-2.9 5.4 0 1.8 1 2.9 2.9 3.1V21" />
    </svg>
  );
}

export function IconBurger(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path {...duo} d="M4 9.5C4 6.5 7.6 4.5 12 4.5s8 2 8 5H4Z" />
      <path d="M3.5 13h17" />
      <path d="M4 16.5h16c0 1.9-1.6 3.3-3.5 3.3h-9C5.6 19.8 4 18.4 4 16.5Z" />
      <path d={`${dot(8.5, 7)}${dot(12, 6.5)}${dot(15.5, 7)}`} />
    </svg>
  );
}

/** Arabic coffee pot (dallah) — more Kuwaiti than a latte cup. */
export function IconDallah(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path {...duo} d="M9 8h6l1.2 9.5a2 2 0 0 1-2 2.5H9.8a2 2 0 0 1-2-2.5L9 8Z" />
      <path d="M9.2 8 8 5.5h8L14.8 8" />
      <path d="M11 3.5h2" />
      <path d="M12 3.5V2.6" />
      <path d="M16.6 10.5c1.7.3 2.9 1.3 2.9 2.7 0 1.1-.8 2-2.1 2.4" />
      <path d="M7.4 10.5C5.9 9.9 5 8.7 5 7.4" />
    </svg>
  );
}

/**
 * Date palm.
 *
 * Redrawn. The old one had five fronds sprouting from slightly different
 * points, each with a wash that had drifted off its outline, and they piled up
 * into a black smear that read as nothing at all. This is four fronds from one
 * crown, symmetrical, with a trunk that leans the way a date palm actually
 * does — legible down to 16px, which is the size it is mostly seen at.
 */
export function IconPalm(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* Fronds are open strokes, not filled slivers. Drawn as closed shapes
          they were about two units across, and a 1.8 stroke centred on a
          two-unit shape fills it in completely — four of them merged into one
          black canopy that read as a mushroom. The tower is all-stroke for the
          same reason and is the clearest glyph in the set. */}
      <path d="M12 9.1c-2.5-2.5-5.4-2.7-7.9-.5" />
      <path d="M12 9.1c2.5-2.5 5.4-2.7 7.9-.5" />
      <path d="M12 9.1c-1-2.9-3.3-4.5-6.3-4.6" />
      <path d="M12 9.1c1-2.9 3.3-4.5 6.3-4.6" />
      <circle {...duo} cx="12" cy="9.4" r="1.3" />
      <path d="M12.2 10.6c.3 4 .5 7.5.6 10.4" />
      <path d="M4.5 21h15" />
    </svg>
  );
}

export function IconBag(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path {...duo} d="M5.8 8.5h12.4l.9 10.2a2 2 0 0 1-2 2.3H6.9a2 2 0 0 1-2-2.3L5.8 8.5Z" />
      <path d="M9 11V6.5a3 3 0 0 1 6 0V11" />
    </svg>
  );
}

export function IconMasks(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* Lifted a unit: the pair used to sit low enough in the box to look
          dropped next to anything beside it. */}
      <path d="M3.5 4.5H11v5.6a3.75 3.75 0 0 1-7.5 0Z" />
      <path {...duo} d="M13 4.5h7.5v5.6a3.75 3.75 0 0 1-7.5 0Z" />
      <path d={`${dot(5.9, 7.3)}${dot(8.6, 7.3)}${dot(15.4, 7.3)}${dot(18.1, 7.3)}`} />
      <path d="M6.3 17.6c1.7 1.3 3.5 1.9 5.7 1.9s4-.6 5.7-1.9" />
    </svg>
  );
}

export function IconFerris(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle {...duo} cx="12" cy="10" r="6.8" />
      <circle cx="12" cy="10" r="1.7" />
      <path d="M12 3.2v13.6M5.2 10h13.6M7.2 5.2l9.6 9.6M16.8 5.2l-9.6 9.6" />
      <path d="M8.8 21h6.4L12 16.8Z" />
    </svg>
  );
}

export function IconStar(props: IconProps) {
  const { className = "size-5", ...rest } = props;
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden focusable={false} {...rest}>
      {/* Struck from the actual geometry — five points on a circle of radius
          9.4, valleys at 3.7 — rather than adjusted by hand. The old one had
          drifted 2.2 units to the left of centre, which is visible in a rating
          row where the same star repeats five times. */}
      <path d="M12 3.5 14.18 9.91 20.94 10 15.52 14.04 17.52 20.5 12 16.6 6.48 20.5 8.48 14.04 3.06 10 9.82 9.91Z" />
    </svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle {...duo} cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)} strokeWidth={2.4}>
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle {...duo} cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4-4" />
    </svg>
  );
}

/** Forward arrow: points left, the reading direction of this RTL site. */
export function IconGo(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 12h15" />
      <path d="m10.5 6-6 6 6 6" />
    </svg>
  );
}

/**
 * Send: a paper plane, pointing along the RTL reading direction.
 *
 * The wing is the washed half — the body of the plane is the shape the eye
 * reads, and filling the whole outline turns it into a triangle.
 */
export function IconSend(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path {...duo} d="M20.5 4.2 3.6 10.4a.6.6 0 0 0 0 1.1l6.7 2.3 2.3 6.7a.6.6 0 0 0 1.1 0Z" />
      <path d="m10.3 13.8 4.6-4.6" />
    </svg>
  );
}

/** Back arrow: points right, against the RTL reading direction. */
export function IconBack(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 12h15" />
      <path d="m13.5 6 6 6-6 6" />
    </svg>
  );
}

export function IconCompass(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle {...duo} cx="12" cy="12" r="8.5" />
      <path fill="currentColor" stroke="none" d="m15.8 8.2-2.5 5.1-5.1 2.5 2.5-5.1 5.1-2.5Z" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Crosshair target for "use my location". */
export function IconLocate(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* Was the largest box in the set at 19 units, purely because the four
          arms reached further than anything else does. */}
      <circle {...duo} cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <path d="M12 3.5v2.5M12 18v2.5M3.5 12h2.5M18 12h2.5" />
    </svg>
  );
}

export function IconMap(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path {...duo} d="m9 4-4.6 1.8a1 1 0 0 0-.65.94V19.3a.7.7 0 0 0 .96.65L9 18.3l6 1.9 4.6-1.8a1 1 0 0 0 .65-.94V5.4a.7.7 0 0 0-.96-.65L15 6.4 9 4Z" />
      <path d="M9 4v14.3M15 6.4v13.4" />
    </svg>
  );
}

export function IconSparkle(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* Both stars shifted left so the pair is centred. The large one alone
          was centred, which put the pair 1.8 units to the right. */}
      <path
        {...duo}
        d="M10.2 3.5c.6 3.6 2.2 5.2 5.8 5.8-3.6.6-5.2 2.2-5.8 5.8-.6-3.6-2.2-5.2-5.8-5.8 3.6-.6 5.2-2.2 5.8-5.8Z"
      />
      <path d="M16.7 15.5c.3 1.8 1.1 2.6 2.9 2.9-1.8.3-2.6 1.1-2.9 2.9-.3-1.8-1.1-2.6-2.9-2.9 1.8-.3 2.6-1.1 2.9-2.9Z" />
    </svg>
  );
}

export function IconCar(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* Raised a unit to sit on the grid's centre line. The roof is washed
          separately because merging it with the outline would draw a stroke
          across the line where the roof meets the body. */}
      <path {...wash} d="M5 11.4 6.8 6.4a2 2 0 0 1 1.9-1.3h6.6a2 2 0 0 1 1.9 1.3l1.8 5Z" />
      <path d="M5 11.4 6.8 6.4a2 2 0 0 1 1.9-1.3h6.6a2 2 0 0 1 1.9 1.3l1.8 5" />
      <path d="M4.5 11.4h15a1 1 0 0 1 1 1v3.4a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-3.4a1 1 0 0 1 1-1Z" />
      <path d={`${dot(7.3, 14.2)}${dot(16.7, 14.2)}`} />
      <path d="M6 16.8v2M18 16.8v2" />
    </svg>
  );
}

export function IconCoins(props: IconProps) {
  return (
    <svg {...base(props)}>
      <ellipse {...duo} cx="12" cy="6.5" rx="7" ry="3" />
      <path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
      <path d="M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base(props)} strokeWidth={2.2}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

export function IconHome(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        {...duo}
        d="M4.5 10.2 12 4l7.5 6.2V19a1 1 0 0 1-1 1h-4.6v-5.4H10V20H5.5a1 1 0 0 1-1-1v-8.8Z"
      />
    </svg>
  );
}

export function IconSpeaker(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        {...duo}
        d="M10.7 4.9 6.6 8.2H4a1 1 0 0 0-1 1v5.6a1 1 0 0 0 1 1h2.6l4.1 3.3a.9.9 0 0 0 1.5-.7V5.6a.9.9 0 0 0-1.5-.7Z"
      />
      <path d="M15.5 9.6a3.6 3.6 0 0 1 0 4.8" />
      <path d="M18 7.2a7 7 0 0 1 0 9.6" />
    </svg>
  );
}

export function IconSpeakerOff(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        {...duo}
        d="M10.7 4.9 6.6 8.2H4a1 1 0 0 0-1 1v5.6a1 1 0 0 0 1 1h2.6l4.1 3.3a.9.9 0 0 0 1.5-.7V5.6a.9.9 0 0 0-1.5-.7Z"
      />
      <path d="m15.6 9.7 4.6 4.6M20.2 9.7l-4.6 4.6" />
    </svg>
  );
}
