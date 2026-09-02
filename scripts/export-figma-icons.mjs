#!/usr/bin/env node
/**
 * Export the icon set as Figma-importable SVG sheets:  npm run figma:icons
 *
 * The design-system library in Figma was meant to receive these icons through
 * the MCP server, one `use_figma` call per batch. That route is shut: the plan
 * this account is on allows twenty MCP tool calls a MONTH, and fifty-seven
 * components cannot be built and validated inside twenty calls — the
 * foundations alone consumed them.
 *
 * So the icons travel as SVG instead. A designer drags one sheet onto a Figma
 * page, selects everything, and picks «Create multiple components»: because
 * every icon is a group whose `id` is its component name, the components come
 * out named `Icon/Palm`, `Mark/kuwait-towers` and so on — which is exactly the
 * slash-separated naming an INSTANCE_SWAP picker groups into folders. Nothing
 * is hand-traced and nothing is retyped.
 *
 * The geometry is read the same way `gen-design-system.mjs` reads it: the
 * components are bundled, rendered in a real browser, and the SVG is taken out
 * of the DOM. Parsing the TSX would be faster and would describe the source
 * rather than the thing the site paints.
 *
 *   --check   render and compare, write nothing, exit 1 if the sheets are stale.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTDIR = join(ROOT, "docs/figma");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const CHECK = process.argv.includes("--check");

const COLS = 8;
const GAP = 16;
/** The ink the site draws icons in — `currentColor` needs something to resolve to. */
const INK = "#35302a";

const dir = mkdtempSync(join(tmpdir(), "wain-svg-"));
/* The harness has to live inside the repo or esbuild cannot resolve react-dom
   — the same constraint gen-design-system.mjs documents. */
const harness = join(ROOT, "tests/harness/_figma-icons.tsx");
mkdirSync(join(ROOT, "tests/harness"), { recursive: true });

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
try {
  execFileSync("npx", ["-y", "esbuild", harness, "--bundle", "--format=iife", "--jsx=automatic",
    `--alias:@=${join(ROOT, "src")}`, '--define:process.env.NODE_ENV="production"',
    `--outfile=${bundle}`, "--log-level=error"], { cwd: ROOT });
} finally {
  rmSync(harness, { force: true });
}
writeFileSync(join(dir, "index.html"),
  `<!doctype html><meta charset="utf-8"><div id="r"></div><script src="harness.js"></script>`);

const { chromium } = await import("playwright");
const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage();
await page.goto("file://" + join(dir, "index.html"));
await page.waitForSelector("#ui i svg");

const grabbed = await page.evaluate(() => {
  const strip = (svg) => {
    const el = svg.cloneNode(true);
    el.removeAttribute("class");
    el.removeAttribute("width");
    el.removeAttribute("height");
    const attrs = {};
    for (const a of el.attributes) attrs[a.name] = a.value;
    return { attrs, body: el.innerHTML };
  };
  const ui = [...document.querySelectorAll("#ui i")].map((i) => ({
    name: i.dataset.name, ...strip(i.querySelector("svg")),
  }));
  const marks = [...document.querySelectorAll("#marks i")].map((i) => {
    const svg = i.querySelector("svg");
    return { slug: i.dataset.slug, name: i.dataset.name, cat: i.dataset.cat,
      ...(svg ? strip(svg) : { attrs: {}, body: "" }) };
  });
  return { ui, marks };
});
await browser.close();
rmSync(dir, { recursive: true, force: true });

/* A place with no drawing of its own falls through to its category icon, which
   is drawn on the 24 grid; the bespoke marks are drawn on 48. Shipping the
   fallbacks would put eight copies of the same coffee cup in the library under
   eight different café names. */
const drawn = grabbed.marks.filter((m) => m.attrs.viewBox === "0 0 48 48");

/**
 * Lay a set of icons out on a grid inside one SVG document.
 *
 * Each icon becomes `<g id="Icon/Palm">`, because Figma's SVG import names a
 * layer from its `id` — and a slash in that name is what makes the component
 * land in a folder rather than loose at the top level of the swap picker.
 */
function sheet(items, { size, prefix, title }) {
  const rows = Math.ceil(items.length / COLS);
  const pitch = size + GAP;
  const w = COLS * pitch - GAP;
  const h = rows * pitch - GAP;

  const cells = items.map((it, n) => {
    const x = (n % COLS) * pitch;
    const y = Math.floor(n / COLS) * pitch;
    /* Everything the root <svg> was carrying — stroke, stroke-width, fill,
       linecap — has to move onto the group, or the paths lose it. viewBox and
       xmlns belong to the document, not the icon. */
    const carried = Object.entries(it.attrs)
      .filter(([k]) => k !== "viewBox" && k !== "xmlns" && k !== "aria-hidden" && k !== "focusable")
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
    const id = `${prefix}${it.key}`;
    return `  <g id="${id}" data-name="${id}" transform="translate(${x} ${y})"${carried ? " " + carried : ""}>\n` +
      `    ${it.body.trim()}\n  </g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
    `viewBox="0 0 ${w} ${h}" color="${INK}" fill="none">\n` +
    `  <title>${title}</title>\n${cells.join("\n")}\n</svg>\n`;
}

const uiSheet = sheet(
  grabbed.ui.map((i) => ({ key: i.name, attrs: i.attrs, body: i.body })),
  { size: 24, prefix: "Icon/", title: "Wain — UI icons" }
);
const markSheet = sheet(
  drawn.map((m) => ({ key: m.slug, attrs: m.attrs, body: m.body })),
  { size: 48, prefix: "Mark/", title: "Wain — place marks" }
);

const README = `# Figma import sheets

Generated by \`npm run figma:icons\` — do not hand-edit. Regenerate after any
change to \`src/components/icons.tsx\` or \`src/components/PlaceIcon.tsx\`;
\`npm run figma:icons:check\` fails if these are stale.

| Sheet | Contents | Grid |
|---|---|---|
| \`wain-icons-ui.svg\` | ${grabbed.ui.length} UI icons | 24 |
| \`wain-icons-places.svg\` | ${drawn.length} bespoke place marks of ${grabbed.marks.length} places | 48 |

## Getting them into Figma as components

1. Drag one sheet onto a page in the design-system file.
2. Select the imported frame and ungroup it once, so the icon groups are
   top-level.
3. Select all → right-click → **Create multiple components**.

Every icon arrives already named — \`Icon/Palm\`, \`Mark/kuwait-towers\` — so the
components come out in folders, which is what makes them usable as an
INSTANCE_SWAP set rather than a flat list of fifty-seven names.

## Why SVG and not the MCP server

The library's variables and styles were written straight into Figma through the
MCP server. The icons could not follow: the plan on this account allows twenty
MCP tool calls per month, and fifty-seven components cannot be created and
validated within that. The geometry here is read out of the rendered
components, so it is the same source of truth either way — only the transport
differs.

## What the sheets deliberately leave out

${grabbed.marks.length - drawn.length} of the ${grabbed.marks.length} places have no drawing of their own and fall back to
their category icon. They are excluded: importing them would put the same
drawing into the library several times under several different place names.
`;

const files = [
  [join(OUTDIR, "wain-icons-ui.svg"), uiSheet],
  [join(OUTDIR, "wain-icons-places.svg"), markSheet],
  [join(OUTDIR, "README.md"), README],
];

if (CHECK) {
  const stale = files.filter(([f, want]) => !existsSync(f) || readFileSync(f, "utf8") !== want);
  if (stale.length) {
    console.error("\n✗ docs/figma is out of date with the components it exports.");
    for (const [f] of stale) console.error("    " + f.replace(ROOT + "/", ""));
    console.error("  Run: npm run figma:icons\n");
    process.exit(1);
  }
  console.log(`figma sheets: ${grabbed.ui.length} UI icons and ${drawn.length}/${grabbed.marks.length} place marks, all current.`);
} else {
  mkdirSync(OUTDIR, { recursive: true });
  for (const [f, content] of files) writeFileSync(f, content);
  console.log(`docs/figma written — ${grabbed.ui.length} UI icons, ${drawn.length} place marks ` +
    `of ${grabbed.marks.length} places.`);
}
