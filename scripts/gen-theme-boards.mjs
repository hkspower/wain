#!/usr/bin/env node
/**
 * The theme, as canvas artboards:  npm run design:boards
 *
 * Writes design/Palette.dc.html, design/Type.dc.html and design/Surfaces.dc.html
 * — the three boards a logo has to be designed against — straight from
 * `src/app/theme.css` and `src/components/WainLogo.tsx`.
 *
 * GENERATED, for the reason gen-design-system.mjs already gives about the icon
 * set: a specification that is a hand-copy goes on looking authoritative after
 * it stops being true. This repository has now been bitten by that twice in one
 * day — `design/canvas.json` claimed the canvas mark was the component's when
 * its «؟» had been quietly redrawn, and `PlaceArt.tsx` carried a measured safe
 * box for a hero size that no longer existed. Ninety hex values retyped into an
 * artboard would be the third.
 *
 * So these three boards trace real values and nothing else. The four hand-drawn
 * boards beside them — Main, AppMark, Mono, Placements — are design work and
 * stay hand-written; this script never touches them.
 *
 *   --check   compare only, write nothing, exit 1 if the boards are stale.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// theme.css holds the whole @theme block — colours through shadows — split
// out of globals.css. This script only ever wanted tokens, so it reads the
// file that is now only tokens.
const CSS = readFileSync(join(ROOT, "src/app/theme.css"), "utf8");
const LOGO = readFileSync(join(ROOT, "src/components/WainLogo.tsx"), "utf8");
const CHECK = process.argv.includes("--check");

/* ── read the tokens ─────────────────────────────────────────────────────── */

const tokens = new Map();
for (const m of CSS.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gim)) {
  tokens.set(m[1], m[2].trim());
}
const colour = (name) => {
  const v = tokens.get(`color-${name}`);
  if (!v) throw new Error(`gen-theme-boards: --color-${name} is gone from theme.css`);
  return v.replace(/\/\*.*$/, "").trim();
};

/** Ramps in the order the site thinks about them, not alphabetically. */
const RAMPS = [
  { id: "sand", note: "paper and the warm neutrals", steps: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { id: "sea", note: "Kuwait's water — the mark's blue", steps: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] },
  { id: "sun", note: "heat and the dial; kept OUT of the mark", steps: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { id: "coral", note: "the ؟ and every call to act", steps: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { id: "palm", note: "green, used sparingly — status and outdoors", steps: [400, 500, 600, 700, 800] },
  { id: "ink", note: "type, from hint to headline", steps: [400, 500, 600, 700, 800, 900] },
];

/** The eight category grounds a mark has to survive being placed on. */
const CATEGORIES = [
  ["landmarks", "معالم"], ["restaurants", "مطاعم"], ["fastfood", "وجبات سريعة"],
  ["coffee", "قهوة"], ["outdoors", "شواطئ وحدائق"], ["shopping", "تسوّق"],
  ["culture", "ثقافة"], ["family", "عائلة"],
];

/** The type scale, px and leading, as the site declares it. */
const REM = 16;
const px = (v) => Math.round(parseFloat(v) * (v.includes("rem") ? REM : 1));
const STEPS = ["2xs", "xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"];
const DEFAULT_PX = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20 };
const scale = STEPS.map((s) => ({
  name: s,
  size: tokens.has(`text-${s}`) ? px(tokens.get(`text-${s}`)) : DEFAULT_PX[s],
  leading: tokens.get(`text-${s}--line-height`) ?? "—",
}));

/* ── the mark, lifted from the component rather than retyped ─────────────── */

const grab = (re, what) => {
  const m = LOGO.match(re);
  if (!m) throw new Error(`gen-theme-boards: could not find ${what} in WainLogo.tsx`);
  return m[1];
};
const MARK = {
  viewBox: grab(/viewBox="([^"]+)"/, "the viewBox"),
  kuwait: grab(/d="(M 31 24[^"]+)"/, "the Kuwait path"),
  pin: grab(/d="(M 58 54\.5[^"]+)"/, "the pin path"),
  glyphT: grab(/transform="(translate\(58 [^"]+)"/, "the ؟ transform"),
  glyph: grab(/d="(M -4\.4[^"]+)"/, "the ؟ arc"),
};

/** Flat-fill mark at a given size, on whatever ground it is dropped onto. */
const mark = (size, sea, coral, keyline) => `<svg viewBox="${MARK.viewBox}" style="width:${size}px;height:${Math.round(size * 92 / 84)}px;flex:none" aria-hidden="true">
        <path d="${MARK.kuwait}" fill="${sea}" stroke="${keyline}" stroke-width="3.5" stroke-linejoin="round"></path>
        <path d="${MARK.pin}" fill="${coral}" stroke="${keyline}" stroke-width="3.5" stroke-linejoin="round"></path>
        <g transform="${MARK.glyphT}" fill="none" stroke="${keyline}" stroke-width="3" stroke-linecap="round"><path d="${MARK.glyph}"></path></g>
        <circle cx="58" cy="36.8" r="2" fill="${keyline}"></circle>
      </svg>`;

/* ── the boards ──────────────────────────────────────────────────────────── */

const HEAD = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap">
  <style>
    body { margin: 0; font-family: "IBM Plex Sans Arabic", system-ui, sans-serif; }
    .lbl { font-size: 12px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: ${colour("ink-400")}; }
    .cap { font-size: 13px; color: ${colour("ink-500")}; line-height: 1.6; }
    .hex { font-size: 9px; color: ${colour("ink-400")}; font-variant-numeric: tabular-nums; }
  </style>
</helmet>
`;
const FOOT = `</x-dc>
<script data-dc-script data-props='{}'>
class Component extends DCLogic {
  renderVals() { return {}; }
}
</script>
</body>
</html>
`;
const sheet = (w, h, inner) =>
  `${HEAD}
<div style="width:${w}px; height:${h}px; background:${colour("sand-50")}; box-sizing:border-box; padding:48px 56px; display:flex; flex-direction:column; gap:26px;">
${inner}
</div>
${FOOT}`;

const heading = (label, line) =>
  `  <div style="display:flex; flex-direction:column; gap:8px;">
    <span class="lbl">${label}</span>
    <span class="cap" style="max-width:62ch;">${line}</span>
  </div>`;

/* Palette ------------------------------------------------------------------ */
const palette = sheet(1180, 870,
  [heading("Palette · مسمّيات الألوان",
    "Every value below is read from <code>theme.css</code> at generation time — these are the site's tokens, not an approximation of them. A mark may use sea and coral; sun is the dial's and stays out of it."),
   `  <div style="display:flex; flex-direction:column; gap:18px;">`,
   ...RAMPS.map((r) => `    <div style="display:flex; align-items:center; gap:18px;">
      <div style="width:150px; flex:none;">
        <div style="font-size:14px; font-weight:700; color:${colour("ink-800")};">${r.id}</div>
        <div class="cap" style="font-size:11px;">${r.note}</div>
      </div>
      <div style="display:flex; gap:6px;">
${r.steps.map((s) => `        <div style="display:flex; flex-direction:column; gap:5px; align-items:center;">
          <span style="width:62px; height:44px; border-radius:10px; background:${colour(`${r.id}-${s}`)}; border:1px solid ${colour("line")};"></span>
          <span class="hex">${s}</span>
          <span class="hex">${colour(`${r.id}-${s}`)}</span>
        </div>`).join("\n")}
      </div>
    </div>`),
   `  </div>`,
   `  <div style="display:flex; gap:18px; align-items:center; border-top:1px solid ${colour("line")}; padding-top:18px;">
    <span class="lbl" style="width:150px; flex:none;">hairlines</span>
${["line", "line-strong", "line-control"].map((n) => `    <div style="display:flex; align-items:center; gap:8px;">
      <span style="width:44px; height:24px; border-radius:7px; background:${colour(n)};"></span>
      <span class="hex">${n} ${colour(n)}</span>
    </div>`).join("\n")}
  </div>`,
  ].join("\n"));

/* Type --------------------------------------------------------------------- */
const type = sheet(940, 800,
  [heading("Type · IBM Plex Sans Arabic",
    "Weight 400 is <code>IBMPlexSansArabic</code> with no <code>-Regular</code> suffix; every other weight is <code>Family-Style</code>. Three floors are enforced by audit: text never below 11px, tap targets never below 44px, fields never below 16px."),
   `  <div style="display:flex; flex-direction:column; gap:12px;">`,
   ...scale.slice().reverse().map((s) => `    <div style="display:flex; align-items:baseline; gap:20px; border-bottom:1px solid ${colour("line")}; padding-bottom:10px;">
      <span class="hex" style="width:112px; flex:none;">text-${s.name} · ${s.size}px · ${s.leading}</span>
      <span dir="rtl" style="font-size:${s.size}px; line-height:${s.leading === "—" ? 1.5 : s.leading}; font-weight:${s.size >= 22 ? 700 : 400}; color:${colour("ink-900")};">وين الطلعة اليوم؟</span>
    </div>`),
   `  </div>`,
  ].join("\n"));

/* Surfaces ----------------------------------------------------------------- */
const surfaces = sheet(1180, 730,
  [heading("Surfaces · where the mark has to survive",
    "The eight category grounds, as the place hero paints them. A logo is judged here rather than on white: this is the ground it actually lands on, at the two sizes that matter — 40px and the navbar's 24px."),
   `  <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:14px;">`,
   ...CATEGORIES.map(([id, ar]) => `    <div style="border-radius:15px; overflow:hidden; border:1px solid ${colour("line")};">
      <div style="height:104px; background:linear-gradient(160deg, ${colour(`hero-${id}-1`)}, ${colour(`hero-${id}-2`)} 55%, ${colour(`hero-${id}-3`)}); display:flex; align-items:center; justify-content:center; gap:14px;">
        ${mark(40, colour("sea-600"), colour("coral-600"), "#ffffff")}
        ${mark(24, colour("sea-600"), colour("coral-600"), "#ffffff")}
      </div>
      <div style="padding:9px 11px; background:${colour(`cat-${id}-tint`)}; display:flex; justify-content:space-between; align-items:center;">
        <span dir="rtl" style="font-size:12px; font-weight:600; color:${colour(`cat-${id}-ink`)};">${ar}</span>
        <span class="hex">${id}</span>
      </div>
    </div>`),
   `  </div>`,
   `  <div style="display:flex; gap:26px; align-items:center; border-top:1px solid ${colour("line")}; padding-top:18px;">
    <div style="display:flex; align-items:center; gap:14px; background:${colour("sand-50")}; border:1px solid ${colour("line")}; border-radius:15px; padding:12px 16px;">
      ${mark(40, colour("sea-600"), colour("coral-600"), "#ffffff")}
      ${mark(24, colour("sea-600"), colour("coral-600"), "#ffffff")}
      <span class="hex">on paper</span>
    </div>
    <div style="display:flex; align-items:center; gap:14px; background:${colour("ink-900")}; border-radius:15px; padding:12px 16px;">
      ${mark(40, colour("sea-400"), colour("coral-500"), "#ffffff")}
      ${mark(24, colour("sea-400"), colour("coral-500"), "#ffffff")}
      <span class="hex" style="color:${colour("sand-200")};">on ink</span>
    </div>
    <span class="cap" style="max-width:36ch;">The keyline stays white on every ground, and this board is how we know. It was drawn once with the keyline set to the ink beneath it: the ؟ and its dot are keyline, so they vanished, and the mark became a blue shape with a red blob. The keyline is not an outline round the mark — it is what draws the ؟.</span>
  </div>`,
  ].join("\n"));

/* ── write, or check ─────────────────────────────────────────────────────── */

const BOARDS = [
  ["design/Palette.dc.html", palette],
  ["design/Type.dc.html", type],
  ["design/Surfaces.dc.html", surfaces],
];

let stale = 0;
for (const [rel, body] of BOARDS) {
  const path = join(ROOT, rel);
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === body) continue;
  if (CHECK) { console.error(`✗ ${rel} is out of date with theme.css / WainLogo.tsx`); stale++; continue; }
  writeFileSync(path, body);
  console.log(`  wrote ${rel}`);
}

if (CHECK) {
  if (stale) {
    console.error(`\n${stale} board(s) stale — run \`npm run design:boards\` and re-seed the canvas.`);
    process.exit(1);
  }
  console.log("design:boards — the theme boards match the theme ✓");
} else {
  console.log(
    `gen-theme-boards: ${RAMPS.reduce((n, r) => n + r.steps.length, 0)} swatches, ` +
    `${scale.length} type steps, ${CATEGORIES.length} category grounds ✓`,
  );
}
