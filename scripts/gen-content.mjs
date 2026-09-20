#!/usr/bin/env node
/**
 * Everything the site holds, as one list.  npm run content
 *
 * There was no answer to «what is actually on wain» that did not mean reading
 * a 3,000-line catalogue. The counts that did exist were written by hand in
 * prose and had already drifted: `place-kit.ts` and `places.ts` both said 53
 * records against a catalogue of 52, which this script is what found. A
 * hand-written inventory is that same mistake with far more surface area.
 *
 * So this is generated, by bundling the REAL modules with esbuild and asking
 * them — the same trick `audit:places` and `mcp/wain-mcp.mjs` use, for the
 * same reason. A JSON snapshot or a typed table would be correct the day it
 * was written and wrong the first time somebody edited one and not the other,
 * and an inventory that disagrees with the site is worse than no inventory.
 *
 * `--check` re-renders and diffs against the committed file, so `npm run scan`
 * fails when the two part company rather than letting the document rot.
 *
 * WHAT IT DELIBERATELY DOES NOT DO is describe the live site. Everything here
 * is read out of `src/`, which is the code that would ship on the next deploy
 * — see CLAUDE.md's «The live build id trails HEAD on purpose». A field that
 * is empty here is empty in the repository, not necessarily on the server.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { globSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs/content.md");
const check = process.argv.includes("--check");

/* ── load the real modules ────────────────────────────────────────────────
   One esbuild call per entry point. `places.ts` re-exports everything in
   `place-kit.ts`, so the categories and the counting forms come with it. */
const tmp = mkdtempSync(join(tmpdir(), "wain-content-"));
const load = async (rel) => {
  const bundle = join(tmp, rel.replace(/[/.]/g, "_") + ".mjs");
  execSync(
    `npx -y esbuild ${JSON.stringify(join(ROOT, rel))} --bundle --format=esm ` +
      `--alias:@=${JSON.stringify(join(ROOT, "src"))} ` +
      `--outfile=${JSON.stringify(bundle)} --log-level=error`,
    { cwd: ROOT, stdio: "pipe" }
  );
  return import(pathToFileURL(bundle).href);
};

const { places, categories } = await load("src/lib/places.ts");
const { HUB_ACTIONS } = await load("src/lib/wain-hub.ts");
const { PERSONAS, buildClipLines, forSpeech } = await load("src/lib/voice-lines.ts");
rmSync(tmp, { recursive: true, force: true });

/* ── routes ───────────────────────────────────────────────────────────────
   The title comes out of `export const metadata`, by regex, which is fragile
   on purpose: a route whose title cannot be found FAILS rather than being
   quietly listed as untitled. The two exceptions are named individually —
   `/` inherits the layout's default and a place page builds its title in
   `generateMetadata`, so neither has a literal to read. */
const TITLE_EXCEPTIONS = {
  "src/app/page.tsx": { path: "/", title: null, note: "layout default" },
  "src/app/places/[slug]/page.tsx": {
    path: "/places/<slug>/",
    title: null,
    note: `generateMetadata, ${places.length} pages`,
  },
};

const pageFiles = globSync("src/app/**/page.tsx", { cwd: ROOT }).sort();
const routes = [];
for (const f of pageFiles) {
  const src = readFileSync(join(ROOT, f), "utf8");
  const noindex = /robots:\s*\{[^}]*index:\s*false/.test(src);
  const exception = TITLE_EXCEPTIONS[f];
  if (exception) {
    routes.push({ ...exception, file: f, noindex });
    continue;
  }
  const m = src.match(/export const metadata[^=]*=\s*\{\s*\n\s*title:\s*"([^"]+)"/);
  if (!m) {
    console.error(
      `gen-content: ${f} has no readable metadata title.\n` +
        `  Either give it one, or add it to TITLE_EXCEPTIONS with the reason.`
    );
    process.exit(1);
  }
  const path = "/" + relative(join(ROOT, "src/app"), join(ROOT, dirname(f))) + "/";
  routes.push({ path: path === "//" ? "/" : path, title: m[1], note: null, file: f, noindex });
}

/* ── derived rollups ──────────────────────────────────────────────────────
   Areas are counted off `areaAr` rather than read from a list of areas.
   There was a `src/lib/areas.ts`, and the rollback in f72759e took it out
   again, so the catalogue is the only place the areas exist today. Counting
   them here cannot go stale the way a second list would. */
const byCategory = new Map(categories.map((c) => [c.id, []]));
for (const p of places) byCategory.get(p.category).push(p);

const byArea = new Map();
for (const p of places) {
  if (!byArea.has(p.areaAr)) byArea.set(p.areaAr, []);
  byArea.get(p.areaAr).push(p);
}
const areas = [...byArea.entries()].sort(
  (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "ar")
);

const has = (fn) => places.filter(fn).length;
const price = (n) => "·".repeat(n) + ` (${n})`;

/* Optional fields, with what an empty one MEANS — which is the part a bare
   count gets wrong. `shisha` absent is «we do not know», never «no»; see the
   field's own comment in places.ts. */
const COVERAGE = [
  ["rating", (p) => p.rating !== undefined, "absent = no rating known, not zero"],
  ["coordsUnverified", (p) => p.coordsUnverified, "drafted coordinate, pin is approximate"],
  ["summerOk", (p) => p.summerOk, "outdoors that summer does not ruin"],
  ["shisha", (p) => p.shisha, "absent = unknown, never «no»"],
  ["featured", (p) => p.featured, "shown on the home page rail"],
  ["logoUrl", (p) => p.logoUrl, "business profile — set when an owner registers"],
  ["bioAr", (p) => p.bioAr, "the business in its own words"],
  ["imageUrls", (p) => p.imageUrls?.length, "admin-approved photos"],
  ["phone", (p) => p.phone, "the place's public number"],
  ["instagram", (p) => p.instagram, "bare handle"],
  ["website", (p) => p.website, "scheme-checked at the database"],
  ["productsAr", (p) => p.productsAr?.length, "what it sells, one line each"],
  ["menuAr", (p) => p.menuAr?.length, "priced items"],
  ["acceptsOrders", (p) => p.acceptsOrders, "the business's own switch"],
  ["salonKind", (p) => p.salonKind, "men's or women's, never both"],
  ["takesQueue", (p) => p.takesQueue, "the salon's own switch"],
];

/* The two features whose gate is a PAIR of fields. Counting one of them alone
   is how «ordering is built» gets read as «ordering works»: a menu without
   the switch takes no orders, and the switch without a menu has nothing to
   sell. 0 of 52 is the number that matters and it needs both. */
const ordering = has((p) => p.acceptsOrders && p.menuAr?.length);
const queueing = has((p) => p.takesQueue && p.salonKind);

const clipLines = buildClipLines("shouq", places);
const clipChars = (persona) =>
  Object.values(buildClipLines(persona, places)).reduce((n, l) => n + forSpeech(l).length, 0);

/* ── render ───────────────────────────────────────────────────────────────
   Arabic-Indic digits are the site's, not this document's: a maintenance
   inventory is read in a terminal and in a diff, where Western digits sort
   and grep the way a reader expects. The prose stays Arabic where it is
   quoted from the catalogue. */
const L = [];
const w = (s = "") => L.push(s);
const row = (cells) => w(`| ${cells.join(" | ")} |`);
const rule = (n) => w(`|${" --- |".repeat(n)}`);

w("# What is on wain");
w();
w("Generated — `npm run content`. Do not edit by hand; `npm run content:check`");
w("re-renders from `src/lib/` and fails when this file and the code disagree.");
w();
w("It describes **the repository**, not the live site. The deployed build");
w("trails HEAD on purpose (CLAUDE.md, *The live build id trails HEAD*), so an");
w("empty field here is empty in the code, which is a different claim from");
w("empty on the server.");
w();

w("## At a glance");
w();
row(["", "count"]);
rule(2);
row(["places", places.length]);
row(["categories", categories.length]);
row(["areas (distinct `areaAr`)", areas.length]);
row(["routes (files under `src/app`)", routes.length]);
row(["pages built", routes.length - 1 + places.length]);
row(["hub actions", HUB_ACTIONS.length]);
row(["voice clip lines, per persona", Object.keys(clipLines).length]);
w();
w(
  `Ordering is live on **${ordering} of ${places.length}** places and the queue on ` +
    `**${queueing}** — both need two fields set together, so read the pair, not ` +
    `either count in the coverage table below.`
);
w();

w("## Routes");
w();
row(["path", "title", "notes"]);
rule(3);
for (const r of routes) {
  const notes = [r.note, r.noindex ? "noindex" : null].filter(Boolean).join(", ");
  row([`\`${r.path}\``, r.title ?? "—", notes || ""]);
}
w();

w("## Categories");
w();
row(["id", "عربي", "english", "places", "blurb"]);
rule(5);
for (const c of categories) {
  row([`\`${c.id}\``, c.ar, c.en, byCategory.get(c.id).length, c.blurbAr]);
}
w();

w("## Areas");
w();
w("Counted off `areaAr` in the catalogue. There is no list of areas to read:");
w("`src/lib/areas.ts` existed and the rollback in `f72759e` removed it, so the");
w("places themselves are the only source today.");
w();
row(["منطقة", "places"]);
rule(2);
for (const [ar, list] of areas) row([ar, list.length]);
w();

w("## The catalogue");
w();
w("`price` is 1–3. `setting` is whether it works at 48°C — `mixed` means a");
w("real indoor refuge, not air-conditioned shops along a street. A blank");
w("`rating` means none is known, not zero.");
for (const c of categories) {
  const list = byCategory.get(c.id);
  w();
  w(`### ${c.ar} — \`${c.id}\` (${list.length})`);
  w();
  row(["الاسم", "slug", "منطقة", "price", "rating", "setting", "موسم"]);
  rule(7);
  for (const p of list) {
    row([
      p.nameAr,
      `\`${p.slug}\``,
      p.areaAr,
      price(p.priceLevel),
      p.rating ?? "",
      p.setting + (p.summerOk ? " +صيف" : ""),
      p.seasonAr,
    ]);
  }
}
w();

w("## Field coverage");
w();
w("Optional fields, and how many of the " + places.length + " carry one.");
w("The meaning of an empty cell is in the last column and is not always «no».");
w();
row(["field", `set`, "what absent means"]);
rule(3);
for (const [name, fn, meaning] of COVERAGE) {
  row([`\`${name}\``, `${has(fn)}`, meaning]);
}
w();

w("## What the catalogue cannot answer yet");
w();
const gaps = COVERAGE.filter(([, fn]) => has(fn) === 0).map(([n]) => `\`${n}\``);
if (gaps.length) {
  w(`Nothing in the catalogue sets ${gaps.join(", ")}.`);
  w();
  w("That is why the business profile, ordering and the queue render nothing");
  w("anywhere on the site today — the panels return `null` rather than being");
  w("hidden, so there is no empty state to find. Registering a business is");
  w("what fills them, and registration needs the back end (CLAUDE.md, *The");
  w("back end is not configured*).");
} else {
  w("Every optional field is set somewhere in the catalogue.");
}
w();

w("## What wain can do");
w();
w("`src/lib/wain-hub.ts` — one list, drawn by `SearchHub` and served by the");
w("MCP server as `list_actions`, so both surfaces name the same moves.");
w();
row(["id", "عربي", "english", "kind", "href"]);
rule(5);
for (const a of HUB_ACTIONS) {
  row([`\`${a.id}\``, a.ar, a.en, a.kind, `\`${a.href}\``]);
}
w();

w("## Voice");
w();
w("Two personas, one recorded line set each — a greeting, the generic lines,");
w("and three lines per place (suggestion, short name, best time).");
w();
row(["persona", "الاسم", "وصف", "lines", "characters"]);
rule(5);
for (const p of Object.values(PERSONAS)) {
  row([`\`${p.id}\``, p.nameAr, p.descAr, Object.keys(clipLines).length, clipChars(p.id)]);
}
w();
w(
  `**${clipChars("shouq") + clipChars("salem")} characters** for the whole library, which is the ` +
    "number that argues for caching it in CI rather than re-rendering it — see"
);
w("CLAUDE.md, *صوت وين cannot be generated from a session*.");
w();

const rendered = L.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";

if (check) {
  if (!existsSync(OUT)) {
    console.error("gen-content: docs/content.md is missing. Run: npm run content");
    process.exit(1);
  }
  const committed = readFileSync(OUT, "utf8");
  if (committed !== rendered) {
    console.error(
      "gen-content: docs/content.md is out of date with src/lib.\n" +
        "  Run: npm run content — and read the diff, it is the content that changed."
    );
    process.exit(1);
  }
  console.log(
    `content: ${places.length} places, ${categories.length} categories, ` +
      `${areas.length} areas, ${routes.length} routes — docs/content.md is current ✓`
  );
} else {
  writeFileSync(OUT, rendered);
  console.log(
    `content: wrote docs/content.md — ${places.length} places, ` +
      `${categories.length} categories, ${areas.length} areas, ${routes.length} routes, ` +
      `${HUB_ACTIONS.length} actions`
  );
}
