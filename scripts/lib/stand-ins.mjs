/**
 * Does a release archive carry a drawn stand-in of «معالم الكويت»?
 *
 * The pictures were built on drawings while the real ones could not be
 * generated (scripts/gen-landmarks.mjs), and a drawing must not reach the live
 * site in ANY slot — the slideshow, a card, a page top. A normal build leaves
 * them out and drops their files; this finds an archive that carries one
 * anyway, three ways, any one of them enough:
 *
 *   shipped   a stand-in's own file is in the archive;
 *   naming    a page (.html, or the .txt payload the router reads) names one;
 *   marked    a page carries the marker a preview build puts on <html>.
 *
 * `readModule(path)` returns a generated module's text AS IT WAS for the build
 * being checked — deploy:plan reads it out of git at the archive's commit, a
 * test reads the working tree. Entries are parsed one `{…}` at a time: a
 * pattern spanning two entries once named the wrong slug.
 *
 * Used by scripts/deploy-plan.mjs and tests/stand-ins.test.mjs.
 */
import { execFileSync } from "node:child_process";

export const MODULES = ["src/lib/landmarks.g.ts", "src/lib/landmark-cards.g.ts"];

export function standInProblems(archive, readModule) {
  const standIns = new Set();
  const files = new Set();
  for (const path of MODULES) {
    for (const entry of readModule(path).match(/\{[^{}]*\}/g) ?? []) {
      const slug = /slug: "([^"]+)"/.exec(entry)?.[1];
      const source = /source: "([a-z-]+)"/.exec(entry)?.[1];
      if (!slug || !source || source === "ai") continue;
      standIns.add(slug);
      for (const m of entry.matchAll(/\/home\/landmarks\/([^\s",]+)/g)) files.add(m[1]);
    }
  }
  const unzip = (args, max = 1 << 26) => execFileSync("unzip", args, { encoding: "utf8", maxBuffer: max });
  const names = unzip(["-Z1", archive]).split("\n").filter(Boolean);
  const shipped = names.filter((f) => f.startsWith("home/landmarks/") && files.has(f.slice("home/landmarks/".length)));
  const naming = [];
  const marked = [];
  for (const f of names.filter((n) => /\.(html|txt)$/.test(n))) {
    const body = unzip(["-p", archive, f]);
    if ([...files].some((s) => body.includes(s))) naming.push(f);
    if (body.includes('data-preview="stand-ins"') || body.includes('"data-preview":"stand-ins"')) marked.push(f);
  }
  return { standIns: [...standIns], shipped, naming, marked };
}

/** One sentence per way the archive carries a stand-in; empty when it is clean. */
export function describe({ shipped, naming, marked }) {
  const few = (list) => `${list.slice(0, 3).join(", ")}${list.length > 3 ? ", …" : ""}`;
  return [
    shipped.length && `${shipped.length} drawn stand-in file(s) are in it (${few(shipped)})`,
    naming.length && `${naming.length} page(s) show one (${few(naming)})`,
    marked.length && `${marked.length} page(s) carry the preview marker`,
  ].filter(Boolean);
}
