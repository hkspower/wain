#!/usr/bin/env node
/**
 * Regenerate the drawn half of the design system page:  npm run design
 *
 * `docs/design-system.html` is a good document with one structural problem: it
 * carried the icon set as a hand-copied `IC` object — thirty icons' worth of
 * path data, transcribed out of `icons.tsx`. Every colour in it is still
 * exactly right a month on, so the prose and the palette are not the risk. The
 * traced geometry is: redraw IconPalm in the code and the spec keeps showing
 * the old blob, with nothing anywhere to say the two had parted company. That
 * is the failure mode of a specification that is a copy — it goes on looking
 * authoritative after it stops being true.
 *
 * So the two blocks that trace real geometry are generated from the components
 * themselves and written between markers, and everything else in the file —
 * the prose, the ramps, the tokens, the recipes — stays hand-written where it
 * belongs.
 *
 * The icons are React components, so they are bundled and rendered in a real
 * browser and the resulting SVG is read back out of the DOM. That is slower
 * than parsing the TSX and it is the only way to be sure the page shows what
 * the site actually paints, including whatever the component decided at
 * runtime.
 *
 *   --check   compare only, write nothing, exit 1 if the doc is out of date.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = join(ROOT, "docs/design-system.html");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const CHECK = process.argv.includes("--check");

const dir = mkdtempSync(join(tmpdir(), "wain-ds-"));
/**
 * The harness has to live INSIDE the repo.
 *
 * It imports React, and a file in the system temp directory resolves its
 * imports from there — where there is no node_modules — so esbuild fails on
 * `react-dom/client` before it ever reaches an icon. Only the bundle and the
 * page it is served from can live in the temp directory.
 */
const harness = join(ROOT, "tests/harness/_design-system.tsx");

writeFileSync(harness, `
import { createRoot } from "react-dom/client";
import * as Icons from "${join(ROOT, "src/components/icons")}";
import PlaceIcon from "${join(ROOT, "src/components/PlaceIcon")}";
import { places } from "${join(ROOT, "src/lib/places")}";

const names = Object.keys(Icons).filter((k) => /^Icon[A-Z]/.test(k)).sort();
createRoot(document.getElementById("r")!).render(
  <>
    <div id="ui">
      {names.map((n) => {
        const C = (Icons as Record<string, any>)[n];
        return <i key={n} data-name={n.replace(/^Icon/, "")}><C /></i>;
      })}
    </div>
    <div id="marks">
      {places.map((p) => (
        <i key={p.slug} data-slug={p.slug} data-name={p.nameAr} data-cat={p.category}>
          <PlaceIcon slug={p.slug} />
        </i>
      ))}
    </div>
  </>
);
`);

const bundle = join(dir, "harness.js");
execFileSync("npx", ["-y", "esbuild", harness, "--bundle", "--format=iife", "--jsx=automatic",
  `--alias:@=${join(ROOT, "src")}`, '--define:process.env.NODE_ENV="production"',
  `--outfile=${bundle}`, "--log-level=error"], { cwd: ROOT });
writeFileSync(join(dir, "index.html"),
  `<!doctype html><meta charset="utf-8"><div id="r"></div><script src="harness.js"></script>`);

rmSync(harness, { force: true });

const { chromium } = await import("playwright");
const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage();
await page.goto("file://" + join(dir, "index.html"));
await page.waitForSelector("#ui i svg");

const grabbed = await page.evaluate(() => {
  /** The <svg> exactly as the component built it, minus what the page will set. */
  const strip = (svg) => {
    const el = svg.cloneNode(true);
    el.removeAttribute("class");
    el.removeAttribute("width");
    el.removeAttribute("height");
    return { attrs: [...el.attributes].map((a) => `${a.name}="${a.value}"`).join(" "), body: el.innerHTML };
  };
  const ui = [...document.querySelectorAll("#ui i")].map((i) => ({
    name: i.dataset.name, ...strip(i.querySelector("svg")),
  }));
  const marks = [...document.querySelectorAll("#marks i")].map((i) => {
    const svg = i.querySelector("svg");
    // A place with no drawing of its own falls through to its category mark;
    // the gallery has to say which is which or it overstates the set.
    const own = svg && !svg.hasAttribute("data-fallback");
    return { slug: i.dataset.slug, name: i.dataset.name, cat: i.dataset.cat,
      own, ...(svg ? strip(svg) : { attrs: "", body: "" }) };
  });
  return { ui, marks };
});
await browser.close();
rmSync(dir, { recursive: true, force: true });

/* PlaceIcon marks its fallbacks by rendering the category icon on a 24 grid;
   the bespoke ones are drawn on 48. That is the honest discriminator, and it
   comes from the geometry rather than from a list that would need maintaining. */
for (const m of grabbed.marks) m.own = /viewBox="0 0 48 48"/.test(m.attrs);

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "");
const uiBlock =
  "  /* GENERATED by scripts/gen-design-system.mjs — do not hand-edit. */\n" +
  "  var IC={\n" +
  grabbed.ui.map((i) => `    ${i.name.toLowerCase()}:{a:'${esc(i.attrs)}',b:'${esc(i.body)}'}`).join(",\n") +
  "\n  };\n";

const drawn = grabbed.marks.filter((m) => m.own);
const markBlock =
  "  /* GENERATED by scripts/gen-design-system.mjs — do not hand-edit. */\n" +
  `  var MARK_TOTAL=${grabbed.marks.length};\n` +
  "  var MARKS=[\n" +
  drawn.map((m) => `    {s:'${m.slug}',n:'${esc(m.name)}',c:'${m.cat}',a:'${esc(m.attrs)}',b:'${esc(m.body)}'}`).join(",\n") +
  "\n  ];\n";

const inject = (src, key, block) => {
  const open = `/* <${key}> */`, close = `/* </${key}> */`;
  const i = src.indexOf(open), j = src.indexOf(close);
  if (i < 0 || j < 0) {
    console.error(`design-system.html has no ${open} … ${close} markers — add them first.`);
    process.exit(1);
  }
  return src.slice(0, i + open.length) + "\n" + block + "  " + src.slice(j);
};

const before = readFileSync(DOC, "utf8");
let after = inject(before, "gen:icons", uiBlock);
after = inject(after, "gen:marks", markBlock);

if (CHECK) {
  if (after !== before) {
    console.error("\n✗ docs/design-system.html is out of date with the components it documents.");
    console.error("  The icon set or the place marks changed and the spec still shows the old");
    console.error("  geometry. Run: npm run design\n");
    process.exit(1);
  }
  console.log(`design-system: ${grabbed.ui.length} UI icons and ${drawn.length}/${grabbed.marks.length} place marks, all current.`);
} else {
  writeFileSync(DOC, after);
  console.log(`docs/design-system.html regenerated — ${grabbed.ui.length} UI icons, ` +
    `${drawn.length} drawn place marks of ${grabbed.marks.length} places.`);
}
