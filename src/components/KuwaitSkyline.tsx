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

function Orb(p: { cx: number; cy: number; r: number; lats: number[]; perRow: number; span: number; d: number }) {
  const { cx, cy, r } = p;
  const hx = r1(cx - 0.36 * r);
  const hy = r1(cy - 0.42 * r);
  return (
    <g>
      <circle className="orb" cx={cx} cy={cy} r={r} fill="url(#wain-orb)" />
      {sequins(cx, cy, r, p.lats, p.perRow, p.span, p.d).map((s) => (
        <ellipse key={`${s.x},${s.y}`} cx={s.x} cy={s.y} rx={s.rx} ry={s.ry} fill="#ffffff" fillOpacity={s.o} />
      ))}
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
  { x: 620, s: 0.7 },
  { x: 862, s: 0.9 },
  { x: 1156, s: 1.02 },
];

export default function KuwaitSkyline({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 420"
      preserveAspectRatio="xMidYMax meet"
      role="presentation"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="wain-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="45%" stopColor="#fbeed6" />
          <stop offset="100%" stopColor="#f6dfb4" />
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
        <Palm />
      </defs>

      {/* Buildings share a soft warm outline so they read against the sky */}
      <style>{`
        .bldg { stroke: #c9ab72; stroke-width: 2.5; stroke-linejoin: round; }
        .spire { stroke: #c9ab72; stroke-width: 2; stroke-linejoin: round; }
        .orb { stroke: #1f7fb8; stroke-width: 2.5; }
      `}</style>

      {/* Sky */}
      <rect width="1200" height="420" fill="url(#wain-sky)" />
      <circle cx="600" cy="250" r="300" fill="url(#wain-glow)" />

      {/* Clouds */}
      <g className="animate-drift" fill="#ffffff" opacity="0.9">
        <g>
          <ellipse cx="150" cy="70" rx="52" ry="24" />
          <ellipse cx="196" cy="74" rx="34" ry="18" />
          <ellipse cx="110" cy="78" rx="30" ry="16" />
        </g>
        <g opacity="0.75">
          <ellipse cx="1010" cy="58" rx="46" ry="21" />
          <ellipse cx="1052" cy="63" rx="30" ry="15" />
        </g>
        <g opacity="0.6">
          <ellipse cx="700" cy="42" rx="38" ry="17" />
          <ellipse cx="732" cy="46" rx="24" ry="12" />
        </g>
      </g>

      {/* Birds */}
      <g
        stroke="#4e483f"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.55"
      >
        <path d="M880 96 q9 -8 18 0" />
        <path d="M904 82 q8 -7 16 0" />
        <path d="M926 100 q7 -6 14 0" />
      </g>

      {/* ---- Skyline ---- */}

      {/* Liberation Tower. Two saucers, and only the upper one read as an
          object — it had a lip and a highlight, the lower one was a flat
          ellipse glued to the shaft. A dark lip drawn behind each disc, then
          the disc, then a highlight on top is the same "standing in the sun"
          logic the towers' Orbs use below, sized down to a flat saucer
          rather than a sphere; the second light on the mast is because a
          shaft this tall carries more than one aircraft warning lamp. */}
      <g>
        <path className="bldg" d="M172 372 L182 150 L192 150 L202 372 Z" fill="url(#wain-shaft)" />
        <path className="spire" d="M182 150 L187 44 L192 150 Z" fill="url(#wain-shaft)" />
        <circle cx="187" cy="94" r="3" fill="#dc2f25" />
        <circle cx="186.2" cy="93.2" r="1" fill="#ffffff" opacity="0.6" />
        <circle cx="187" cy="40" r="5" fill="#dc2f25" />
        <circle cx="185.4" cy="38.4" r="1.6" fill="#ffffff" opacity="0.7" />
        <ellipse cx="187" cy="171" rx="25" ry="7" fill="#0f4c3d" opacity="0.5" />
        <ellipse cx="187" cy="168" rx="26" ry="11" fill="url(#wain-deck)" />
        <ellipse cx="181" cy="163.5" rx="11" ry="2.6" fill="#ffffff" opacity="0.28" />
        <ellipse cx="187" cy="209" rx="19" ry="6" fill="#8a6f47" opacity="0.35" />
        <ellipse cx="187" cy="206" rx="20" ry="9" fill="url(#wain-shaft)" />
        <ellipse cx="182" cy="202.5" rx="8" ry="2" fill="#ffffff" opacity="0.3" />
        <rect x="176" y="240" width="22" height="8" rx="4" fill="url(#wain-shaft)" />
      </g>

      {/* Low city block, left */}
      <g fill="url(#wain-stone)">
        <rect className="bldg" x="238" y="286" width="70" height="86" rx="6" />
        <rect className="bldg" x="316" y="312" width="52" height="60" rx="6" />
      </g>
      <g fill="#dcc287" opacity="0.5">
        <rect x="250" y="300" width="10" height="12" rx="2" />
        <rect x="268" y="300" width="10" height="12" rx="2" />
        <rect x="286" y="300" width="10" height="12" rx="2" />
        <rect x="250" y="326" width="10" height="12" rx="2" />
        <rect x="268" y="326" width="10" height="12" rx="2" />
        <rect x="286" y="326" width="10" height="12" rx="2" />
      </g>

      {/* Grand Mosque */}
      <g>
        <rect className="bldg" x="404" y="292" width="168" height="80" rx="8" fill="url(#wain-stone)" />
        <path className="bldg" d="M488 208 q52 26 52 84 h-104 q0 -58 52 -84 Z" fill="#ecd9b0" />
        <circle cx="488" cy="204" r="7" fill="#c9a55f" />
        <path d="M488 197 v-12" stroke="#c9a55f" strokeWidth="3" strokeLinecap="round" />
        {/* Minaret */}
        <rect className="bldg" x="586" y="176" width="18" height="196" rx="5" fill="url(#wain-shaft)" />
        <path d="M586 176 h9 v-22 Z" fill="#2a9c7c" />
        <path d="M595 154 v22 h9 Z" fill="#146151" />
        <rect x="583" y="212" width="24" height="7" rx="3.5" fill="url(#wain-shaft)" />
        {/* Arches */}
        <g fill="#f3e7d0">
          <path d="M424 372 v-38 a12 12 0 0 1 24 0 v38 Z" />
          <path d="M466 372 v-38 a12 12 0 0 1 24 0 v38 Z" />
          <path d="M508 372 v-38 a12 12 0 0 1 24 0 v38 Z" />
        </g>
      </g>

      {/* Kuwait Towers */}
      <g>
        {/* Third, bare spire */}
        <path className="bldg" d="M804 372 L812 150 L818 150 L826 372 Z" fill="url(#wain-shaft)" />
        <path className="spire" d="M812 150 L815 96 L818 150 Z" fill="url(#wain-shaft)" />

        {/* Second tower, one sphere */}
        <path className="bldg" d="M744 372 L753 172 L761 172 L770 372 Z" fill="url(#wain-shaft)" />
        <path className="spire" d="M753 172 L757 104 L761 172 Z" fill="url(#wain-shaft)" />
        <Orb cx={757} cy={196} r={30} lats={[-52, -24, 4, 32]} perRow={6} span={66} d={2.9} />

        {/* Main tower, two spheres */}
        <path className="bldg" d="M666 372 L678 130 L690 130 L702 372 Z" fill="url(#wain-shaft)" />
        <path className="spire" d="M678 130 L684 34 L690 130 Z" fill="url(#wain-shaft)" />
        <Orb cx={684} cy={96} r={22} lats={[-42, -8, 26]} perRow={5} span={62} d={2.5} />
        <Orb cx={684} cy={176} r={46} lats={[-58, -34, -10, 14, 38]} perRow={8} span={70} d={3.6} />
      </g>

      {/* Seif Palace clock tower */}
      <g>
        <rect className="bldg" x="1006" y="252" width="86" height="120" rx="7" fill="url(#wain-box)" />
        <rect className="bldg" x="1028" y="180" width="42" height="76" rx="6" fill="url(#wain-box)" />
        <path d="M1028 180 h21 v-40 Z" fill="#2a9c7c" />
        <path d="M1049 140 v40 h21 Z" fill="#146151" />
        <circle cx="1049" cy="212" r="14" fill="#faf4e6" stroke="#c9a55f" strokeWidth="3" />
        <path
          d="M1049 212 v-8 M1049 212 h6"
          stroke="#35302a"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <g fill="#f3e7d0">
          <path d="M1020 372 v-42 a11 11 0 0 1 22 0 v42 Z" />
          <path d="M1056 372 v-42 a11 11 0 0 1 22 0 v42 Z" />
        </g>
      </g>

      {/* Low block, right */}
      <g fill="url(#wain-stone)">
        <rect className="bldg" x="900" y="300" width="76" height="72" rx="6" />
      </g>
      <g fill="#dcc287" opacity="0.45">
        <rect x="914" y="314" width="10" height="12" rx="2" />
        <rect x="932" y="314" width="10" height="12" rx="2" />
        <rect x="950" y="314" width="10" height="12" rx="2" />
      </g>

      {/* Palms */}
      {PALMS.map(({ x, s }) => (
        <use key={x} href="#wain-palm" transform={`translate(${x} 372) scale(${s})`} />
      ))}

      {/* Ground */}
      <rect y="368" width="1200" height="52" fill="#267943" />
      <rect y="368" width="1200" height="9" fill="#4ba368" />

      {/* Contact shadows, thrown to the right by the upper-left light, so
          nothing stands on the grass without touching it. */}
      <g fill="#1b5832" opacity="0.32">
        <ellipse cx="200" cy="371" rx="30" ry="3.5" />
        <ellipse cx="312" cy="371" rx="70" ry="3.5" />
        <ellipse cx="500" cy="371" rx="92" ry="3.5" />
        <ellipse cx="600" cy="371" rx="14" ry="3" />
        <ellipse cx="764" cy="371" rx="88" ry="4" />
        <ellipse cx="946" cy="371" rx="42" ry="3.5" />
        <ellipse cx="1062" cy="371" rx="54" ry="4" />
        {PALMS.map((p) => (
          <ellipse key={p.x} cx={r1(p.x + 10 * p.s)} cy="371" rx={r1(20 * p.s)} ry="3" />
        ))}
      </g>

      {/* Kuwait flag */}
      <g transform="translate(548 300)">
        <rect x="-2" y="0" width="4" height="72" rx="2" fill="#8b6836" />
        <g>
          <rect x="2" y="2" width="54" height="10" fill="#2f8a4e" />
          <rect x="2" y="12" width="54" height="10" fill="#ffffff" />
          <rect x="2" y="22" width="54" height="10" fill="#dc2f25" />
          <path d="M2 2 L22 12 L22 22 L2 32 Z" fill="#14120f" />
        </g>
      </g>
    </svg>
  );
}
