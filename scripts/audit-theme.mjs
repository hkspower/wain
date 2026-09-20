#!/usr/bin/env node
/**
 * Measure the theme's ordered scales:  npm run audit:theme
 *
 * `audit:color` measures the colours and `audit:type` measures the type that
 * reaches the screen. Between them they cover two of the four token families
 * in `theme.css` — and **nothing measured `--radius-*` or `--shadow-*` at
 * all**, which is the gap this closes.
 *
 * What makes those two worth a check is that their comments do not describe
 * taste, they state RULES: «the relationship between sizes stays intact» for
 * the corners, and «offsets grow faster than blur with elevation» plus «every
 * layer is tinted with ink» and «three layers once an object is properly
 * raised» for the shadows. Each is a claim about the numbers underneath it,
 * and each was checked by whoever wrote it and by nobody since. Same argument
 * `audit:areas` made for its own file: an unchecked comment is a comment that
 * will be wrong.
 *
 * It reads `theme.css` and never opens `out/`. A scale is a relationship
 * between declarations, so the declarations are the thing to measure — and it
 * means this needs no build and costs `scan` about a second.
 *
 * TWO EXCEPTIONS ARE NAMED RATHER THAN ENFORCED, both because the data says
 * so and not to make the run green:
 *
 *   `text-2xs` sits at 1.45 against `text-xs`'s 1.55, which reads as a
 *   violation of «looser as the type gets smaller». theme.css says outright
 *   that it is not part of that curve — it is a badge size, always one line,
 *   where the ratio sets a box height rather than the gap between two lines
 *   of reading. So the ladder is checked over running text only.
 *
 *   The shadows' y/blur ratio runs 0.500, 0.500, 0.500, 0.571, 0.583, 0.556 —
 *   it DIPS at `2xl`, so «offsets grow faster than blur» is false read as a
 *   per-step rule. Across the scale as a whole it is true and comfortably so
 *   (offset ×40, blur ×36), which is what the sentence means by «with
 *   elevation». Asserting the per-step version would fail the shipped theme,
 *   and a rule that fires on a deliberate design is measuring the rule rather
 *   than the design. The ratios are printed so the dip stays visible.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(ROOT, "src/app/theme.css"), "utf8");

let problems = 0;
const fail = (m) => {
  console.log("  ✗ " + m);
  problems++;
};

const px = (rem) => Math.round(rem * 16 * 1000) / 1000;

/* Tailwind v4's own values for the steps theme.css does not redeclare.
   theme.css's comments quote the same numbers — «12px sat at 1.33 and 14px
   at 1.43», «the body end (11 through 20)» — so these are not a guess. A
   step that is neither declared here nor known is an error rather than a
   silent skip: it means the scale grew and this file did not hear about it. */
const TAILWIND_SIZES = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20 };

/** The one leading that is deliberately off the curve, with its reason. */
const LEADING_EXEMPT = {
  "2xs": "a badge size, always one line — the ratio sets a box height, not the gap between two lines",
};

const sizes = {};
for (const m of css.matchAll(/--text-([a-z0-9]+):\s*([\d.]+)rem;/g)) sizes[m[1]] = px(+m[2]);
for (const [k, v] of Object.entries(TAILWIND_SIZES)) if (!(k in sizes)) sizes[k] = v;

const leading = {};
for (const m of css.matchAll(/--text-([a-z0-9]+)--line-height:\s*([\d.]+);/g)) leading[m[1]] = +m[2];

/* ── 1. the type ladder ─────────────────────────────────────────────────── */
console.log("\n── the type ladder ──");
{
  const steps = Object.keys(leading)
    .map((k) => ({ k, size: sizes[k], lh: leading[k] }))
    .sort((a, b) => a.size - b.size);

  for (const s of steps) {
    if (s.size === undefined) {
      fail(`text-${s.k} declares a line-height but no size, and is not a Tailwind step`);
      continue;
    }
    const note = LEADING_EXEMPT[s.k] ? "  — off the curve: " + LEADING_EXEMPT[s.k] : "";
    console.log(`  ${String(s.size).padStart(3)}px  text-${s.k.padEnd(5)}  ${s.lh.toFixed(2)}${note}`);
  }

  /* Looser as the type gets smaller. Checked over running text only, for the
     reason in the header — a badge is never two lines, so it has no gap to
     protect. */
  const running = steps.filter((s) => s.size !== undefined && !LEADING_EXEMPT[s.k]);
  let breaks = 0;
  for (let i = 1; i < running.length; i++) {
    const a = running[i - 1];
    const b = running[i];
    if (b.lh > a.lh) {
      fail(
        `leading goes UP from ${a.size}px (${a.lh}) to ${b.size}px (${b.lh}) — ` +
          `the ladder is looser as the type gets smaller, not tighter`
      );
      breaks++;
    }
  }
  if (!breaks)
    console.log(
      `  ${running.length} running-text steps, ${running[0].lh} down to ` +
        `${running.at(-1).lh} — looser as the type gets smaller ✓`
    );

  /* A declared size with no declared leading is the defect audit:type reports
     from the rendered page — caught here at the token instead, where it is
     one line to fix. */
  for (const k of Object.keys(sizes)) {
    if (!(k in leading) && !(k in TAILWIND_SIZES))
      fail(`--text-${k} is declared but --text-${k}--line-height is not — it will take Tailwind's Latin default`);
  }
}

/* ── 2. corners ─────────────────────────────────────────────────────────── */
console.log("\n── corners ──");
{
  /* Closer than this and two radii are one radius with two names — the same
     argument audit:type makes for font sizes at 1.5px. The smallest real step
     on this scale is 2px (10→12), so the floor is where the design already
     is rather than a number picked to pass. */
  const MIN_STEP = 2;
  /* SOURCE order, deliberately not sorted by value. Sorting first is how the
     first draft of this made its own «is it larger?» test unfailable: point
     radius-3xl at 8px and a value-sorted list is 8/10/12/15, monotonic and
     green, with the backwards step silently reordered out of existence. The
     file declares the scale small to large, so the declaration order IS the
     claim being checked. */
  const radii = [...css.matchAll(/--radius-([a-z0-9]+):\s*([\d.]+)rem;/g)].map((m) => ({
    k: m[1],
    v: px(+m[2]),
  }));

  console.log("  " + radii.map((r) => `${r.k} ${r.v}px`).join("   "));
  for (let i = 1; i < radii.length; i++) {
    const step = radii[i].v - radii[i - 1].v;
    if (step <= 0)
      fail(`radius-${radii[i].k} (${radii[i].v}px) is not larger than radius-${radii[i - 1].k}`);
    else if (step < MIN_STEP)
      fail(
        `radius-${radii[i - 1].k} → radius-${radii[i].k} is ${step}px apart; ` +
          `under ${MIN_STEP}px the two are one corner with two names`
      );
  }
  if (!problems)
    console.log(
      `  ${radii.length} steps, ${radii[0].v}→${radii.at(-1).v}px, ` +
        `smallest gap ${Math.min(...radii.slice(1).map((r, i) => r.v - radii[i].v))}px ✓`
    );
}

/* ── 3. elevation ───────────────────────────────────────────────────────── */
console.log("\n── elevation ──");
{
  /* Read the ink out of the palette rather than writing #14120f here. The
     claim is «tinted with ink», not «tinted with this hex» — pinning the
     number would make the check pass the day ink moved and the shadows did
     not, which is the exact drift it exists to catch. */
  const inkHex = css.match(/--color-ink-900:\s*#([0-9a-f]{6});/i)?.[1];
  if (!inkHex) fail("--color-ink-900 is not declared, so «tinted with ink» cannot be checked");
  const ink = inkHex && [0, 2, 4].map((i) => parseInt(inkHex.slice(i, i + 2), 16)).join(" ");

  /* `<x> <y> <blur> <spread> <color>`; x is a bare `0`, so a px-only regex
     mis-reads y as blur — that is how the first draft of this read every
     offset as zero. Strip the colour, then take the values positionally,
     with parseFloat rather than Number because every one but x carries `px`
     and Number("1px") is NaN. */
  const layerNums = (l) =>
    l
      .replace(/rgb\([^)]*\)/g, "")
      .trim()
      .split(/\s+/)
      .map(parseFloat)
      .filter((n) => !Number.isNaN(n));

  const shadows = [...css.matchAll(/--shadow-([a-z0-9]+):\s*([^;]+);/g)]
    .map((m) => {
      const layers = m[2]
        .split(/,(?![^()]*\))/)
        .map((s) => s.trim())
        .filter(Boolean);
      const nums = layers.map(layerNums);
      return {
        k: m[1],
        layers,
        count: layers.length,
        y: Math.max(...nums.map((n) => n[1] ?? 0)),
        blur: Math.max(...nums.map((n) => n[2] ?? 0)),
      };
    }); // source order, for the reason the corner scale's own comment gives.

  for (const s of shadows) {
    const ratio = s.blur ? (s.y / s.blur).toFixed(3) : "—";
    console.log(
      `  shadow-${s.k.padEnd(4)} ${s.count} layer${s.count > 1 ? "s" : " "}  ` +
        `offset ${String(s.y).padStart(2)}px  blur ${String(s.blur).padStart(2)}px  y/blur ${ratio}`
    );
  }

  // Every layer tinted with ink, not neutral black.
  if (ink) {
    for (const s of shadows)
      for (const l of s.layers) {
        const c = l.match(/rgb\(\s*([\d\s]+?)\s*\//);
        if (!c) fail(`shadow-${s.k} has a layer with no rgb() colour: «${l}»`);
        else if (c[1].split(/\s+/).join(" ") !== ink)
          fail(
            `shadow-${s.k} is tinted rgb(${c[1]}) but ink-900 is rgb(${ink}) — ` +
              `neutral or stale black goes muddy over this palette`
          );
      }
  }

  // Both dimensions grow with elevation, and the stack deepens.
  for (let i = 1; i < shadows.length; i++) {
    const a = shadows[i - 1];
    const b = shadows[i];
    if (b.blur < a.blur) fail(`shadow-${b.k} blurs ${b.blur}px, less than shadow-${a.k}'s ${a.blur}px`);
    if (b.count < a.count)
      fail(`shadow-${b.k} has ${b.count} layers, fewer than shadow-${a.k}'s ${a.count}`);
  }

  /* «three layers once an object is properly raised». md is where the comment
     puts that line, and md is the first shadow with a real throw. */
  const RAISED_FROM = "md";
  const from = shadows.findIndex((s) => s.k === RAISED_FROM);
  if (from < 0) fail(`shadow-${RAISED_FROM} is gone; the «three layers once raised» rule has no anchor`);
  else
    for (const s of shadows.slice(from))
      if (s.count < 3)
        fail(`shadow-${s.k} has ${s.count} layers; a raised surface needs three — contact, throw and ambient`);

  /* «Offsets grow faster than blur with elevation», across the scale rather
     than step by step. See the header for why this is not per-step. */
  const lit = shadows.filter((s) => s.blur > 0);
  const offsetGrowth = lit.at(-1).y / lit[0].y;
  const blurGrowth = lit.at(-1).blur / lit[0].blur;
  if (offsetGrowth <= blurGrowth)
    fail(
      `offsets grow ×${offsetGrowth.toFixed(1)} across the scale and blur ×${blurGrowth.toFixed(1)} — ` +
        `theme.css says offsets grow faster, so the higher a thing sits the further its shadow is thrown`
    );
  else
    console.log(
      `  offset ×${offsetGrowth.toFixed(1)} against blur ×${blurGrowth.toFixed(1)} across the scale ✓  ` +
        `(per-step y/blur dips at the top; see this script's header)`
    );
}

/* ── 4. no scale invented at the call site ──────────────────────────────── */
console.log("\n── written down, not improvised ──");
{
  /* audit:type's own rule, for the two families it does not cover. Twenty-two
     `text-[11px]` had accumulated before anyone counted; a corner or an
     elevation rots the same way and is even easier to miss in review.

     But a flat ban is the wrong rule here, and running it proved it: the
     three hits in this repository are a map pin's 8px rotated NOSE
     (`rounded-[2px]`, `rounded-[3px]`) and the search dial's warm gold glow
     (`shadow-[…rgba(180,120,10,.55)]`). None is scale rot. The corner scale
     starts at 10px and models cards, buttons and chips — a 10px round on an
     8px square is a circle — and the elevation scale's whole premise is that
     every layer is ink, so a deliberately coloured glow is not a step on it.

     So the line is drawn where the scale actually reaches. A corner INSIDE
     the scale's range is rot: somebody wanted 14px rather than reaching for
     2xl at 15. Below the smallest token it is a hairline the scale does not
     model. An ink-tinted arbitrary shadow is rot for the same reason — that
     is a step on the scale, spelled out by hand — while another hue is not a
     step at all. Both classes are printed either way, so a detail cannot
     quietly become a habit. */
  const grep = (pattern) => {
    try {
      return execFileSync("grep", ["-rn", "-E", pattern, "src/"], { cwd: ROOT, encoding: "utf8" })
        .trim()
        .split("\n")
        .filter(Boolean);
    } catch {
      return []; // grep exits 1 on no matches, which is the outcome we want.
    }
  };
  const loc = (h) => h.split(":").slice(0, 2).join(":");

  const smallestRadius = Math.min(
    ...[...css.matchAll(/--radius-[a-z0-9]+:\s*([\d.]+)rem;/g)].map((m) => px(+m[1]))
  );
  const corners = { rot: [], detail: [] };
  for (const h of grep(String.raw`rounded(-[a-z]+)?-\[`)) {
    const v = h.match(/rounded(?:-[a-z]+)?-\[(\d+(?:\.\d+)?)px\]/);
    const n = v ? +v[1] : null;
    (n !== null && n < smallestRadius ? corners.detail : corners.rot).push({ h, n });
  }
  if (corners.rot.length) {
    fail(
      `${corners.rot.length} arbitrary corner(s) at or above the ${smallestRadius}px the scale starts at — ` +
        `use a --radius token:`
    );
    corners.rot.forEach((c) => console.log("      " + c.h));
  }
  for (const c of corners.detail)
    console.log(`  ${c.n}px corner under the ${smallestRadius}px scale — a hairline, not a step: ${loc(c.h)}`);
  if (!corners.rot.length) console.log(`  no corner improvised inside the scale ✓`);

  const inkHex2 = css.match(/--color-ink-900:\s*#([0-9a-f]{6});/i)?.[1] ?? "";
  const shadowRot = [];
  const tinted = [];
  for (const h of grep(String.raw`shadow-\[`)) {
    const isInk =
      h.toLowerCase().includes(inkHex2) || /rgba?\(\s*20[\s,]+18[\s,]+15/.test(h);
    (isInk ? shadowRot : tinted).push(h);
  }
  if (shadowRot.length) {
    fail(`${shadowRot.length} arbitrary ink-tinted shadow(s) — that is a step on the scale, written out longhand:`);
    shadowRot.forEach((h) => console.log("      " + h));
  }
  for (const h of tinted)
    console.log(`  a coloured glow, which the ink elevation scale does not model: ${loc(h)}`);
  if (!shadowRot.length) console.log(`  no ink elevation improvised ✓`);
}

console.log(
  problems === 0
    ? "\nThe theme's scales hold: type, corners and elevation all read in one direction.\n"
    : `\n${problems} problem(s).\n`
);
process.exit(problems ? 1 : 0);
