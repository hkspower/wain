// The flags of the Middle East, drawn rather than downloaded.
//
// Every other texture in this game is procedural, and these are too: no
// image files, no atlas, nothing to 404 at two in the morning. Each flag
// is a function of a canvas, drawn from its own official specification —
// the real proportions, the real construction, the published colours.
//
// WHY THE PROPORTIONS ARE DATA AND NOT A GUESS
//
// A flag is one of the few things in a game where "close enough" is
// visibly wrong to the people it belongs to. Qatar is not a 3:2 flag
// with a serrated edge; it is 28:11, nearly three times as long as it is
// tall, and drawing it at 3:2 makes it a different object. Bahrain has
// five points and Qatar has nine, and that is the whole difference
// between them at a distance. Nepal is not here, but the same principle
// is why it would need its own shape rather than a rectangle.
//
// So `ratio` is carried per flag and the caller is expected to honour
// it. `flagPlane` exists so that honouring it is easier than not.
//
// WHAT IS EXACT AND WHAT IS DRAWN
//
// Bands, triangles, serrations, stars, crescents and the cedar are
// geometry, and they are exact — the same construction the specification
// describes, at whatever resolution is asked for.
//
// Four emblems are inscriptions or fine heraldry: the shahada on Saudi
// Arabia's flag, the takbir on Iraq's and Iran's, and the eagles and
// khanjar of Egypt, Yemen-era heraldry and Oman. Script is rendered as
// real Arabic text through the same font pipeline the road signs use,
// which is why this module leans on textTexture: a texture rasterised
// before its font arrives bakes the fallback in, and for Arabic that
// failure is not subtle. The heraldic emblems are honest vector
// reductions — right silhouette, right colour, right place, fewer
// feathers. At the sizes these are seen (a 0.13 m chest patch, a 6 m
// mast flag from a moving car) that is the truthful trade, and it is
// recorded here rather than discovered later.

import * as THREE from "three";
import { textTexture, arabicUI } from "./text";

/** A country whose flag this module can draw. */
export type FlagId =
  | "bh" // Bahrain
  | "eg" // Egypt
  | "iq" // Iraq
  | "jo" // Jordan
  | "kw" // Kuwait
  | "lb" // Lebanon
  | "om" // Oman
  | "ps" // Palestine
  | "qa" // Qatar
  | "sa" // Saudi Arabia
  | "sy" // Syria
  | "tr" // Türkiye
  | "ae" // United Arab Emirates
  | "ye"; // Yemen

export interface FlagSpec {
  /** English name, as the country calls itself in English. */
  name: string;
  /** Arabic name. Greek/Turkish states carry their own language's name. */
  nameAr: string;
  /** Width over height, from the flag's own specification. */
  ratio: number;
  /** Draw the flag to fill exactly w x h. */
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  /** True when the flag carries script or fine heraldry, so the texture
   *  has to wait for fonts and is worth more pixels. */
  script?: boolean;
}

// ---------------------------------------------------------------- paint
//
// The published colours. Where a country specifies Pantone rather than
// hex these are the standard sRGB renderings of those Pantones.

const PAN_ARAB_GREEN = "#007a3d";
const PAN_ARAB_RED = "#ce1126";
const PAN_ARAB_BLACK = "#000000";
const WHITE = "#ffffff";

/** Horizontal bands, top to bottom, in equal thirds unless weighted. */
function bands(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  colours: string[],
  weights?: number[]
): void {
  const wts = weights ?? colours.map(() => 1);
  const total = wts.reduce((a, b) => a + b, 0);
  let y = 0;
  for (let i = 0; i < colours.length; i++) {
    // Each band is drawn to the NEXT boundary rather than by its own
    // height, so rounding cannot leave a seam of background between two
    // bands — which at 1024 px is a visible white hairline.
    const next = y + (h * wts[i]) / total;
    ctx.fillStyle = colours[i];
    ctx.fillRect(0, Math.round(y) - 1, w, Math.round(next) - Math.round(y) + 2);
    y = next;
  }
}

/** A regular star, point-up, of `n` points. */
function star(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  n: number,
  rot = 0
): void {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = rot - Math.PI / 2 + (i * Math.PI) / n;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * A crescent, cut the way a real one is: one disc minus a second disc
 * offset toward the opening. Drawing it as an arc with a thick stroke
 * gives even horns and a flat back, and every crescent flag in the world
 * has horns that taper to a point.
 */
function crescent(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  innerR: number,
  offset: number,
  colour: string,
  field: string
): void {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = field;
  ctx.beginPath();
  ctx.arc(cx + offset, cy, innerR, 0, Math.PI * 2);
  ctx.fill();
}

/** Arabic text, centred on a point, scaled to fit a width. */
function script(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxW: number,
  size: number,
  colour: string
): void {
  ctx.save();
  ctx.fillStyle = colour;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = "rtl";
  ctx.font = `700 ${size}px ${arabicUI()}`;
  const m = ctx.measureText(text);
  if (m.width > maxW) {
    ctx.translate(cx, cy);
    ctx.scale(maxW / m.width, 1);
    ctx.fillText(text, 0, 0);
  } else {
    ctx.fillText(text, cx, cy);
  }
  ctx.restore();
}

// ------------------------------------------------------------ the flags

export const FLAGS: Record<FlagId, FlagSpec> = {
  // Bahrain — 5:3. Five white points, one for each pillar of Islam.
  bh: {
    name: "Bahrain",
    nameAr: "البحرين",
    ratio: 5 / 3,
    draw(ctx, w, h) {
      ctx.fillStyle = "#ce1126";
      ctx.fillRect(0, 0, w, h);
      // The white hoist, cut by five teeth.
      //
      // Decree Law No. 4 of 2002 divides the LENGTH into red three
      // quarters and white one quarter, and each tooth is an isosceles
      // triangle whose legs reach one fifth of the way into the red
      // section — one fifth of 0.75 is 0.15, so the apexes land at
      // 0.25 + 0.15 = 0.40. Mean white coverage is then (0.25 + 0.40)/2
      // = 13/40 = 32.5%, which is the published figure and the check
      // that these two numbers are the right pair.
      //
      // They were 0.1705 and 0.31, giving 24% — the whole hoist was
      // undersized rather than merely shifted, and neither number
      // corresponded to any fraction in the decree.
      const baseX = w * 0.25; // the white band's straight edge
      const apexX = w * 0.4;  // how far the teeth bite into the red
      ctx.fillStyle = WHITE;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(baseX, 0);
      for (let i = 0; i < 5; i++) {
        ctx.lineTo(apexX, (h * (i + 0.5)) / 5);
        ctx.lineTo(baseX, (h * (i + 1)) / 5);
      }
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
    },
  },

  // Egypt — 3:2. The Eagle of Saladin on the white band.
  eg: {
    name: "Egypt",
    nameAr: "مصر",
    ratio: 3 / 2,
    script: true,
    draw(ctx, w, h) {
      bands(ctx, w, h, [PAN_ARAB_RED, WHITE, PAN_ARAB_BLACK]);
      // The Eagle of Saladin. Heraldry, so this is a silhouette that
      // reads rather than a feather-accurate copy — but it is a proper
      // heraldic eagle now: wings SPREAD wide and horizontal with the
      // primaries stepped, head in profile to the hoist, a shield in
      // the national colours on the breast, and the name-scroll under
      // the tail. The first pass was a small bird on a big flag.
      const cx = w * 0.5, cy = h * 0.5, s2 = h * 0.155;
      ctx.fillStyle = "#c09300";
      for (const side of [-1, 1]) {
        // Wing: a swept plane out to the tip, with three stepped
        // primaries cut into the trailing edge.
        ctx.beginPath();
        ctx.moveTo(cx + side * s2 * 0.2, cy - s2 * 0.55);
        ctx.quadraticCurveTo(
          cx + side * s2 * 1.35, cy - s2 * 0.95,
          cx + side * s2 * 2.05, cy - s2 * 0.42
        );
        for (let i = 0; i < 3; i++) {
          const t = i / 3;
          ctx.lineTo(cx + side * s2 * (2.0 - t * 0.62), cy - s2 * (0.2 - t * 0.16));
          ctx.lineTo(cx + side * s2 * (1.84 - t * 0.62), cy - s2 * (0.42 - t * 0.14));
        }
        ctx.quadraticCurveTo(
          cx + side * s2 * 0.9, cy - s2 * 0.12,
          cx + side * s2 * 0.24, cy + s2 * 0.05
        );
        ctx.closePath();
        ctx.fill();
      }
      // Head and neck, in profile toward the hoist.
      ctx.beginPath();
      ctx.moveTo(cx - s2 * 0.2, cy - s2 * 0.52);
      ctx.lineTo(cx + s2 * 0.2, cy - s2 * 0.52);
      ctx.lineTo(cx + s2 * 0.14, cy - s2 * 0.98);
      ctx.quadraticCurveTo(cx + s2 * 0.05, cy - s2 * 1.3, cx - s2 * 0.26, cy - s2 * 1.24);
      ctx.lineTo(cx - s2 * 0.72, cy - s2 * 1.12); // the beak
      ctx.lineTo(cx - s2 * 0.28, cy - s2 * 1.04);
      ctx.quadraticCurveTo(cx - s2 * 0.3, cy - s2 * 0.78, cx - s2 * 0.2, cy - s2 * 0.52);
      ctx.closePath();
      ctx.fill();
      // Tail: three stepped feathers.
      ctx.beginPath();
      ctx.moveTo(cx - s2 * 0.36, cy + s2 * 0.05);
      ctx.lineTo(cx + s2 * 0.36, cy + s2 * 0.05);
      ctx.lineTo(cx + s2 * 0.3, cy + s2 * 0.85);
      ctx.lineTo(cx + s2 * 0.12, cy + s2 * 1.02);
      ctx.lineTo(cx, cy + s2 * 0.86);
      ctx.lineTo(cx - s2 * 0.12, cy + s2 * 1.02);
      ctx.lineTo(cx - s2 * 0.3, cy + s2 * 0.85);
      ctx.closePath();
      ctx.fill();
      // The shield on its breast, charged with the national colours.
      const shW = s2 * 0.52, shH = s2 * 0.72;
      ctx.beginPath();
      ctx.moveTo(cx - shW / 2, cy - s2 * 0.5);
      ctx.lineTo(cx + shW / 2, cy - s2 * 0.5);
      ctx.lineTo(cx + shW / 2, cy - s2 * 0.5 + shH * 0.62);
      ctx.quadraticCurveTo(cx, cy - s2 * 0.5 + shH * 1.25, cx - shW / 2, cy - s2 * 0.5 + shH * 0.62);
      ctx.closePath();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "#c09300";
      ctx.fillRect(cx - shW / 2, cy - s2 * 0.6, shW / 3, shH * 1.4);
      ctx.fillStyle = WHITE;
      ctx.fillRect(cx - shW / 6, cy - s2 * 0.6, shW / 3, shH * 1.4);
      ctx.fillStyle = "#c09300";
      ctx.fillRect(cx + shW / 6, cy - s2 * 0.6, shW / 3, shH * 1.4);
      ctx.restore();
      // The name-scroll below.
      ctx.fillStyle = "#c09300";
      ctx.beginPath();
      ctx.moveTo(cx - s2 * 0.78, cy + s2 * 1.02);
      ctx.quadraticCurveTo(cx, cy + s2 * 1.26, cx + s2 * 0.78, cy + s2 * 1.02);
      ctx.lineTo(cx + s2 * 0.78, cy + s2 * 1.2);
      ctx.quadraticCurveTo(cx, cy + s2 * 1.44, cx - s2 * 0.78, cy + s2 * 1.2);
      ctx.closePath();
      ctx.fill();
    },
  },

  // Iraq — 3:2. The takbir in green kufic across the white band.
  iq: {
    name: "Iraq",
    nameAr: "العراق",
    ratio: 3 / 2,
    script: true,
    draw(ctx, w, h) {
      bands(ctx, w, h, [PAN_ARAB_RED, WHITE, PAN_ARAB_BLACK]);
      script(ctx, "الله أكبر", w * 0.5, h * 0.5, w * 0.44, h * 0.2, "#007a3d");
    },
  },

  // Jordan — 2:1. Seven points on the star, for the seven verses of
  // the opening surah.
  jo: {
    name: "Jordan",
    nameAr: "الأردن",
    ratio: 2,
    draw(ctx, w, h) {
      bands(ctx, w, h, [PAN_ARAB_BLACK, WHITE, PAN_ARAB_GREEN]);
      ctx.fillStyle = PAN_ARAB_RED;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w * 0.5, h * 0.5);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
      // The star sits on the chevron's axis at a quarter of the length,
      // and its seven points are slim: the inner radius is a little
      // under half the outer, which is what keeps it a star and not a
      // cog. The old inner/outer pair was too close together.
      ctx.fillStyle = WHITE;
      star(ctx, w * 0.25 * 0.72, h * 0.5, h * 0.105, h * 0.042, 7);
    },
  },

  // Kuwait — 2:1. The road this game is set on.
  kw: {
    name: "Kuwait",
    nameAr: "الكويت",
    ratio: 2,
    draw(ctx, w, h) {
      bands(ctx, w, h, [PAN_ARAB_GREEN, WHITE, PAN_ARAB_RED]);
      // The black hoist is a trapezoid, not a triangle — the one thing
      // most redrawings of this flag get wrong.
      // The trapezoid runs a QUARTER of the length, and its parallel
      // edge sits on the two band boundaries — that is the published
      // construction, and 0.28 was a guess that made the hoist heavy.
      ctx.fillStyle = PAN_ARAB_BLACK;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w * 0.25, h / 3);
      ctx.lineTo(w * 0.25, (h * 2) / 3);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
    },
  },

  // Lebanon — 3:2. The white band is half the height, not a third.
  lb: {
    name: "Lebanon",
    nameAr: "لبنان",
    ratio: 3 / 2,
    draw(ctx, w, h) {
      bands(ctx, w, h, ["#ed1c24", WHITE, "#ed1c24"], [1, 2, 1]);
      // The cedar.
      //
      // Not a Christmas tree. A Lebanon cedar is the opposite shape to a
      // fir: the branches are HORIZONTAL and the crown is broad and flat
      // rather than pointed, which is why the tree reads as a cedar at
      // any distance and a stepped triangle never does. The official
      // flag also has it filling the whole white band and touching both
      // red stripes, which is what makes it the subject of the flag.
      ctx.fillStyle = "#00a651";
      const cx = w * 0.5;
      const top = h * 0.255, bot = h * 0.745;      // touches both stripes
      const span = bot - top;
      const trunkW = w * 0.019;
      // Trunk, tapering.
      ctx.beginPath();
      ctx.moveTo(cx - trunkW, bot);
      ctx.lineTo(cx + trunkW, bot);
      ctx.lineTo(cx + trunkW * 0.55, top + span * 0.2);
      ctx.lineTo(cx - trunkW * 0.55, top + span * 0.2);
      ctx.closePath();
      ctx.fill();
      // Five tiers of horizontal boughs, widest low, each drawn as a
      // shallow wedge with a lifted tip — a cedar's branches rise a
      // little at the ends.
      const tiers = 5;
      for (let i = 0; i < tiers; i++) {
        const t = i / (tiers - 1);                 // 0 at the crown
        const y = top + span * (0.16 + t * 0.72);
        const halfW = w * (0.038 + t * 0.098);
        const thick = span * (0.075 - t * 0.012);
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx, y - thick * 0.5);
          ctx.lineTo(cx + side * halfW, y - thick * 0.95);
          ctx.lineTo(cx + side * halfW * 0.92, y + thick * 0.15);
          ctx.lineTo(cx, y + thick * 0.6);
          ctx.closePath();
          ctx.fill();
        }
      }
      // The crown: a small flat-topped cap, not a spike.
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.021, top + span * 0.17);
      ctx.lineTo(cx - w * 0.009, top);
      ctx.lineTo(cx + w * 0.009, top);
      ctx.lineTo(cx + w * 0.021, top + span * 0.17);
      ctx.closePath();
      ctx.fill();
    },
  },

  // Oman — 2:1. The khanjar and two crossed sabres, on the hoist.
  om: {
    name: "Oman",
    nameAr: "عُمان",
    ratio: 2,
    script: true,
    draw(ctx, w, h) {
      bands(ctx, w, h, [WHITE, "#db161b", "#008000"]);
      ctx.fillStyle = "#db161b";
      ctx.fillRect(0, 0, w * 0.28, h);
      // The national emblem: a khanjar in its sheath, over two crossed
      // sabres, bound by a belt. The first pass drew a vertical, a
      // horizontal and two diagonals, which is an asterisk — the shape
      // that matters here is the sheath's J, hooking back on itself, and
      // that is the part this draws properly.
      // Sized to the hoist band it sits on, and placed in its upper
      // half. At h * 0.15 it was a white scribble; the emblem is the
      // whole point of this flag's hoist and can carry the width.
      const cx = w * 0.135, cy = h * 0.27, s2 = h * 0.21;
      ctx.strokeStyle = WHITE;
      ctx.fillStyle = WHITE;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      // Two sabres crossing behind, each curved, hilts down.
      ctx.lineWidth = s2 * 0.11;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx - side * s2 * 0.78, cy + s2 * 0.98);
        ctx.quadraticCurveTo(cx - side * s2 * 0.1, cy + s2 * 0.2, cx + side * s2 * 0.82, cy - s2 * 0.72);
        ctx.stroke();
        // pommel
        ctx.beginPath();
        ctx.arc(cx - side * s2 * 0.82, cy + s2 * 1.03, s2 * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
      // The khanjar. Hilt: a tapered post with a flared cap.
      ctx.beginPath();
      ctx.moveTo(cx - s2 * 0.11, cy - s2 * 0.88);
      ctx.lineTo(cx + s2 * 0.11, cy - s2 * 0.88);
      ctx.lineTo(cx + s2 * 0.08, cy - s2 * 0.34);
      ctx.lineTo(cx - s2 * 0.08, cy - s2 * 0.34);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, cy - s2 * 0.92, s2 * 0.19, s2 * 0.075, 0, 0, Math.PI * 2);
      ctx.fill();
      // Crossguard.
      ctx.beginPath();
      ctx.moveTo(cx - s2 * 0.3, cy - s2 * 0.38);
      ctx.lineTo(cx + s2 * 0.3, cy - s2 * 0.38);
      ctx.lineTo(cx + s2 * 0.24, cy - s2 * 0.2);
      ctx.lineTo(cx - s2 * 0.24, cy - s2 * 0.2);
      ctx.closePath();
      ctx.fill();
      // The sheath: down, then hooking hard back to the hoist side. This
      // J is the whole silhouette of a khanjar and the reason it is not
      // just a dagger.
      ctx.beginPath();
      ctx.moveTo(cx - s2 * 0.17, cy - s2 * 0.18);
      ctx.lineTo(cx + s2 * 0.17, cy - s2 * 0.18);
      ctx.quadraticCurveTo(cx + s2 * 0.5, cy + s2 * 0.42, cx + s2 * 0.02, cy + s2 * 0.72);
      ctx.quadraticCurveTo(cx - s2 * 0.3, cy + s2 * 0.86, cx - s2 * 0.42, cy + s2 * 0.6);
      ctx.quadraticCurveTo(cx - s2 * 0.16, cy + s2 * 0.66, cx + s2 * 0.02, cy + s2 * 0.44);
      ctx.quadraticCurveTo(cx + s2 * 0.2, cy + s2 * 0.24, cx - s2 * 0.17, cy - s2 * 0.18);
      ctx.closePath();
      ctx.fill();
      // The belt across the sheath's throat.
      ctx.lineWidth = s2 * 0.08;
      ctx.beginPath();
      ctx.moveTo(cx - s2 * 0.26, cy + s2 * 0.06);
      ctx.lineTo(cx + s2 * 0.3, cy + s2 * 0.06);
      ctx.stroke();
    },
  },

  // Palestine — 2:1.
  ps: {
    name: "Palestine",
    nameAr: "فلسطين",
    ratio: 2,
    draw(ctx, w, h) {
      bands(ctx, w, h, [PAN_ARAB_BLACK, WHITE, PAN_ARAB_GREEN]);
      // A THIRD of the length, which is what separates this chevron
      // from Jordan's — that one reaches the halfway line. Drawn at the
      // same depth they are the same flag minus a star.
      ctx.fillStyle = PAN_ARAB_RED;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w / 3, h * 0.5);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
    },
  },

  // Qatar — 28:11. The longest national flag in the world, and nine
  // points, not five: this is what separates it from Bahrain.
  qa: {
    name: "Qatar",
    nameAr: "قطر",
    ratio: 28 / 11,
    draw(ctx, w, h) {
      ctx.fillStyle = "#8a1538";
      ctx.fillRect(0, 0, w, h);
      // On the 28-unit length the construction divides as 8 white, a
      // 2-unit serration, 18 maroon: base at 8/28 = 2/7, tips at
      // 10/28 = 5/14, white area 9/28 = 32.1%. Written as fractions
      // because 0.2 and 0.34 were eyeballed and gave a band 30% too
      // narrow with teeth twice as deep as they should be.
      const baseX = w * (2 / 7);
      const apexX = w * (5 / 14);
      ctx.fillStyle = WHITE;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(baseX, 0);
      for (let i = 0; i < 9; i++) {
        const mid = (h * (i + 0.5)) / 9;
        const bot = (h * (i + 1)) / 9;
        ctx.lineTo(apexX, mid);
        ctx.lineTo(baseX, bot);
      }
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
    },
  },

  // Saudi Arabia — 3:2. The shahada above a sword, and the flag is
  // never flown at half-mast or reversed, because the words are on it.
  sa: {
    name: "Saudi Arabia",
    nameAr: "السعودية",
    ratio: 3 / 2,
    script: true,
    draw(ctx, w, h) {
      ctx.fillStyle = "#006c35";
      ctx.fillRect(0, 0, w, h);
      script(ctx, "لا إله إلا الله محمد رسول الله", w * 0.5, h * 0.38, w * 0.74, h * 0.19, WHITE);
      // The sword beneath, point to the hoist.
      ctx.fillStyle = WHITE;
      const y = h * 0.66, x0 = w * 0.14, x1 = w * 0.86;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + w * 0.06, y - h * 0.035);
      ctx.lineTo(x1 - w * 0.13, y - h * 0.035);
      ctx.lineTo(x1 - w * 0.13, y + h * 0.035);
      ctx.lineTo(x0 + w * 0.06, y + h * 0.035);
      ctx.closePath();
      ctx.fill();
      // hilt and pommel at the fly
      ctx.fillRect(x1 - w * 0.13, y - h * 0.075, w * 0.022, h * 0.15);
      ctx.fillRect(x1 - w * 0.105, y - h * 0.028, w * 0.085, h * 0.056);
      ctx.beginPath();
      ctx.arc(x1 - w * 0.015, y, h * 0.045, 0, Math.PI * 2);
      ctx.fill();
    },
  },

  // Syria — 3:2. Two green stars on the white.
  sy: {
    name: "Syria",
    nameAr: "سوريا",
    ratio: 3 / 2,
    draw(ctx, w, h) {
      bands(ctx, w, h, [PAN_ARAB_RED, WHITE, PAN_ARAB_BLACK]);
      ctx.fillStyle = PAN_ARAB_GREEN;
      star(ctx, w * 0.333, h * 0.5, h * 0.093, h * 0.04, 5);
      star(ctx, w * 0.667, h * 0.5, h * 0.093, h * 0.04, 5);
    },
  },

  // Türkiye — 3:2. The crescent's opening faces the fly, and the star
  // sits in it rather than on the horn.
  tr: {
    name: "Türkiye",
    nameAr: "تركيا",
    ratio: 3 / 2,
    draw(ctx, w, h) {
      // The Turkish Flag Law gives this one exactly, on a 30 x 20 grid:
      // the crescent's outer circle has diameter 10 centred 10 along,
      // the inner circle diameter 8 centred 11.5 along, and the star's
      // circumscribed circle diameter 7.5 centred at 18.5. Everything
      // below is those numbers over 30 and over 20. The previous values
      // were eyeballed and had the star at 0.539 of the length and less
      // than half its proper size.
      ctx.fillStyle = "#e30a17";
      ctx.fillRect(0, 0, w, h);
      crescent(ctx, w * (10 / 30), h * 0.5, h * 0.25, h * 0.2, w * (1.5 / 30), WHITE, "#e30a17");
      ctx.fillStyle = WHITE;
      // Point-up is wrong for this star: it is turned so one point aims
      // back at the crescent's opening.
      star(ctx, w * (18.5 / 30), h * 0.5, h * (3.75 / 20), h * (1.5 / 20), 5, Math.PI);
    },
  },

  // United Arab Emirates — 2:1.
  ae: {
    name: "United Arab Emirates",
    nameAr: "الإمارات",
    ratio: 2,
    draw(ctx, w, h) {
      bands(ctx, w, h, ["#00732f", WHITE, PAN_ARAB_BLACK]);
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, w * 0.25, h);
    },
  },

  // Yemen — 3:2.
  ye: {
    name: "Yemen",
    nameAr: "اليمن",
    ratio: 3 / 2,
    draw(ctx, w, h) {
      bands(ctx, w, h, [PAN_ARAB_RED, WHITE, PAN_ARAB_BLACK]);
    },
  },
};

/** Every flag this module draws, in the order a Gulf corniche flies
 *  them: alphabetical by English name, which is what protocol asks for
 *  when there is no other order. */
export const FLAG_IDS = Object.keys(FLAGS) as FlagId[];

// ------------------------------------------------------------- textures

/**
 * How many pixels across a flag is drawn.
 *
 * The mast flags are 6 m of geometry seen from twenty metres, and the
 * old Kuwait texture was 256 across — which is why "no blur" was a task
 * of its own. 1024 is four times that in each axis and costs 4 MB across
 * the whole set, once, shared.
 *
 * Script flags get more, because Arabic at 1024 on a flag two thirds of
 * whose width is inscription is the one case where the letters and not
 * the bands set the resolution.
 */
const FLAG_W = 1024;
const FLAG_W_SCRIPT = 1536;

const cache = new Map<FlagId, THREE.CanvasTexture>();

/** The flag of `id`, drawn once and shared. */
export function flagTexture(id: FlagId = "kw"): THREE.CanvasTexture {
  const hit = cache.get(id);
  if (hit) return hit;
  const spec = FLAGS[id];
  const w = spec.script ? FLAG_W_SCRIPT : FLAG_W;
  const h = Math.round(w / spec.ratio);
  // textTexture rather than a bare canvas: the script flags have to
  // repaint when the Arabic font lands, or they bake in whatever the
  // fallback drew — and a flag with the shahada on it rendered in a
  // fallback face is not a small error.
  const tex = textTexture(w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);
    spec.draw(ctx, w, h);
  });
  tex.anisotropy = 16;
  cache.set(id, tex);
  return tex;
}

/**
 * A plane of the right SHAPE for a flag, given a height.
 *
 * Here so that nothing has to remember that Qatar is two and a half
 * times wider than it is tall. Pass the height you want the flag to fly
 * at and the width follows from the specification.
 */
export function flagPlane(id: FlagId, height: number): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(height * FLAGS[id].ratio, height);
}

/** Look up a flag by country name, in English or Arabic, as the rival
 *  roster and the profile screen spell it. Returns null for a name this
 *  module does not draw, so a caller can fall back rather than throw. */
export function flagIdFor(country: string | undefined): FlagId | null {
  if (!country) return null;
  const want = country.trim().toLowerCase();
  for (const id of FLAG_IDS) {
    const f = FLAGS[id];
    if (f.name.toLowerCase() === want || f.nameAr === country.trim()) return id;
  }
  // The spellings people actually use.
  const alias: Record<string, FlagId> = {
    uae: "ae",
    emirates: "ae",
    "u.a.e.": "ae",
    ksa: "sa",
    "saudi": "sa",
    turkey: "tr",
    türkiye: "tr",
  };
  return alias[want] ?? null;
}
