#!/usr/bin/env node
/**
 * Exports the site's drawings as static SVG for the Flutter app.
 *   npm run flutter:art     (add --check to render and diff without writing)
 *
 * CategoryArt, PlaceArt, PlaceIcon, the UI icons, WainLogo and the skyline are
 * hand-drawn React components, and the skyline's orbs are computed. Re-tracing
 * them for Flutter would be a second set of drawings that could only drift, so
 * they are bundled, rendered in a real browser, and taken out of the DOM — the
 * technique `export-figma-icons.mjs` already uses, for the same reason: the
 * DOM is the thing the site actually paints; the TSX only describes it.
 *
 * What a browser resolves and `flutter_svg` does not is resolved HERE, not at
 * runtime: `var(--w2)` stroke widths become numbers, `class` and ARIA go, and
 * the CSS `drop-shadow` filter is dropped (Flutter paints its own elevation;
 * the filter is a soft halo the white strokes can live without).
 * CategoryArt is exported once per variant (`<category>-<0..3>.svg`): the
 * mirrored and panned recompositions are transforms INSIDE the drawing, so
 * baking them in is exact, where transforming the widget would have to
 * re-derive the viewBox scaling.
 * `currentColor` is deliberately KEPT, so an icon takes the colour of the
 * widget around it via SvgTheme(currentColor: …).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "flutter_app/assets/art");
const INDEX = join(ROOT, "flutter_app/lib/theme/art_index.g.dart");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const CHECK = process.argv.includes("--check");

const dir = mkdtempSync(join(tmpdir(), "wain-flutter-art-"));
const harness = join(ROOT, "tests/harness/_flutter-art.tsx");
mkdirSync(join(ROOT, "tests/harness"), { recursive: true });
writeFileSync(
  harness,
  `
import { createRoot } from "react-dom/client";
import * as Icons from "${join(ROOT, "src/components/icons")}";
import PlaceIcon from "${join(ROOT, "src/components/PlaceIcon")}";
import PlaceArt from "${join(ROOT, "src/components/PlaceArt")}";
import CategoryArt from "${join(ROOT, "src/components/CategoryArt")}";
import CategoryIcon from "${join(ROOT, "src/components/CategoryIcon")}";
import KuwaitSkyline from "${join(ROOT, "src/components/KuwaitSkyline")}";
import WainLogo from "${join(ROOT, "src/components/WainLogo")}";
import { places, categories } from "${join(ROOT, "src/lib/places")}";

const uiNames = Object.keys(Icons).filter((k) => /^Icon[A-Z]/.test(k)).sort();
createRoot(document.getElementById("r")!).render(
  <>
    <div id="category-art">{categories.flatMap((c) => [0, 1, 2, 3].map((v) => <i key={c.id + v} data-name={c.id + "-" + v}><CategoryArt category={c.id} variant={v as 0 | 1 | 2 | 3} /></i>))}</div>
    <div id="place-art">{places.map((p) => <i key={p.slug} data-name={p.slug}><PlaceArt place={p} /></i>)}</div>
    <div id="mark">{places.map((p) => <i key={p.slug} data-name={p.slug}><PlaceIcon slug={p.slug} className="size-12" /></i>)}</div>
    <div id="category-icon">{[...categories.map((c) => c.icon), "all"].map((n) => <i key={n} data-name={n}><CategoryIcon name={n} className="size-12" /></i>)}</div>
    <div id="icon">{uiNames.map((n) => { const C = (Icons as Record<string, any>)[n]; return <i key={n} data-name={n.replace(/^Icon/, "").toLowerCase()}><C /></i>; })}</div>
    <div id="single"><i data-name="skyline"><KuwaitSkyline /></i><i data-name="logo"><WainLogo /></i></div>
  </>
);
`
);
const bundle = join(dir, "harness.js");
try {
  execFileSync(
    "npx",
    ["-y", "esbuild", harness, "--bundle", "--format=iife", "--jsx=automatic", `--alias:@=${join(ROOT, "src")}`,
      '--define:process.env.NODE_ENV="production"', `--outfile=${bundle}`, "--log-level=error"],
    { cwd: ROOT }
  );
} finally {
  rmSync(harness, { force: true });
}
writeFileSync(join(dir, "index.html"), `<!doctype html><meta charset="utf-8"><div id="r"></div><script src="harness.js"></script>`);

const { chromium } = await import("playwright");
const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage();
await page.goto("file://" + join(dir, "index.html"));
await page.waitForSelector("#single svg");

const grabbed = await page.evaluate(() => {
  const serial = (svg) => {
    const root = getComputedStyle(svg);
    const el = svg.cloneNode(true);
    const vars = {};
    for (const name of ["--w2"]) vars[name] = svg.style.getPropertyValue(name) || root.getPropertyValue(name);
    // The skyline styles its outlines with a <style> block (.bldg/.spire/.orb),
    // which flutter_svg does not apply. The browser already knows what each of
    // those classes resolves to, so bake the computed stroke onto the element.
    const originals = svg.querySelectorAll("[class]");
    const clones = el.querySelectorAll("[class]");
    originals.forEach((o, i) => {
      if (!/\b(bldg|spire|orb)\b/.test(o.getAttribute("class") || "")) return;
      const cs = getComputedStyle(o);
      clones[i].setAttribute("stroke", cs.stroke);
      clones[i].setAttribute("stroke-width", cs.strokeWidth);
      clones[i].setAttribute("stroke-linejoin", cs.strokeLinejoin);
    });
    el.querySelectorAll("style").forEach((n) => n.remove());
    el.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    for (const a of ["class", "aria-hidden", "focusable", "role", "width", "height"]) el.removeAttribute(a);
    el.querySelectorAll("*").forEach((n) => { n.removeAttribute("class"); });
    // Resolve the custom property the marks use for their detail stroke.
    const walk = (n) => {
      for (const a of [...n.attributes]) {
        if (a.value.includes("var(--w2)")) n.setAttribute(a.name, a.value.replace(/var\(--w2\)/g, vars["--w2"]));
      }
      const st = n.getAttribute("style");
      if (st) {
        let s = st.replace(/var\(--w2\)/g, vars["--w2"]);
        s = s.split(";").map((d) => d.trim()).filter((d) => d && !/^--/.test(d) && !/^filter\s*:/.test(d)).join(";");
        if (s) n.setAttribute("style", s); else n.removeAttribute("style");
      }
      [...n.children].forEach(walk);
    };
    walk(el);
    return el.outerHTML;
  };
  const out = {};
  for (const sec of ["category-art", "place-art", "mark", "category-icon", "icon", "single"]) {
    out[sec] = {};
    for (const i of document.querySelectorAll(`#${sec} i`)) {
      const svg = i.querySelector("svg");
      if (svg) out[sec][i.dataset.name] = serial(svg);
    }
  }
  return out;
});
await browser.close();
rmSync(dir, { recursive: true, force: true });

// A place with no drawing of its own falls through to its category icon (a 24
// grid); the bespoke marks are drawn on 48. Only the bespoke ones are marks.
const marks = Object.fromEntries(Object.entries(grabbed.mark).filter(([, svg]) => /viewBox="0 0 48 48"/.test(svg)));

const files = new Map();
const put = (rel, svg) => files.set(rel, svg + "\n");
for (const [k, v] of Object.entries(grabbed["category-art"])) put(`category/${k}.svg`, v);
for (const [k, v] of Object.entries(grabbed["place-art"])) put(`place/${k}.svg`, v);
for (const [k, v] of Object.entries(marks)) put(`mark/${k}.svg`, v);
for (const [k, v] of Object.entries(grabbed["category-icon"])) put(`cat-icon/${k}.svg`, v);
for (const [k, v] of Object.entries(grabbed.icon)) put(`icon/${k}.svg`, v);
put("skyline.svg", grabbed.single.skyline);
put("logo.svg", grabbed.single.logo);

// What flutter_svg cannot draw must not have leaked through.
const problems = [];
for (const [rel, svg] of files) {
  if (/var\(--/.test(svg)) problems.push(`${rel}: unresolved CSS variable`);
  if (/\bclass=/.test(svg)) problems.push(`${rel}: class attribute`);
  if (/<(filter|foreignObject|style|text|image)\b/.test(svg)) problems.push(`${rel}: element flutter_svg does not draw (${svg.match(/<(filter|foreignObject|style|text|image)\b/)[1]})`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

const names = (o) => Object.keys(o).sort();
const dartList = (a) => "{" + a.map((s) => `'${s}'`).join(", ") + "}";
const index = `// GENERATED by scripts/export-flutter-art.mjs — run \`npm run flutter:art\`.
// Which drawings exist, so the app asks before it tries to load one.
library;

/// Slugs with their own hero scene (PlaceArt); the rest use their category's.
const Set<String> kPlaceArtSlugs = ${dartList(names(grabbed["place-art"]))};

/// Slugs with a bespoke 48-grid mark; the rest use their category's icon.
const Set<String> kPlaceMarkSlugs = ${dartList(names(marks))};

const Set<String> kCategoryIconKeys = ${dartList(names(grabbed["category-icon"]))};

const Set<String> kUiIconNames = ${dartList(names(grabbed.icon))};
`;

if (CHECK) {
  let stale = !existsSync(INDEX) || readFileSync(INDEX, "utf8") !== index;
  for (const [rel, svg] of files) {
    const p = join(OUT, rel);
    if (!existsSync(p) || readFileSync(p, "utf8") !== svg) stale = true;
  }
  if (stale) {
    console.error("flutter art is stale — run `npm run flutter:art`");
    process.exit(1);
  }
  console.log(`flutter art current (${files.size} svgs)`);
} else {
  for (const sub of ["category", "place", "mark", "cat-icon", "icon"]) {
    rmSync(join(OUT, sub), { recursive: true, force: true });
    mkdirSync(join(OUT, sub), { recursive: true });
  }
  for (const [rel, svg] of files) writeFileSync(join(OUT, rel), svg);
  writeFileSync(INDEX, index);
  console.log(`wrote ${files.size} svgs → flutter_app/assets/art (${Object.keys(marks).length} marks, ${Object.keys(grabbed["place-art"]).length} place scenes)`);
}
