#!/usr/bin/env node
/**
 * Is the CSS still what it claims to be?   npm run audit:css
 *
 * One stylesheet, 567 hand-written lines and 120 design tokens, feeding a
 * 90KB Tailwind build. Scanned by hand today it came out clean — no dead
 * tokens, no unused classes, 84% of the shipped bytes used across sixteen
 * routes, every animation covered by the reduced-motion block, the custom
 * `standalone:` variant properly defined for both the media query and iOS's
 * attribute fallback.
 *
 * None of that was checkable, which is the only reason this file exists. The
 * findings were a good afternoon; the guard is what survives it.
 *
 * The check with real teeth is the third one. This site is RTL, and a
 * physical-direction utility in a layout does not error, does not warn, and
 * does not look wrong to anyone reading the source in English — it just puts
 * the margin on the wrong side for every visitor.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS_FILE = join(ROOT, "src/app/globals.css");
const css = readFileSync(CSS_FILE, "utf8");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if ([".ts", ".tsx"].includes(extname(name))) out.push(path);
  }
  return out;
}
const files = walk(join(ROOT, "src")).map((f) => ({
  path: relative(ROOT, f).split("\\").join("/"),
  text: readFileSync(f, "utf8"),
}));
const src = files.map((f) => f.text).join("\n");

let errors = 0;
let notes = 0;
const say = (level, name, lines, why) => {
  if (lines.length === 0) return;
  console.log(`  ${level === "error" ? "✗" : "⚠"} ${name} — ${lines.length}`);
  if (why) console.log(`      ${why}`);
  for (const l of lines.slice(0, 8)) console.log(`      ${l}`);
  if (lines.length > 8) console.log(`      … and ${lines.length - 8} more`);
  if (level === "error") errors += lines.length;
  else notes += lines.length;
};

console.log("\n── tokens and rules nothing reaches ──");

/* A Tailwind v4 `@theme` token is spent as a utility — `--color-coral-600`
   becomes `bg-coral-600`, `text-coral-600`, `ring-coral-600` — so «used» means
   the stem appears anywhere, not that `var()` does. */
const tokens = [...new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]))];
const unspent = tokens.filter((t) => {
  // Tailwind's paired companions. `--text-lg--line-height` is applied BY
  // `text-lg`; it has no utility of its own and never appears by name. The
  // first version of this check reported all ten of them as dead, which is
  // ten wrong answers out of fifteen — enough to make the whole section
  // ignorable.
  if (/--(line-height|letter-spacing|font-weight)$/.test(t)) return false;
  if (src.includes(`var(${t})`) || css.includes(`var(${t})`)) return false;
  const stem = t.slice(2).replace(/^(color|font|text|spacing|radius|shadow|ease|animate)-/, "");
  return !new RegExp(`[-\\[:"' ]${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9-])`).test(src);
});

/* A ramp step nobody has spent yet is not waste — a palette is meant to be
   complete, and `sea-950` existing unused is what lets the next dark surface
   be right first time. Said as a count rather than a warning. A token OUTSIDE
   a ramp with nothing reaching it is a different thing, and gets flagged. */
const RAMP = /-\d{2,3}$/;
const [rampGaps, orphans] = [unspent.filter((t) => RAMP.test(t)), unspent.filter((t) => !RAMP.test(t))];
console.log(
  `  ${tokens.length} tokens declared · ${rampGaps.length} ramp step(s) unspent today` +
    (rampGaps.length ? ` (${rampGaps.map((t) => t.slice(8)).join(", ")})` : "")
);
say("note", "tokens outside a ramp that nothing reaches", orphans, "a one-off nobody spends");

/* Any nesting: the first version of this scan only matched selectors at column
   zero and silently skipped every rule inside a @media block. */
const classes = [...new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)(?=[\s,{:.[])/g)].map((m) => m[1]))]
  // `.tsx` and friends: a filename in a comment is not a selector.
  .filter((c) => !["tsx", "ts", "css", "mjs", "json"].includes(c));
const deadClasses = classes.filter(
  (c) => !new RegExp(`[\\s"'\`{]${c}(?![\\w-])`).test(src)
);
say("note", "class selectors nothing uses", deadClasses);

console.log("\n── right to left ──");

/**
 * Physical direction utilities, which do not mirror.
 *
 * `ml-4` is margin-LEFT in an RTL page too, so it lands on the wrong side and
 * nothing complains. The logical forms — `ms-`, `me-`, `ps-`, `pe-`, `start-`,
 * `end-`, `text-start`, `border-s` — flip with the document.
 *
 * The map components are exempt and must stay exempt: a pin is placed at a
 * geographic fraction of the frame, and a logical inset would mirror Kuwait
 * east to west. SearchMap says so at the line that does it. Centring
 * (`left-1/2` with `-translate-x-1/2`) is physical for the same reason — the
 * transform does not flip, so pairing it with a logical inset is what would
 * break.
 */
const RTL_EXEMPT = /(MapPin|SearchMap|PlaceMapFrame|CoordinatePicker)\.tsx$/;
const PHYSICAL =
  /(?<![\w-])(?:ml|mr|pl|pr)-[a-z0-9.[\]/-]+|(?<![\w-])(?:left|right)-[a-z0-9.[\]/-]+|(?<![\w-])text-(?:left|right)(?![\w-])|(?<![\w-])border-[lr](?![\w-])|(?<![\w-])rounded-[lr](?![\w-])/g;
const physical = [];
for (const f of files) {
  if (RTL_EXEMPT.test(f.path)) continue;
  f.text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(PHYSICAL)) physical.push(`${f.path}:${i + 1}  ${m[0]}`);
  });
}
say(
  "error",
  "physical direction utilities outside the map",
  physical,
  "these do not mirror: ml-→ms-, pl-→ps-, left-→start-, text-left→text-start"
);

console.log("\n── motion ──");

/* Four keyframes today. The reduced-motion block is a global `*` reset rather
   than a list, so it covers whatever gets added next — but only while it is
   still there, and losing it is invisible to everyone who does not set the
   preference. */
const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css);
const blanket = /animation-duration:\s*0\.01ms\s*!important/.test(css);
if (!reduced || !blanket) {
  say("error", "animations with nothing to switch them off", [
    `${keyframes.length} @keyframes and no global prefers-reduced-motion reset`,
  ]);
} else {
  console.log(`  ✓ ${keyframes.length} @keyframes, all covered by the global reduce block`);
}

/* `.icon-pop` fires off an ARIA attribute, not a prop.
 *
 * That is what lets any control opt in without threading state through it,
 * and it is also how the class silently does nothing: put it on an icon whose
 * component never sets aria-pressed, aria-current or aria-checked, and there
 * is no error, no warning, and an icon that looks exactly as it did before.
 *
 * Checked statically rather than in a browser, and the first attempt is why.
 * Asking the live DOM whether a control is selected cannot tell "this group
 * has nothing selected right now" from "this group never selects anything" —
 * on /about/ no tab is current, correctly, and the runtime version reported
 * the whole tab bar as broken on every page outside the tab set. Selection is
 * a property of the component, so the component is what gets asked. */
{
  const TRIGGERS = /aria-pressed|aria-current|aria-checked/;
  const orphans = files
    .filter((f) => /\bicon-pop\b/.test(f.text) && !TRIGGERS.test(f.text))
    .map((f) => f.path);
  if (orphans.length) {
    say("error", "icon-pop where nothing can trigger it", orphans);
  } else {
    console.log("  ✓ every icon-pop sits in a component that expresses selection");
  }
}

console.log("\n── one surface, three files ──");

/**
 * The installed app's browser chrome against the page it sits above.
 *
 * `themeColor` in layout.tsx is a literal, and `body` is `bg-sand-50`. They
 * agree today because somebody typed the same six characters twice. Change the
 * palette's lightest sand to a warm off-white — the obvious thing to do to a
 * palette named «sand» — and the status bar stays pure white, leaving a seam
 * across the top of the installed app that no test would catch and no
 * stylesheet would explain.
 */
const surface = css.match(/--color-sand-50:\s*([^;]+);/)?.[1]?.trim().toLowerCase();
const read = (path, re) => (files.find((f) => f.path === path)?.text ?? "").match(re)?.[1]?.toLowerCase();
/* Three copies, not one — the audit's own colour note is what turned up the
   other two. The manifest paints the splash screen and the app's window
   furniture; layout.tsx paints the browser chrome. All three are the same
   white as the page, by hand. */
const chrome = [
  ["layout.tsx themeColor", read("src/app/layout.tsx", /themeColor:\s*"([^"]+)"/)],
  ["manifest background_color", read("src/app/manifest.ts", /background_color:\s*"([^"]+)"/)],
  ["manifest theme_color", read("src/app/manifest.ts", /theme_color:\s*"([^"]+)"/)],
];
const missing = chrome.filter(([, v]) => !v);
const wrong = chrome.filter(([, v]) => v && v !== surface);
if (!surface || missing.length) {
  say("note", "could not read the surface token or one of its copies",
    [`--color-sand-50 = ${surface ?? "not found"}`, ...missing.map(([k]) => `${k} = not found`)]);
} else if (wrong.length) {
  say("error", "the app's chrome no longer matches the page it sits above",
    wrong.map(([k, v]) => `${k} = ${v}  ·  --color-sand-50 = ${surface} (body is bg-sand-50)`),
    "a seam across the top of the installed app that no test would catch");
} else {
  console.log(`  ✓ all three copies of the surface colour agree with --color-sand-50 (${surface})`);
}

console.log("\n── colours outside the palette ──");

/* Illustrations are allowed their own colours — a skyline is artwork, not UI,
   and forcing it through eight brand tokens would make it worse. Everything
   else should be spending the palette. */
const ART = /(KuwaitSkyline|CategoryArt|PlaceArt|WainLogo|icons|PlaceIcon)\.tsx$/;
/* layout.tsx and manifest.ts hold the app-chrome colours, which the check
   above compares against the palette properly. Listing them here as well would
   be reporting the same three values twice. */
const CHROME = /(src\/app\/layout\.tsx|src\/app\/manifest\.ts)$/;
const raw = [];
for (const f of files) {
  if (ART.test(f.path) || CHROME.test(f.path)) continue;
  f.text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
      raw.push(`${f.path}:${i + 1}  ${m[0]}`);
    }
  });
}
say("note", "raw colour values in non-illustration files", raw, "one-offs the palette does not know about");

console.log(
  "\n  Not checked here: whether the result looks right. Coverage, contrast and\n" +
    "  layout have their own audits (audit:color, audit:type, audit:padding,\n" +
    "  audit:mobile); this one is about the stylesheet as a stylesheet."
);
console.log(`\n${errors} errors, ${notes} notes`);
process.exit(errors ? 1 : 0);
