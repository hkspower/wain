#!/usr/bin/env node
/**
 * deploy:plan's refusal of drawn stand-ins (scripts/lib/stand-ins.mjs), both
 * ways.
 *
 * The pictures of «معالم الكويت» are drawings until the real ones are made and
 * approved, and a drawing must not reach the live site in any slot. A normal
 * build leaves them out; this proves that the export in out/ is judged right
 * whichever kind it is — a normal build passes, a preview build
 * (NEXT_PUBLIC_SHOW_STANDINS=1) is refused for its files, for the pages that
 * show them and for its marker — and that each of the three is enough on its
 * own, on small archives made here, with a control that a picture which is not
 * a stand-in passes.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, MODULES, standInProblems } from "../scripts/lib/stand-ins.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const tmp = mkdtempSync(join(tmpdir(), "stand-ins-"));

let pass = 0;
const fails = [];
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? `\n      ${d}` : ""}`); }
};

const zip = (dir, name) => {
  execFileSync("zip", ["-qr", join(tmp, name), "."], { cwd: dir });
  return join(tmp, name);
};
function archiveOf(name, files) {
  const dir = join(tmp, name);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    if (typeof body === "string") writeFileSync(join(dir, path), body);
    else copyFileSync(body.from, join(dir, path));
  }
  return zip(dir, `${name}.zip`);
}

console.log("\n── the export in out/ ──");
const preview = readFileSync(join(OUT, "index.html"), "utf8").includes('data-preview="stand-ins"');
const whole = standInProblems(zip(OUT, "out.zip"), read);
if (preview) {
  ok("a preview build is refused for the stand-in files in it", whole.shipped.length > 0, String(whole.shipped.length));
  ok("…for the pages that show one", whole.naming.length > 0, String(whole.naming.length));
  ok("…and for the marker on its pages", whole.marked.length > 0, String(whole.marked.length));
} else {
  ok("a normal build passes: no stand-in file, no page naming one, no marker", describe(whole).length === 0, describe(whole).join("; "));
}

console.log("\n── each of the three is enough on its own ──");
// The first stand-in file the modules name, whichever slot it is for.
const stand = MODULES.map(read)
  .flatMap((t) => t.match(/\{[^{}]*\}/g) ?? [])
  .filter((e) => /source: "stand-in"/.test(e))
  .flatMap((e) => [...e.matchAll(/\/home\/landmarks\/([^\s",]+)/g)].map((m) => m[1]))[0];
if (!stand) {
  console.log("  (every picture is real — there is no stand-in left to plant)");
} else {
  const clean = "<!doctype html><html lang=\"ar\"><body>وين</body></html>";
  const file = { from: join(ROOT, "public/home/landmarks", stand) };
  const shipped = standInProblems(archiveOf("shipped", { "index.html": clean, [`home/landmarks/${stand}`]: file }), read);
  ok("a stand-in's file in the archive is refused", shipped.shipped.length === 1 && describe(shipped).length === 1, describe(shipped).join("; "));
  const naming = standInProblems(archiveOf("naming", { "index.html": `<img src="/home/landmarks/${stand}" alt="">` }), read);
  ok("a page that names one is refused, file or not", naming.naming.length === 1 && describe(naming).length === 1, describe(naming).join("; "));
  const payload = standInProblems(archiveOf("payload", { "index.html": clean, "places/x/index.txt": `["$","img",null,{"src":"/home/landmarks/${stand}"}]` }), read);
  ok("…and so is the router's .txt payload", payload.naming.length === 1, describe(payload).join("; "));
  const marked = standInProblems(archiveOf("marked", { "index.html": '<html lang="ar" data-preview="stand-ins"></html>' }), read);
  ok("the preview marker alone is refused", marked.marked.length === 1 && describe(marked).length === 1, describe(marked).join("; "));
  const control = standInProblems(archiveOf("control", { "index.html": clean, "home/landmarks/not-a-stand-in-960.webp": file }), read);
  ok("control: a picture that is not a stand-in passes", describe(control).length === 0, describe(control).join("; "));
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
