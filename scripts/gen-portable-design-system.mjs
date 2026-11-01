#!/usr/bin/env node
/**
 * Extracts the site's design tokens into a portable, framework-free design
 * system under design-system/ — tokens.json and tokens.css.
 *
 * Primitives are READ from src/app/theme.css rather than retyped, for the
 * reason every other generator in this repo gives: a copy passes the day it is
 * written and drifts the first time someone edits one side. The semantic layer
 * (what a colour is FOR) and the few tokens theme.css does not declare
 * (spacing, motion, layout) are written here, each with the file it came from.
 *
 *   node scripts/gen-portable-design-system.mjs          write
 *   node scripts/gen-portable-design-system.mjs --check  fail if out of date
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "design-system");
const PREFIX = "ds";

// ── 1. Read the primitives out of @theme ────────────────────────────────────
const css = readFileSync(join(ROOT, "src/app/theme.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const block = css.slice(css.indexOf("@theme"));
const prim = {};
for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
  prim[m[1]] = m[2].replace(/\s+/g, " ").trim();
}
const pick = (re) =>
  Object.fromEntries(Object.entries(prim).filter(([k]) => re.test(k)));

const colors = pick(/^color-/);
const radii = pick(/^radius-/);
const shadows = Object.fromEntries(
  Object.entries(pick(/^shadow(-|$)/)).map(([k, val]) => [
    k,
    val.replace(/var\(--shadow/g, `var(--${PREFIX}-shadow`),
  ]),
);
radii["radius-full"] = "9999px"; // pills and avatars — Tailwind's rounded-full
const sizes = pick(/^text-(2xs|[2-6]xl)$/);
const leadings = pick(/^text-.*--line-height$/);

// Tailwind's own defaults for the sizes theme.css does not override. Named
// here so the ladder is complete in one place: 11 · 12 · 14 · 16 · 18 · 20 · 22 …
const defaultSizes = {
  "text-xs": "0.75rem",
  "text-sm": "0.875rem",
  "text-base": "1rem",
  "text-lg": "1.125rem",
  "text-xl": "1.25rem",
};
const scale = { ...sizes, ...defaultSizes };
const order = ["2xs", "xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"];

for (const step of order) {
  if (!scale[`text-${step}`]) throw new Error(`type step ${step} missing`);
  if (!leadings[`text-${step}--line-height`] && step !== "2xs")
    throw new Error(`line-height for ${step} missing in theme.css`);
}
if (!colors["color-sea-600"]) throw new Error("theme.css parse failed: no sea-600");

// ── 2. Semantic layer: what each colour is for ──────────────────────────────
// Every value is a primitive name, so a re-theme is one edit here.
const c = (n) => `color-${n}`;
const semantic = {
  surface: {
    canvas: c("sand-50"),
    subtle: c("sand-100"),
    sunken: c("sand-200"),
    inverse: c("ink-900"),
    brand: c("sea-950"),
  },
  text: {
    strong: c("ink-900"),
    body: c("ink-700"),
    muted: c("ink-500"),
    faint: c("ink-400"),
    inverse: c("sand-50"),
    link: c("sea-700"),
    accent: c("sand-700"),
  },
  border: {
    subtle: c("line"),
    strong: c("line-strong"),
    control: c("line-control"),
    focus: c("sea-600"),
  },
  action: {
    primary: c("ink-900"),
    "primary-hover": c("ink-800"),
    accent: c("sea-600"),
    "accent-hover": c("sea-700"),
    highlight: c("sun-400"),
  },
  feedback: {
    "info-bg": c("sea-50"),
    "info-fg": c("sea-700"),
    "warning-bg": c("sun-100"),
    "warning-fg": c("sun-800"),
    "danger-bg": c("coral-50"),
    "danger-border": c("coral-200"),
    "danger-fg": c("coral-800"),
    "danger-solid": c("coral-600"),
    "success-fg": c("palm-700"),
    "success-solid": c("palm-600"),
    "neutral-bg": c("sand-200"),
    "neutral-fg": c("ink-600"),
  },
  selection: { bg: c("sun-200"), fg: c("ink-900") },
};

// ── 3. Tokens theme.css does not declare (measured from the source) ─────────
const extras = {
  // docs/mobile.md + CLAUDE.md «The scale is compact on purpose»
  space: {
    "gutter-sm": "0.625rem", // 10px — page gutter on phones
    "gutter-md": "1rem", // 16px — from sm: up
    "rhythm-sm": "0.5rem", // 8px  — vertical rhythm on phones
    "rhythm-md": "0.75rem", // 12px — from sm: up
    "card-pad": "0.5rem",
  },
  layout: {
    "measure-prose": "48rem", // max-w-3xl
    "measure-page": "72rem", // max-w-6xl
    "measure-form": "28rem", // max-w-md
  },
  // WCAG 2.5.8 AA (24px) — see MIN_TARGET_PX in scripts/audit-mobile.mjs
  a11y: { "target-min": "1.5rem", "field-text-min": "1rem", "text-floor": "0.6875rem" },
  motion: {
    "ease-out": "cubic-bezier(0.22, 1, 0.36, 1)", // globals.css tap + view transition
    "duration-tap": "120ms",
    "duration-route": "160ms",
    "duration-hover": "300ms",
  },
  z: { base: "0", tray: "40", sheet: "50", skip: "100" },
};

// ── 4. Emit ─────────────────────────────────────────────────────────────────
const v = (name) => `var(--${PREFIX}-${name})`;
const lines = [];
const emit = (name, value) => lines.push(`  --${PREFIX}-${name}: ${value};`);
const group = (title) => lines.push("", `  /* ${title} */`);

group("Colour — primitives (read from src/app/theme.css)");
for (const [k, val] of Object.entries(colors)) emit(k, val);
group("Colour — semantic (what each primitive is for)");
for (const [cat, map] of Object.entries(semantic))
  for (const [k, ref] of Object.entries(map)) emit(`${cat}-${k}`, v(ref));
group("Type");
emit("font-sans", `"IBM Plex Sans Arabic", system-ui, sans-serif`);
for (const s of order) {
  emit(`text-${s}`, scale[`text-${s}`]);
  emit(`leading-${s}`, leadings[`text-${s}--line-height`] ?? "1.45");
}
group("Radius");
for (const [k, val] of Object.entries(radii)) emit(k, val);
group("Elevation");
for (const [k, val] of Object.entries(shadows)) emit(k, val);
for (const [cat, map] of Object.entries(extras)) {
  group(cat);
  for (const [k, val] of Object.entries(map)) emit(`${cat}-${k}`, val);
}

const header = `/* GENERATED by scripts/gen-portable-design-system.mjs from src/app/theme.css.
   Do not edit — change theme.css (or the semantic map in the script) and re-run:
   npm run design:portable */`;
const tokensCss = `${header}\n:root {${lines.join("\n")}\n}\n`;

const tokensJson = {
  $description:
    "Portable design tokens, generated from src/app/theme.css. $value may reference another token as {path}.",
  color: {
    primitive: Object.fromEntries(
      Object.entries(colors).map(([k, val]) => [k.replace(/^color-/, ""), { $type: "color", $value: val }]),
    ),
    ...Object.fromEntries(
      Object.entries(semantic).map(([cat, map]) => [
        cat,
        Object.fromEntries(
          Object.entries(map).map(([k, ref]) => [
            k,
            { $type: "color", $value: `{color.primitive.${ref.replace(/^color-/, "")}}` },
          ]),
        ),
      ]),
    ),
  },
  type: {
    family: { sans: { $type: "fontFamily", $value: ["IBM Plex Sans Arabic", "system-ui", "sans-serif"] } },
    scale: Object.fromEntries(
      order.map((s) => [
        s,
        {
          size: { $type: "dimension", $value: scale[`text-${s}`] },
          lineHeight: { $type: "number", $value: Number(leadings[`text-${s}--line-height`] ?? 1.45) },
        },
      ]),
    ),
  },
  radius: Object.fromEntries(
    Object.entries(radii).map(([k, val]) => [k.replace(/^radius-/, ""), { $type: "dimension", $value: val }]),
  ),
  shadow: Object.fromEntries(
    Object.entries(shadows).map(([k, val]) => [k.replace(/^shadow-?/, "") || "default", { $type: "shadow", $value: val }]),
  ),
  ...Object.fromEntries(
    Object.entries(extras).map(([cat, map]) => [
      cat,
      Object.fromEntries(Object.entries(map).map(([k, val]) => [k, { $value: val }])),
    ]),
  ),
};
const tokensJsonText = JSON.stringify(tokensJson, null, 2) + "\n";

// A list of names for preview.html: browsers refuse to expose cssRules of a
// stylesheet loaded from file://, so the preview cannot discover them itself.
const names = [...tokensCss.matchAll(/^\s*(--ds-[a-z0-9-]+):/gm)].map((m) => m[1]);
const tokensJs = `${header}\nwindow.DS_TOKEN_NAMES = ${JSON.stringify(names)};\n`;

const files = { "tokens.css": tokensCss, "tokens.json": tokensJsonText, "tokens.js": tokensJs };
if (process.argv.includes("--check")) {
  const stale = Object.entries(files).filter(
    ([f, body]) => !existsSync(join(OUT, f)) || readFileSync(join(OUT, f), "utf8") !== body,
  );
  if (stale.length) {
    console.error(`design-system out of date: ${stale.map(([f]) => f).join(", ")} — run npm run design:portable`);
    process.exit(1);
  }
  console.log("design-system: tokens match theme.css");
} else {
  mkdirSync(OUT, { recursive: true });
  for (const [f, body] of Object.entries(files)) writeFileSync(join(OUT, f), body);
  console.log(
    `design-system: ${Object.keys(colors).length} colours, ${order.length} type steps, ${Object.keys(radii).length} radii, ${Object.keys(shadows).length} shadows`,
  );
}
