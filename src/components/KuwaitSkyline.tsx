/**
 * Illustrated Kuwait skyline used as the hero backdrop.
 * Pure inline SVG so it stays crisp at any width and ships with the
 * static export (no external image requests).
 *
 * `meet`, not `slice`: the caller gives it a box of its own ratio, and a
 * fit that can crop is how the towers at either end went missing on phones.
 *
 * The towers and palms are shaded from one light, upper left, so they read
 * as objects standing in the sun rather than cut-outs. The spheres' discs
 * are placed on the sphere and lit by the same vector (`LIGHT`), which is
 * what makes them curve and fade into the shadow side; scattered by hand
 * they sat on the circle like stickers. Everything is computed at build
 * time — this is a server component, so the page ships plain SVG.
 *
 * The Gulf is behind the skyline (`Sea`): a horizon at y 250 that shows above
 * the low buildings and in every gap between the towers, with a seawall at the
 * foot. It lives inside the same 1200×530 on purpose — the home page and the
 * Flutter hero (`home_screen.dart`, `w * 530 / 1200`) both hard-code that ratio,
 * so a sea BELOW the grass would have meant changing both. The waves come from
 * a seeded generator: the same commit must render the same HTML.
 *
 * The canvas is 1200×530 with its origin at y −110, not 1200×420: the two
 * tall landmarks were drawn to within 34 units of the old top edge, so making
 * them taller meant more sky above them, not a tighter crop. Moving the
 * origin rather than every coordinate leaves the ground at y 372 and every
 * building's numbers as they were. The page's `aspect-[1200/530]` and its sky
 * reserve are tied to that ratio — change one, change the other.
 */

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Upper left and towards the viewer, normalised. Screen y points down. */
const LIGHT = (() => {
  const v = [-0.45, -0.55, 0.7];
  const m = Math.hypot(...v);
  return v.map((c) => c / m);
})();

/** Seen from the street, a tower's sphere is looked UP at: tilting it
 *  towards the viewer is what bends each row of discs into an arc. Without
 *  it every row of latitude projects to a straight line and the sphere reads
 *  as a disc with stripes. */
const TILT = 0.3;

/** Discs on a sphere: rows of latitude, foreshortened and lit per disc. */
function sequins(cx: number, cy: number, r: number, lats: number[], perRow: number, span: number, d: number) {
  const step = (2 * span) / (perRow - 1);
  const [ct, st] = [Math.cos(TILT), Math.sin(TILT)];
  return lats.flatMap((lat, row) => {
    const phi = (lat * Math.PI) / 180;
    return Array.from({ length: perRow }, (_, k) => -span + k * step + (row % 2 ? step / 2 : 0))
      .filter((lon) => lon <= span)
      .map((lon) => {
        const lam = (lon * Math.PI) / 180;
        const [x, y, z] = [Math.sin(lam) * Math.cos(phi), -Math.sin(phi), Math.cos(lam) * Math.cos(phi)];
        const n = [x, y * ct - z * st, z * ct + y * st];
        const lit = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
        return {
          x: r1(cx + r * n[0]),
          y: r1(cy + r * n[1]),
          rx: r1(d * Math.sqrt(1 - n[0] * n[0])),
          ry: r1(d * Math.sqrt(1 - n[1] * n[1])),
          o: Math.round((0.2 + 0.7 * lit) * 100) / 100,
          facing: n[2],
        };
      })
      // Discs round the rim are edge-on; drawn, they read as a dashed outline.
      .filter((s) => s.facing > 0.3);
  });
}

/** A point on a circle, `deg` clockwise from three o'clock (screen y is down). */
const onCircle = (cx: number, cy: number, r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return `${r1(cx + r * Math.cos(a))} ${r1(cy + r * Math.sin(a))}`;
};

function Orb(p: { cx: number; cy: number; r: number; lats: number[]; perRow: number; span: number; d: number }) {
  const { cx, cy, r } = p;
  const hx = r1(cx - 0.36 * r);
  const hy = r1(cy - 0.42 * r);
  const clip = `wain-orb-clip-${cx}-${cy}`;
  return (
    <g>
      <clipPath id={clip}>
        <circle cx={cx} cy={cy} r={r} />
      </clipPath>
      <circle className="orb" cx={cx} cy={cy} r={r} fill="url(#wain-orb)" />
      {/* The mosaic band the real spheres carry round their middle: the same
          arc the rows of discs follow (TILT bends the equator up over the
          front), a dark ribbon with a pale line on it, clipped to the disc so
          the stroke's width cannot spill past the rim. */}
      <g clipPath={`url(#${clip})`} fill="none">
        <path
          d={`M${r1(cx - r)} ${cy} A${r} ${r1(r * Math.sin(TILT))} 0 0 1 ${r1(cx + r)} ${cy}`}
          stroke="#0f3f6b"
          strokeOpacity="0.38"
          strokeWidth={r1(0.17 * r)}
        />
        <path
          d={`M${r1(cx - r)} ${cy} A${r} ${r1(r * Math.sin(TILT))} 0 0 1 ${r1(cx + r)} ${cy}`}
          stroke="#e8f6fd"
          strokeOpacity="0.55"
          strokeWidth={r1(0.035 * r)}
        />
      </g>
      {sequins(cx, cy, r, p.lats, p.perRow, p.span, p.d).map((s) => (
        <ellipse key={`${s.x},${s.y}`} cx={s.x} cy={s.y} rx={s.rx} ry={s.ry} fill="#ffffff" fillOpacity={s.o} />
      ))}
      {/* Warm light bounced up off the ground onto the shadow side */}
      <path
        d={`M${onCircle(cx, cy, r * 0.92, 5)} A${r1(r * 0.92)} ${r1(r * 0.92)} 0 0 1 ${onCircle(cx, cy, r * 0.92, 95)}`}
        stroke="#ffd9a0"
        strokeOpacity="0.28"
        strokeWidth={r1(0.07 * r)}
        strokeLinecap="round"
        fill="none"
      />
      <ellipse
        cx={hx}
        cy={hy}
        rx={r1(0.24 * r)}
        ry={r1(0.12 * r)}
        transform={`rotate(-35 ${hx} ${hy})`}
        fill="#ffffff"
        opacity="0.75"
      />
    </g>
  );
}

/** A frond from the crown: top edge through `a`, underside back through `b`. */
type Frond = { a: [number, number]; tip: [number, number]; b: [number, number] };
const CROWN: [number, number] = [2, -62];
const BACK_FRONDS: Frond[] = [
  { a: [-14, -88], tip: [-38, -88], b: [-16, -76] },
  { a: [20, -88], tip: [44, -86], b: [20, -76] },
  { a: [4, -88], tip: [-6, -102], b: [8, -90] },
];
const FRONT_FRONDS: Frond[] = [
  { a: [-20, -62], tip: [-30, -30], b: [-10, -50] },
  { a: [26, -62], tip: [36, -32], b: [14, -50] },
  { a: [-28, -70], tip: [-40, -52], b: [-16, -56] },
  { a: [32, -72], tip: [46, -54], b: [20, -58] },
];

function FrondShape({ f, base, lit }: { f: Frond; base: string; lit: string }) {
  const [cx, cy] = CROWN;
  const m = [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2];
  const P = (q: number[]) => `${q[0]} ${q[1]}`;
  return (
    <g>
      <path d={`M${cx} ${cy} Q${P(f.a)} ${P(f.tip)} Q${P(f.b)} ${cx} ${cy + 3} Z`} fill={base} />
      {/* The upper half of a folded leaf catches the light */}
      <path d={`M${cx} ${cy} Q${P(f.a)} ${P(f.tip)} Q${P(m)} ${cx} ${cy} Z`} fill={lit} />
      <path d={`M${cx} ${cy} Q${P(m)} ${P(f.tip)}`} stroke="#1b5832" strokeWidth="1.1" fill="none" opacity="0.55" />
    </g>
  );
}

/** Trunk centre line, local to the palm: base (0,0), control (-4,-34), crown (2,-62). */
const TRUNK_RINGS = [0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.82].map((t) => {
  const x = 2 * (1 - t) * t * -4 + t * t * 2;
  const y = 2 * (1 - t) * t * -34 + t * t * -62;
  const w = 8 - 2 * t;
  return `M${r1(x - w / 2)} ${r1(y)} q${r1(w / 2)} 2 ${r1(w)} 0`;
}).join(" ");

/** Drawn once in <defs> and placed with <use>: five inline copies cost 4.5K
 *  gzipped on the home page, because the markup ships twice — in the HTML
 *  and again in the route's RSC payload. */
function Palm() {
  return (
    <g id="wain-palm">
      <path d="M-4 1 Q-7.5 -34 -1 -62 L5 -62 Q-0.5 -34 4 1 Z" fill="url(#wain-trunk)" />
      <path d={TRUNK_RINGS} stroke="#5e421d" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.5" />
      {BACK_FRONDS.map((f) => (
        <FrondShape key={f.tip.join()} f={f} base="#1f6f3d" lit="#2f8a4e" />
      ))}
      {/* Dates hang under the crown, in the fronds' shade */}
      <g fill="#b8701f">
        <circle cx="-3" cy="-56" r="2.6" />
        <circle cx="2" cy="-54" r="2.6" />
        <circle cx="7" cy="-56" r="2.6" />
        <circle cx="-0.5" cy="-58.5" r="2.4" fill="#d08a2a" />
        <circle cx="4.5" cy="-58.5" r="2.4" fill="#d08a2a" />
      </g>
      {FRONT_FRONDS.map((f) => (
        <FrondShape key={f.tip.join()} f={f} base="#267943" lit="#4ba368" />
      ))}
      <circle cx="2" cy="-61" r="3.6" fill="#1b5832" />
    </g>
  );
}

const PALMS = [
  { x: 92, s: 1 },
  { x: 356, s: 0.82 },
  { x: 650, s: 0.7 },
  { x: 985, s: 0.9 },
  { x: 1156, s: 1.02 },
];

/* ---- Liberation Tower ---- */

/** Half-width of the Liberation Tower's shaft at height y, in the tower's own
 *  (pre-scale) units: 15 at the foot, 5 where it vanishes into the pods. */
const shaftHalf = (y: number) => 5 + (10 * (y - 150)) / 222;

/**
 * A drum — a pod, a deck, a collar — seen from the street, which is to say
 * LOOKED UP AT. From below, the near side of every horizontal ring is higher
 * on screen than its two ends, so the top edge bows UP over the front (the
 * same bend `TILT` gives the Kuwait Towers' rows of discs), and the underside,
 * which the eye can see because it is above it, closes the shape as a shallow
 * bowl. The pod, the concrete deck, the tier under the mast and the collar on
 * the shaft are this one shape with different numbers.
 *
 * `yTop` is where the near top edge's ellipse is centred, `h` the wall's
 * height, `rx`/`ry` the ring's half-width and its foreshortened depth.
 */
function drum(cx: number, yTop: number, h: number, rx: number, ry: number) {
  const l = r1(cx - rx);
  const r = r1(cx + rx);
  const yb = r1(yTop + h);
  /** A point on the near top edge, `deg` round from the left rim (−90) to the right (90). */
  const edge = (deg: number) => {
    const t = (deg * Math.PI) / 180;
    return `${r1(cx + rx * Math.sin(t))} ${r1(yTop - ry * Math.cos(t))}`;
  };
  return {
    cx, yb, rx, ry,
    /** The whole outline: bows up on top, and the underside bows down at the foot. */
    silhouette: `M${l} ${yTop} A${rx} ${ry} 0 0 1 ${r} ${yTop} L${r} ${yb} A${rx} ${ry} 0 0 1 ${l} ${yb} Z`,
    /** The wall alone, between the near top edge and the near bottom edge. */
    wall: `M${l} ${yTop} A${rx} ${ry} 0 0 1 ${r} ${yTop} L${r} ${yb} A${rx} ${ry} 0 0 0 ${l} ${yb} Z`,
    /** A line across the wall's middle, bowed the same way. */
    belt: (t: number) => {
      const y = r1(yTop + h * t);
      return `M${l} ${y} A${rx} ${ry} 0 0 1 ${r} ${y}`;
    },
    /** The lit part of the top edge: from the left rim to `deg`. */
    rim: (deg: number) => `M${l} ${yTop} A${rx} ${ry} 0 0 1 ${edge(deg)}`,
    /** Warm light thrown up off the ground onto the underside's shadow side. */
    bounce: `M${cx} ${r1(yb + ry)} A${rx} ${ry} 0 0 0 ${r} ${yb}`,
    /** Vertical joints between panes, closing up towards the rim as they turn away. */
    mullions: (n: number, span = 74) =>
      Array.from({ length: n }, (_, i) => {
        const t = (((-span + (2 * span * i) / (n - 1)) * Math.PI) / 180);
        const dy = ry * Math.cos(t);
        return { x: r1(cx + rx * Math.sin(t)), y1: r1(yTop - dy), y2: r1(yb - dy) };
      }),
  };
}

function LiberationTower() {
  const cx = 187;
  const pod = drum(cx, 159, 11, 26, 4.8);
  const tier = drum(cx, 148, 12, 13, 2.3);
  const deck = drum(cx, 200, 8, 20, 3.6);
  const collar = drum(cx, 238, 6.5, r1(shaftHalf(241) + 1.9), 1.7);

  // The mast: a needle from the cap down to the tip, banded red and white the
  // way an aircraft-warning mast is. It was a fat outlined wedge with a
  // bracket-shaped collar, carrying two large red balls that read as map pins.
  const TIP = 44;
  const BASE = 139.5;
  const mastHalf = (y: number) => 0.9 + (2.7 * (y - TIP)) / (BASE - TIP);
  const BANDS = 7;
  const bandY = Array.from({ length: BANDS + 1 }, (_, i) => r1(TIP + ((BASE - TIP) * i) / BANDS));
  /** A slice of the mast between two heights. `left` is where its left edge
   *  sits as a share of the half-width from the centre: −1 is the true edge,
   *  0.3 leaves only the shadow side. */
  const slice = (y0: number, y1: number, left = -1) =>
    `M${r1(cx + left * mastHalf(y0))} ${y0} L${r1(cx + mastHalf(y0))} ${y0} L${r1(cx + mastHalf(y1))} ${y1} L${r1(cx + left * mastHalf(y1))} ${y1} Z`;

  // Ends at 366, behind the podium: carried down to 372 its outline showed
  // as a bump under the podium's lower step.
  const shaft = "M172.3 366 L182 150 L192 150 L201.7 366 Z";
  const under = (d: ReturnType<typeof drum>) => (
    <ellipse cx={d.cx} cy={d.yb} rx={d.rx} ry={d.ry} />
  );
  // A band of shadow thrown down the shaft by whatever sits above it.
  const shade = (y0: number, y1: number) => (
    <path
      d={`M${r1(cx - shaftHalf(y0))} ${y0} L${r1(cx + shaftHalf(y0))} ${y0} L${r1(cx + shaftHalf(y1))} ${y1} L${r1(cx - shaftHalf(y1))} ${y1} Z`}
      fill="url(#wain-fade)"
    />
  );

  return (
    <g transform="translate(187 372) scale(1.32) translate(-187 -372)">
      {/* ---- Shaft: a round column, not a flat wedge. The old shading was a
          hard vertical stripe down the middle; this falls off smoothly to the
          shadow side, and the pour joints bow up over the front like every
          other ring on the tower. */}
      <path className="bldg" d={shaft} fill="url(#wain-shaft)" />
      <path d={shaft} fill="url(#wain-shaft-shade)" />
      {[188, 262, 287, 312, 337].map((y) => {
        const x1 = r1(cx - shaftHalf(y) + 0.9);
        const x2 = r1(cx + shaftHalf(y) - 0.9);
        return (
          <g key={y} fill="none" strokeLinecap="round">
            <path d={`M${x1} ${y} Q${cx} ${y - 2} ${x2} ${y}`} stroke="#8a6f47" strokeWidth="0.7" strokeOpacity="0.3" />
            <path d={`M${x1} ${y + 1.1} Q${cx} ${y - 0.9} ${x2} ${y + 1.1}`} stroke="#ffffff" strokeWidth="0.6" strokeOpacity="0.45" />
          </g>
        );
      })}
      <path d="M183.5 158 L175 362" stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" opacity="0.6" />

      {/* A collar part-way up: a ring that stands proud of the shaft. */}
      <path d={collar.wall} fill="url(#wain-shaft)" stroke="#c9ab72" strokeWidth="1.2" strokeLinejoin="round" />
      <g fill="url(#wain-under)" stroke="#c9ab72" strokeWidth="1" strokeOpacity="0.8">
        {under(collar)}
      </g>

      {/* What each deck throws on the shaft beneath it (light is upper left). */}
      {shade(172, 199)}
      {shade(209, 233)}

      {/* ---- Podium, in FRONT of the shaft so the tower grows out of it. It
          used to sit behind, which left two stubs poking out either side. */}
      <rect x="152" y="361" width="70" height="11" rx="3" fill="url(#wain-stone)" stroke="#c9ab72" strokeWidth="1.4" />
      <rect x="163" y="349" width="48" height="14" rx="3" fill="url(#wain-stone)" stroke="#c9ab72" strokeWidth="1.4" />
      <g fill="#dcc287" opacity="0.55">
        <rect x="171" y="353" width="5" height="6" rx="1.2" />
        <rect x="184.5" y="353" width="5" height="6" rx="1.2" />
        <rect x="198" y="353" width="5" height="6" rx="1.2" />
      </g>
      <g fill="#c9a55f" opacity="0.55">
        {[166, 187, 208].map((x) => (
          <path key={x} d={`M${x - 4} 372 v-5 a4 4 0 0 1 8 0 v5 Z`} />
        ))}
      </g>

      {/* ---- Concrete deck: the lower, smaller disc. */}
      <path d={deck.wall} fill="url(#wain-shaft)" />
      <g fill="url(#wain-under)">{under(deck)}</g>
      <g stroke="#8a6f47" strokeWidth="0.7" strokeOpacity="0.28" strokeLinecap="round">
        {deck.mullions(9).map((m) => (
          <line key={m.x} x1={m.x} y1={m.y1} x2={m.x} y2={m.y2} />
        ))}
      </g>
      <path d={deck.silhouette} fill="none" stroke="#c9ab72" strokeWidth="1.5" strokeLinejoin="round" />
      <path d={deck.rim(-12)} fill="none" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.75" strokeLinecap="round" />
      <path d={deck.bounce} fill="none" stroke="#ffd9a0" strokeWidth="0.9" strokeOpacity="0.32" strokeLinecap="round" />

      {/* ---- The top: a tier, a teal cap and the mast. */}
      <path d={tier.wall} fill="url(#wain-shaft)" />
      <path d={tier.silhouette} fill="none" stroke="#c9ab72" strokeWidth="1.3" strokeLinejoin="round" />
      <path
        d={`M${cx - 13} 148 A13 2.3 0 0 1 ${cx + 13} 148 Q${cx + 8} 145.5 ${cx + 3.6} ${BASE} L${cx - 3.6} ${BASE} Q${cx - 8} 145.5 ${cx - 13} 148 Z`}
        fill="url(#wain-deck)"
        stroke="#0f4c3d"
        strokeWidth="0.8"
        strokeOpacity="0.55"
        strokeLinejoin="round"
      />
      <path d={`M${cx - 10} 147.2 Q${cx - 6} 145.2 ${cx - 2.6} ${BASE + 2.5}`} fill="none" stroke="#d8fff3" strokeWidth="0.9" strokeOpacity="0.6" strokeLinecap="round" />

      {bandY.slice(0, -1).map((y0, i) => (
        <path key={y0} d={slice(y0, bandY[i + 1])} fill={i % 2 === 0 ? "#dc2f25" : "#fffaf0"} />
      ))}
      {/* the shadow side of the round mast */}
      {/* No \`spire\` class here: its rule sets stroke-width 2 and CSS outranks a
          presentation attribute, which is how the outline came to cover most of
          a mast only 2–7 units wide and hide the bands. */}
      <path d={slice(TIP, BASE)} fill="none" stroke="#b89a5e" strokeWidth="0.55" strokeLinejoin="round" />
      <path d={slice(TIP, BASE, 0.3)} fill="#5a3a12" opacity="0.2" />
      {/* a service platform with its lamp, two-thirds of the way up */}
      <ellipse cx={cx} cy="96" rx="4.4" ry="1.15" fill="#fffaf0" stroke="#c9ab72" strokeWidth="0.9" />
      <circle cx={cx} cy="94" r="5.5" fill="url(#wain-beacon)" />
      <circle cx={cx} cy="94.2" r="1.4" fill="#dc2f25" />
      {/* the beacon on the tip */}
      <circle cx={cx} cy="43" r="9" fill="url(#wain-beacon)" />
      <circle cx={cx} cy="43" r="2.1" fill="#dc2f25" />
      <circle cx={cx - 0.7} cy="42.2" r="0.7" fill="#ffffff" opacity="0.75" />

      {/* ---- The pod: a glass drum, teal on its lit side, deep green below. */}
      <path d={pod.wall} fill="url(#wain-glass)" />
      <g fill="url(#wain-pod-under)">{under(pod)}</g>
      <g stroke="#e6fff7" strokeWidth="0.9" strokeOpacity="0.5" strokeLinecap="round">
        {pod.mullions(13).map((m) => (
          <line key={m.x} x1={m.x} y1={m.y1} x2={m.x} y2={m.y2} />
        ))}
      </g>
      <path d={pod.belt(0.42)} fill="none" stroke="#eafff9" strokeWidth="0.8" strokeOpacity="0.38" />
      <path d={pod.silhouette} fill="none" stroke="#0f4c3d" strokeWidth="0.9" strokeOpacity="0.6" strokeLinejoin="round" />
      <path d={pod.rim(-8)} fill="none" stroke="#d8fff3" strokeWidth="1.2" strokeOpacity="0.85" strokeLinecap="round" />
      <ellipse cx={cx - 10} cy="157.6" rx="8" ry="1.5" fill="#ffffff" opacity="0.3" />
      <path d={pod.bounce} fill="none" stroke="#ffd9a0" strokeWidth="1" strokeOpacity="0.3" strokeLinecap="round" />
    </g>
  );
}

/* ---- The Gulf ---- */

/** Where sea meets sky, and where the seawall starts. The ground is at 368. */
const HORIZON = 250;
const SHORE = 361;

/** A small seeded generator: the waves must be the same on every build and
 *  every export, or the home page's HTML would differ between two builds of one
 *  commit and `generateBuildId`'s «same commit, same digest» would stop holding. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rows of ripples, one path per row. Near the horizon a row is a thin line of
 *  short, shallow dashes; towards the viewer the dashes grow longer, deeper and
 *  brighter, and the rows spread apart — the whole of the perspective the sea
 *  has. */
const WAVE_Y = [256, 263, 271, 280, 290, 301, 313, 326, 340, 353];
function waveRows() {
  const rand = rng(11);
  return WAVE_Y.map((y, i) => {
    const len = 9 + i * 2.1;
    const amp = r1(0.6 + i * 0.2);
    const gap = 40 + i * 8;
    let d = "";
    for (let x = rand() * gap - 20; x < 1200; x += len + gap * (0.55 + 0.9 * rand())) {
      d += `M${r1(x)} ${y} q${r1(len / 4)} ${-amp} ${r1(len / 2)} 0 q${r1(len / 4)} ${amp} ${r1(len / 2)} 0`;
    }
    return { y, d, w: r1(0.6 + i * 0.11), o: Math.min(0.6, r1(0.26 + i * 0.045)) };
  });
}

/** Bright glints, thickest where the sun's light would land (the sun dial sits
 *  over the middle of the sky). */
function glints() {
  const rand = rng(29);
  return Array.from({ length: 22 }, () => {
    const near = rand() < 0.6;
    const x = near ? 470 + rand() * 330 : rand() * 1200;
    const y = HORIZON + 6 + Math.pow(rand(), 1.4) * 100;
    const k = (y - HORIZON) / 110;
    return { x: r1(x), y: r1(y), rx: r1(2 + k * 4 + rand() * 1.5), ry: r1(0.45 + k * 0.5) };
  });
}

/**
 * A dhow under a lateen sail, bow to the right: raked stem, raised stern with a
 * small cabin, one slanted mast. Drawn at the waterline's centre, about 70 units
 * long at scale 1.
 */
function Dhow({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {/* its shadow on the water, and two ripples broken by the hull */}
      <ellipse cx="2" cy="7" rx="34" ry="2.4" fill="#1c6c9c" opacity="0.28" />
      <path d="M-22 10 q5 -1.6 10 0 M8 11 q6 -1.6 12 0" fill="none" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.55" strokeLinecap="round" />
      {/* sail, then the mast in front of it */}
      <path d="M6 -40 L38 -14 L-22 -9 Z" fill="url(#wain-sail)" stroke="#c9ab72" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M6 -40 L-22 -9 M6 -40 L8 -12" fill="none" stroke="#8a6f47" strokeWidth="0.7" strokeOpacity="0.32" strokeLinecap="round" />
      <path d="M-3 -4 L6 -40" stroke="#4f3015" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6 -40 l-1 -6 l8 2.4 Z" fill="#dc2f25" />
      {/* hull: a crescent with a high stern and a raked bow */}
      <path d="M-30 -8 Q4 -3 40 -16 L33 2 Q0 9 -27 3 Z" fill="url(#wain-hull)" stroke="#3b2410" strokeWidth="0.7" strokeLinejoin="round" />
      <path d="M-29 -6.6 Q4 -1.6 38 -14.4" fill="none" stroke="#e1c27e" strokeWidth="1.1" strokeLinecap="round" />
      <rect x="-30" y="-14.5" width="11" height="7" rx="1.2" fill="#6b4423" stroke="#3b2410" strokeWidth="0.6" />
      <rect x="-28.4" y="-12.6" width="3" height="3" rx="0.6" fill="#f3e2b4" opacity="0.8" />
    </g>
  );
}

/** The far shore: a low, hazy city across the water, standing on the horizon so
 *  the Gulf has another side. Mostly low blocks, with the odd slim tower. */
function farShore() {
  const rand = rng(5);
  const run = (x0: number, x1: number) => {
    let d = "";
    for (let x = x0; x < x1; ) {
      const w = 4 + rand() * 8;
      const h = rand() < 0.14 ? 15 + rand() * 9 : 3 + rand() * 9;
      d += `M${r1(x)} ${HORIZON} V${r1(HORIZON - h)} h${r1(w)} V${HORIZON} Z`;
      x += w + rand() * 3;
    }
    return d;
  };
  return run(-4, 190) + run(1000, 1204);
}

/** A crescent with its horns up, `r` across, centred on (cx, cy). */
const crescent = (cx: number, cy: number, r: number) =>
  `M${r1(cx - r)} ${cy} A${r} ${r} 0 0 0 ${r1(cx + r)} ${cy} A${r1(r * 1.35)} ${r1(r * 1.35)} 0 0 1 ${r1(cx - r)} ${cy} Z`;

/** The flag, with the ripple a cloth has: every edge shares one wave, so the bands
 *  stay parallel instead of sliding apart. */
function Flag() {
  const wave = (x: number) => 2.4 * Math.sin(((x - 2) / 54) * Math.PI * 2.1);
  const edge = (y: number, x0 = 2, x1 = 56, n = 10) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const x = x0 + ((x1 - x0) * i) / n;
      return `${r1(x)} ${r1(y + wave(x))}`;
    });
  const band = (ya: number, yb: number) => `M${edge(ya).join(" L")} L${edge(yb).reverse().join(" L")} Z`;
  return (
    <g transform="translate(548 300)">
      <rect x="-2" y="0" width="4" height="72" rx="2" fill="#8b6836" />
      <circle cx="0" cy="-1" r="2.6" fill="#e8b23a" />
      <path d={band(2, 12)} fill="#2f8a4e" />
      <path d={band(12, 22)} fill="#ffffff" />
      <path d={band(22, 32)} fill="#dc2f25" />
      <path d={`M2 ${r1(2 + wave(2))} L22 ${r1(12 + wave(22))} L22 ${r1(22 + wave(22))} L2 ${r1(32 + wave(2))} Z`} fill="#14120f" />
      {/* the light and shade a ripple throws across it */}
      <path d={band(2, 32)} fill="url(#wain-flag-shade)" />
    </g>
  );
}

/** A promenade lamp: a curved arm, a lantern and the glow round it. */
function Lamp({ x }: { x: number }) {
  return (
    <g>
      <circle cx={x + 7} cy="372" r="9" fill="url(#wain-lamp)" />
      <path d={`M${x} 396 V376 q0 -6 7 -6`} fill="none" stroke="#4e473d" strokeWidth="1.5" strokeLinecap="round" />
      <rect x={x - 3} y="394" width="6" height="3" rx="1" fill="#4e473d" />
      <ellipse cx={x + 7} cy="371" rx="2.6" ry="3.2" fill="#fff3c2" stroke="#4e473d" strokeWidth="0.8" />
    </g>
  );
}

function Sea() {
  return (
    <g>
      <rect y={HORIZON} width="1200" height={368 - HORIZON} fill="url(#wain-sea)" />
      {/* haze: the sea and the sky melt into each other at the horizon */}
      <rect y={HORIZON - 14} width="1200" height="30" fill="url(#wain-haze)" />
      <path d={`M0 ${HORIZON} H1200`} stroke="#f2fbfd" strokeWidth="1" strokeOpacity="0.9" />
      <ellipse cx="640" cy={HORIZON + 16} rx="230" ry="22" fill="url(#wain-sheen)" />
      {waveRows().map((r) => (
        <path key={r.y} d={r.d} fill="none" stroke="#ffffff" strokeWidth={r.w} strokeOpacity={r.o} strokeLinecap="round" />
      ))}
      {glints().map((g) => (
        <ellipse key={`${g.x},${g.y}`} cx={g.x} cy={g.y} rx={g.rx} ry={g.ry} fill="#ffffff" opacity="0.8" />
      ))}
      {/* One dhow close in, one far out on the horizon. The near one sits in the
          open water on the left, over the lower block: the search pill floats
          over the middle of the scene at laptop widths (the drawing is
          bottom-anchored, the pill is not), and a dhow under it loses half its
          sail. The far one is above the palm at the right edge, clear of the clock tower. */}
      <Dhow x={345} y={281} s={0.62} />
      <Dhow x={1148} y={258} s={0.28} />
      {/* the seawall: pale stone, foam where the water meets it */}
      <rect y={SHORE} width="1200" height={368 - SHORE} fill="url(#wain-wall)" />
      <path d={`M0 ${SHORE - 0.6} H1200`} stroke="#ffffff" strokeWidth="1.5" strokeOpacity="0.7" strokeDasharray="12 5 4 5" />
    </g>
  );
}

export default function KuwaitSkyline({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 -110 1200 530"
      preserveAspectRatio="xMidYMax meet"
      role="presentation"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* The grass was one flat #267943 slab, the heaviest thing in the
            drawing and it carried no light at all. Lit at the top where the
            sun reaches it, settling to the old green and then a shade deeper. */}
        <linearGradient id="wain-grass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3c9560" />
          <stop offset="35%" stopColor="#267943" />
          <stop offset="100%" stopColor="#1d6538" />
        </linearGradient>
        {/* The sky warms towards the horizon (y 250 is 68% of the way down this
            rect) instead of sitting at one cream all the way, so the sea has
            something to meet. */}
        <linearGradient id="wain-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="36%" stopColor="#fff7e8" />
          <stop offset="62%" stopColor="#fde6c0" />
          <stop offset="68%" stopColor="#f9d9a6" />
          <stop offset="100%" stopColor="#f6dfb4" />
        </linearGradient>
        <radialGradient id="wain-dawn" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ffd48a" stopOpacity="0.7" />
          <stop offset="1" stopColor="#ffd48a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wain-cloud" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#fff0da" />
        </linearGradient>
        {/* A sphere lit from the upper left: highlight, body, and a
            terminator that turns the lower right towards the sea's own
            deep blue. */}
        <radialGradient id="wain-orb" cx="50%" cy="50%" r="50%" fx="32%" fy="28%">
          <stop offset="0%" stopColor="#d6f0fb" />
          <stop offset="28%" stopColor="#7cc6ec" />
          <stop offset="65%" stopColor="#2f96d6" />
          <stop offset="100%" stopColor="#16548a" />
        </radialGradient>
        {/* A cone or cylinder across its width: lit a third of the way in,
            falling off to the shadow side. */}
        <linearGradient id="wain-shaft" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#efe0c2" />
          <stop offset="30%" stopColor="#fffdf8" />
          <stop offset="75%" stopColor="#e2cc9e" />
          <stop offset="100%" stopColor="#c9ab72" />
        </linearGradient>
        {/* A square tower: the lit front face, then a hard edge into the
            side face. */}
        <linearGradient id="wain-box" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fffdf8" />
          <stop offset="74%" stopColor="#f1e4c6" />
          <stop offset="74%" stopColor="#dcc496" />
          <stop offset="100%" stopColor="#cfb484" />
        </linearGradient>
        {/* Teal-green, not grass-green: the real Liberation Tower deck,
            mosque cap and Seif Palace roof are a patina turquoise, and a
            distinct hue keeps them from reading as more grass against the
            palms and ground below. */}
        <linearGradient id="wain-deck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6fdcc0" />
          <stop offset="55%" stopColor="#1f9678" />
          <stop offset="100%" stopColor="#0f4c3d" />
        </linearGradient>
        <linearGradient id="wain-trunk" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#9a7438" />
          <stop offset="35%" stopColor="#bb9252" />
          <stop offset="100%" stopColor="#6b4c22" />
        </linearGradient>
        <radialGradient id="wain-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fccb4d" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#fccb4d" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wain-stone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fffefb" />
          <stop offset="100%" stopColor="#e4d0a6" />
        </linearGradient>
        {/* The Liberation Tower's own gradients. */}
        <linearGradient id="wain-shaft-shade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6b4c22" stopOpacity="0" />
          <stop offset="0.5" stopColor="#6b4c22" stopOpacity="0" />
          <stop offset="1" stopColor="#6b4c22" stopOpacity="0.34" />
        </linearGradient>
        <linearGradient id="wain-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5a3a12" stopOpacity="0.42" />
          <stop offset="1" stopColor="#5a3a12" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wain-glass" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8fe9d2" />
          <stop offset="0.38" stopColor="#3dba9b" />
          <stop offset="1" stopColor="#0f6f5a" />
        </linearGradient>
        <linearGradient id="wain-pod-under" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1f8a73" />
          <stop offset="1" stopColor="#0a3a2e" />
        </linearGradient>
        <linearGradient id="wain-under" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#d9c291" />
          <stop offset="1" stopColor="#a08457" />
        </linearGradient>
        <radialGradient id="wain-beacon" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ff5a46" stopOpacity="0.6" />
          <stop offset="1" stopColor="#ff5a46" stopOpacity="0" />
        </radialGradient>
        {/* The Gulf: turquoise rather than the brand's pure sea blue, so it does
            not melt into the towers' spheres; pale at the horizon, deeper
            towards the shore. */}
        <linearGradient id="wain-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#cfeaf0" />
          <stop offset="0.12" stopColor="#a6dcea" />
          <stop offset="0.45" stopColor="#62bdda" />
          <stop offset="1" stopColor="#2f8fbf" />
        </linearGradient>
        <linearGradient id="wain-haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="wain-sheen" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#fff4cf" stopOpacity="0.8" />
          <stop offset="1" stopColor="#fff4cf" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wain-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff4d8" />
          <stop offset="0.3" stopColor="#ead9ae" />
          <stop offset="1" stopColor="#c9ab72" />
        </linearGradient>
        <linearGradient id="wain-hull" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8a5a2b" />
          <stop offset="1" stopColor="#4f3015" />
        </linearGradient>
        <linearGradient id="wain-sail" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="1" stopColor="#e6d1a4" />
        </linearGradient>
        {/* Dome: a sphere lit from the upper left, in the warm stone of everything
            else rather than the towers' blue. */}
        <radialGradient id="wain-dome" cx="50%" cy="50%" r="50%" fx="34%" fy="30%">
          <stop offset="0" stopColor="#fffdf6" />
          <stop offset="0.35" stopColor="#f3e3bd" />
          <stop offset="0.75" stopColor="#dcc287" />
          <stop offset="1" stopColor="#bb9a55" />
        </radialGradient>
        {/* Glass: a cool pane in warm stone, which the sea behind picks up. */}
        <linearGradient id="wain-window" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d6edf0" />
          <stop offset="1" stopColor="#8fc4d2" />
        </linearGradient>
        <linearGradient id="wain-paving" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7ebcb" />
          <stop offset="1" stopColor="#dcc690" />
        </linearGradient>
        <radialGradient id="wain-lamp" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#fff0b5" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff0b5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wain-flag-shade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000000" stopOpacity="0" />
          <stop offset="0.18" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="0.38" stopColor="#000000" stopOpacity="0" />
          <stop offset="0.58" stopColor="#000000" stopOpacity="0.16" />
          <stop offset="0.78" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.08" />
        </linearGradient>
        <Palm />
      </defs>

      {/* Buildings share a soft warm outline so they read against the sky */}
      <style>{`
        .bldg { stroke: #c9ab72; stroke-width: 2.5; stroke-linejoin: round; }
        .spire { stroke: #c9ab72; stroke-width: 2; stroke-linejoin: round; }
        .orb { stroke: #1f7fb8; stroke-width: 2.5; }
      `}</style>

      {/* Sky */}
      <rect y="-110" width="1200" height="530" fill="url(#wain-sky)" />
      <circle cx="640" cy="190" r="330" fill="url(#wain-glow)" />
      {/* The warm band the sun leaves along the horizon, and thin streaks of
          high cloud lying in it. */}
      <ellipse cx="640" cy="246" rx="540" ry="56" fill="url(#wain-dawn)" />
      <g fill="#ffffff">
        <ellipse cx="240" cy="226" rx="120" ry="2.6" opacity="0.5" />
        <ellipse cx="985" cy="220" rx="150" ry="3" opacity="0.45" />
        <ellipse cx="660" cy="236" rx="90" ry="2" opacity="0.4" />
      </g>

      {/* Clouds and birds sit in the sky that was added above the old top edge,
          so the taller towers do not stand in front of them */}
      <g transform="translate(0 -70)">
      {/* Each puff is lit from above and goes to cream underneath, and the cloud
          has a faint warm shadow under it, so they read as volumes and not as
          white ovals. */}
      <g className="animate-drift" fill="url(#wain-cloud)" opacity="0.95">
        <g>
          <ellipse cx="150" cy="88" rx="66" ry="6" fill="#f0c58a" opacity="0.16" />
          <ellipse cx="150" cy="70" rx="52" ry="24" />
          <ellipse cx="196" cy="74" rx="34" ry="18" />
          <ellipse cx="110" cy="78" rx="30" ry="16" />
        </g>
        <g opacity="0.8">
          <ellipse cx="1031" cy="74" rx="52" ry="5" fill="#f0c58a" opacity="0.16" />
          <ellipse cx="1010" cy="58" rx="46" ry="21" />
          <ellipse cx="1052" cy="63" rx="30" ry="15" />
        </g>
        <g opacity="0.65">
          <ellipse cx="716" cy="55" rx="42" ry="4.5" fill="#f0c58a" opacity="0.16" />
          <ellipse cx="700" cy="42" rx="38" ry="17" />
          <ellipse cx="732" cy="46" rx="24" ry="12" />
        </g>
      </g>

      {/* Birds. At x 880–940 they flew through the second tower's tip once
          the towers moved right; this is the open sky beside the clock tower. */}
      <g
        stroke="#4e483f"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.55"
      >
        <path d="M1010 96 q9 -8 18 0" />
        <path d="M1034 82 q8 -7 16 0" />
        <path d="M1056 100 q7 -6 14 0" />
      </g>
      </g>

      {/* The Gulf, behind everything that stands on the shore: it shows above the
          low buildings and in every gap between the towers, which is how the
          real Kuwait Towers are seen. Inside the drawing's own 1200×530 — the
          home page and the Flutter hero both hard-code that ratio. */}
      <Sea />
      <path d={farShore()} fill="#9cc3d3" opacity="0.5" />

      {/* ---- Skyline ---- */}

      {/* Liberation Tower. Drawn by `LiberationTower` above: a podium, a shaded
          round shaft, a concrete deck, the teal glass pod and a banded mast —
          every ring seen from street level, so each one bows up over the front
          like the Kuwait Towers' rows of discs. Scaled 1.32× about the middle
          of its base inside the component, not stretched: a taller tower with
          the same width reads as a needle, and a uniform scale keeps the pods
          round. */}
      <LiberationTower />

      {/* Low city blocks, left: a lit front and a shaded side (`wain-box`), a
          cornice, glass in the windows, and a water tank on the roof. */}
      <g>
        <rect className="bldg" x="238" y="286" width="70" height="86" rx="6" fill="url(#wain-box)" />
        <rect x="235" y="283" width="76" height="6" rx="2.4" fill="#ecdcb4" stroke="#c9ab72" strokeWidth="1" />
        <rect x="289" y="276" width="11" height="8" rx="1.6" fill="#d9c192" stroke="#c9ab72" strokeWidth="0.8" />
        <rect className="bldg" x="316" y="312" width="52" height="60" rx="6" fill="url(#wain-box)" />
        <rect x="313" y="309" width="58" height="5" rx="2" fill="#ecdcb4" stroke="#c9ab72" strokeWidth="1" />
        <g fill="url(#wain-window)" stroke="#fff6df" strokeWidth="0.8">
          {[250, 268, 286].flatMap((x) => [300, 326].map((y) => <rect key={`${x},${y}`} x={x} y={y} width="10" height="12" rx="2" />))}
          {[326, 346].flatMap((x) => [326, 346].map((y) => <rect key={`${x},${y}`} x={x} y={y} width="9" height="11" rx="2" />))}
        </g>
      </g>

      {/* Grand Mosque. A main dome with ribs, a lantern and a crescent, a small
          dome at each end, five arches with a recess behind each, and the
          minaret at the LEFT end. It stood at the right, directly behind the
          sun dial and the search pill at laptop widths, so its teal cap
          poked out from under them. */}
      <g>
        {/* the end domes, behind the big one */}
        {[421, 555].map((x) => (
          <g key={x}>
            <path d={`M${x - 14} 292 a14 14 0 0 1 28 0 Z`} fill="url(#wain-dome)" stroke="#c9ab72" strokeWidth="1.6" strokeLinejoin="round" />
            <path d={`M${x} 278 v-5`} stroke="#c9a55f" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx={x} cy="272" r="1.7" fill="#e8b23a" />
          </g>
        ))}
        <rect className="bldg" x="404" y="292" width="168" height="80" rx="8" fill="url(#wain-stone)" />
        <rect x="404" y="292" width="168" height="80" rx="8" fill="url(#wain-shaft-shade)" />
        <rect x="406" y="292" width="164" height="7" rx="3" fill="#e6d3a6" opacity="0.75" />
        {/* the main dome */}
        <path className="bldg" d="M488 208 q52 26 52 84 h-104 q0 -58 52 -84 Z" fill="url(#wain-dome)" />
        <g fill="none" stroke="#b99a63" strokeWidth="0.9" strokeOpacity="0.32" strokeLinecap="round">
          {[-34, -17, 17, 34].map((dx) => (
            <path key={dx} d={`M${488 + dx} 292 Q${r1(488 + dx * 1.18)} 240 488 211`} />
          ))}
        </g>
        <ellipse cx="468" cy="246" rx="11" ry="22" transform="rotate(-18 468 246)" fill="#ffffff" opacity="0.32" />
        <rect x="485" y="196" width="6" height="12" rx="2" fill="url(#wain-shaft)" stroke="#c9a55f" strokeWidth="0.8" />
        <path d="M488 196 v-9" stroke="#c9a55f" strokeWidth="1.6" strokeLinecap="round" />
        <path d={crescent(488, 184, 6)} fill="#e8b23a" stroke="#b8862a" strokeWidth="0.5" strokeLinejoin="round" />
        {/* windows over the arches, then the arches with their recesses */}
        <g fill="url(#wain-window)" stroke="#d9c192" strokeWidth="0.7">
          {[422, 449, 476, 503, 530].map((x) => (
            <path key={x} d={`M${x - 3} 320 v-9 a3 3 0 0 1 6 0 v9 Z`} />
          ))}
        </g>
        {[422, 449, 476, 503, 530].map((x) => (
          <g key={x}>
            <path d={`M${x - 9} 372 v-34 a9 9 0 0 1 18 0 v34 Z`} fill="#f6ecd4" stroke="#d3b97f" strokeWidth="1" />
            <path d={`M${x - 6} 372 v-31 a6 6 0 0 1 12 0 v31 Z`} fill="#d9c192" opacity="0.55" />
          </g>
        ))}
        {/* the minaret: a shaft, two balconies, slits, a teal roof and a crescent */}
        <rect className="bldg" x="382" y="176" width="18" height="196" rx="5" fill="url(#wain-shaft)" />
        <rect x="379" y="204" width="24" height="7" rx="3.5" fill="url(#wain-shaft)" stroke="#c9ab72" strokeWidth="1" />
        <rect x="380" y="238" width="22" height="5" rx="2.5" fill="url(#wain-shaft)" stroke="#c9ab72" strokeWidth="1" />
        <g fill="#b99a63" opacity="0.5">
          <rect x="389.5" y="250" width="3" height="14" rx="1.5" />
          <rect x="389.5" y="276" width="3" height="14" rx="1.5" />
          <rect x="389.5" y="214" width="3" height="16" rx="1.5" />
        </g>
        <path d="M382 176 h9 v-22 Z" fill="#2a9c7c" />
        <path d="M391 154 v22 h9 Z" fill="#146151" />
        <path d="M391 154 v-7" stroke="#c9a55f" strokeWidth="1.5" strokeLinecap="round" />
        <path d={crescent(391, 143, 5.2)} fill="#e8b23a" stroke="#b8862a" strokeWidth="0.5" strokeLinejoin="round" />
      </g>

      {/* Low block, right. Drawn BEFORE the towers: the towers sit 120 units
          further right than they used to (see below) and the third spire now
          stands in front of this block instead of beside it. */}
      <g>
        <rect className="bldg" x="900" y="300" width="76" height="72" rx="6" fill="url(#wain-box)" />
        <rect x="897" y="297" width="82" height="6" rx="2.4" fill="#ecdcb4" stroke="#c9ab72" strokeWidth="1" />
        <g fill="url(#wain-window)" stroke="#fff6df" strokeWidth="0.8">
          {[914, 932, 950].flatMap((x) => [314, 338].map((y) => <rect key={`${x},${y}`} x={x} y={y} width="10" height="12" rx="2" />))}
        </g>
      </g>

      {/* Kuwait Towers. Moved 120 units right (the first `translate`) so the
          big sphere is no longer behind the sun dial on a wide screen: the
          dial is centred, and at the old position it covered the main
          tower's two spheres and the search pill sat on its shaft. Everything
          to their right was kept clear of the move — the block above is
          drawn first, and two palms below were nudged off the spires.
          Scaled 1.33× about the group's own middle, so the
          three keep their spacing and the spheres stay round; the drawing's
          canvas grew upward by 110 units for exactly this — the main tip
          would be at y −77 in it. Everything below is in the old, unscaled
          coordinates. Each shaft has a lit edge and a shaded one, a collar
          where it meets a sphere, a plinth to stand on, and a small gold
          finial with a glow, which is what the real spires carry. */}
      <g transform="translate(866 372) scale(1.33) translate(-746 -372)">
        {/* Plinths, behind the shafts */}
        <g fill="url(#wain-stone)" stroke="#c9ab72" strokeWidth="1.4">
          <rect x="662" y="361" width="44" height="11" rx="3" />
          <rect x="740" y="363" width="34" height="9" rx="3" />
          <rect x="800" y="364" width="30" height="8" rx="3" />
        </g>

        {/* Third, bare spire */}
        <path className="bldg" d="M804 372 L812 150 L818 150 L826 372 Z" fill="url(#wain-shaft)" />
        <path d="M815 150 L818 150 L826 372 L815 372 Z" fill="#8a6f47" opacity="0.18" />
        <path className="spire" d="M812 150 L815 96 L818 150 Z" fill="url(#wain-shaft)" />
        <circle cx="815" cy="96" r="6" fill="#fccb4d" opacity="0.4" />
        <circle cx="815" cy="96" r="2.2" fill="#e8b23a" />

        {/* Second tower, one sphere */}
        <path className="bldg" d="M744 372 L753 172 L761 172 L770 372 Z" fill="url(#wain-shaft)" />
        <path d="M757 172 L761 172 L770 372 L757 372 Z" fill="#8a6f47" opacity="0.2" />
        <path d="M754.5 226 L746.5 366" stroke="#ffffff" strokeWidth="1.1" strokeLinecap="round" opacity="0.6" />
        <path className="spire" d="M753 172 L757 104 L761 172 Z" fill="url(#wain-shaft)" />
        <circle cx="757" cy="104" r="7" fill="#fccb4d" opacity="0.4" />
        <circle cx="757" cy="104" r="2.4" fill="#e8b23a" />
        <ellipse cx="757" cy="224" rx="9" ry="3" fill="#8a6f47" opacity="0.5" />
        <Orb cx={757} cy={196} r={30} lats={[-52, -24, 4, 32]} perRow={6} span={66} d={2.9} />

        {/* Main tower, two spheres */}
        <path className="bldg" d="M666 372 L678 130 L690 130 L702 372 Z" fill="url(#wain-shaft)" />
        <path d="M684 130 L690 130 L702 372 L684 372 Z" fill="#8a6f47" opacity="0.2" />
        <path d="M680.5 226 L668.5 366" stroke="#ffffff" strokeWidth="1.3" strokeLinecap="round" opacity="0.65" />
        <path className="spire" d="M678 130 L684 34 L690 130 Z" fill="url(#wain-shaft)" />
        <circle cx="684" cy="34" r="8" fill="#fccb4d" opacity="0.4" />
        <circle cx="684" cy="34" r="2.8" fill="#e8b23a" />
        {/* The restaurant sphere hangs on a short neck, with a collar */}
        <ellipse cx="684" cy="118" rx="9" ry="3" fill="#8a6f47" opacity="0.5" />
        <Orb cx={684} cy={96} r={22} lats={[-42, -8, 26]} perRow={5} span={62} d={2.5} />
        <ellipse cx="684" cy="221" rx="13" ry="4" fill="#8a6f47" opacity="0.5" />
        <Orb cx={684} cy={176} r={46} lats={[-58, -34, -10, 14, 38]} perRow={8} span={70} d={3.6} />
      </g>

      {/* Seif Palace clock tower */}
      <g>
        <rect className="bldg" x="1006" y="252" width="86" height="120" rx="7" fill="url(#wain-box)" />
        <rect className="bldg" x="1028" y="180" width="42" height="76" rx="6" fill="url(#wain-box)" />
        <rect x="1003" y="249" width="92" height="6" rx="2.4" fill="#ecdcb4" stroke="#c9ab72" strokeWidth="1" />
        <rect x="1025" y="177" width="48" height="5" rx="2" fill="#ecdcb4" stroke="#c9ab72" strokeWidth="1" />
        <path d="M1028 180 h21 v-40 Z" fill="#2a9c7c" />
        <path d="M1049 140 v40 h21 Z" fill="#146151" />
        <path d="M1049 140 v-8" stroke="#c9a55f" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="1049" cy="130" r="2.4" fill="#e8b23a" />
        <circle cx="1049" cy="212" r="14" fill="#faf4e6" stroke="#c9a55f" strokeWidth="3" />
        <path d="M1049 200.5 v3 M1049 220.5 v3 M1037.5 212 h3 M1057.5 212 h3" stroke="#35302a" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
        <path
          d="M1049 212 v-8 M1049 212 h6"
          stroke="#35302a"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <g fill="url(#wain-window)" stroke="#fff6df" strokeWidth="0.8">
          {[1018, 1044, 1070].map((x) => (
            <rect key={x} x={x} y="266" width="9" height="16" rx="2.4" />
          ))}
        </g>
        <g fill="#f3e7d0">
          <path d="M1020 372 v-42 a11 11 0 0 1 22 0 v42 Z" />
          <path d="M1056 372 v-42 a11 11 0 0 1 22 0 v42 Z" />
        </g>
      </g>

      {/* Palms */}
      {PALMS.map(({ x, s }) => (
        <use key={x} href="#wain-palm" transform={`translate(${x} 372) scale(${s})`} />
      ))}

      {/* Ground. It was one flat green slab across the whole foot of the
          drawing. Now a lawn where the buildings and palms stand, a pale
          promenade with a lamp every so often, and a darker lawn in front —
          the same 52 units, but with something to look at in them. */}
      <rect y="368" width="1200" height="52" fill="url(#wain-grass)" />
      <rect y="368" width="1200" height="9" fill="#4ba368" />
      <rect y="390" width="1200" height="12" fill="url(#wain-paving)" />
      <path d="M0 390.6 H1200" stroke="#fff8e6" strokeWidth="1.2" strokeOpacity="0.9" />
      <path d="M0 402 H1200" stroke="#a88a50" strokeWidth="1" strokeOpacity="0.5" />
      <path
        d={Array.from({ length: 32 }, (_, i) => {
          const x = 14 + i * 38;
          return `M${x} 390 l${r1((x - 600) * 0.004)} 12`;
        }).join("")}
        stroke="#b99a63"
        strokeWidth="0.6"
        strokeOpacity="0.4"
        fill="none"
      />

      {/* Contact shadows, thrown to the right by the upper-left light, so
          nothing stands on the grass without touching it. */}
      <g fill="#1b5832" opacity="0.32">
        <ellipse cx="205" cy="371" rx="40" ry="4" />
        <ellipse cx="312" cy="371" rx="70" ry="3.5" />
        <ellipse cx="500" cy="371" rx="92" ry="3.5" />
        <ellipse cx="600" cy="371" rx="14" ry="3" />
        <ellipse cx="890" cy="371" rx="118" ry="4.5" />
        <ellipse cx="946" cy="371" rx="42" ry="3.5" />
        <ellipse cx="1062" cy="371" rx="54" ry="4" />
        {PALMS.map((p) => (
          <ellipse key={p.x} cx={r1(p.x + 10 * p.s)} cy="371" rx={r1(20 * p.s)} ry="3" />
        ))}
      </g>

      {[28, 196, 380, 596, 792, 1002, 1168].map((x) => (
        <Lamp key={x} x={x} />
      ))}

      <Flag />
    </svg>
  );
}
