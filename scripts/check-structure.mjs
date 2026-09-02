#!/usr/bin/env node
// The repository's own shape, checked.
//
//   npm run check:structure
//   npm run check:structure:rules      (self-test)
//
// Everything else in scripts/ checks the GAME. This checks the repo:
// whether the map in README.md still describes the tree, whether the
// npm scripts are still grouped, and whether anybody's scratch file has
// been committed again.
//
// It exists because all three had quietly rotted at once. The README's
// "Project structure" listed a place-directory website and nothing else
// while a racing engine, two console ports, a hub server, 68 tests and
// 54 browser probes grew around it. package.json had 114 scripts in 27
// separate blocks, with `test:` scattered across five of them. And
// shot3-tmp.mjs — a throwaway browser probe from one afternoon — had
// been committed and had sat in the tree ever since.
//
// None of those breaks a build, which is exactly why nothing caught
// them. A map nobody maintains is worse than no map, because it is
// believed.
//
// WHAT IT CANNOT DO. It has no opinion about whether the arrangement is
// a GOOD one: it cannot say that tests/ should be split by subject, or
// that a script belongs in one group rather than another. Every rule
// below compares the repo against something already written down in the
// repo — the README block, the file system, the git index — so a rule
// can be wrong about taste but not about fact.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const fail = [];
const bad = (why) => fail.push(why);

// Directories that are never in the map: build output, dependencies,
// and the editor's own leavings. Ignored rather than listed, because
// listing them would mean the map described things a reader should not
// have to know about.
const INVISIBLE = new Set([
  "node_modules", ".git", ".next", ".vercel", "out", "build",
  "ios", "android", "__pycache__",
]);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const scripts = pkg.scripts ?? {};

// ---------------------------------------------------------------------
// 1. Every path an npm script names exists.
//
// A script pointing at a file somebody moved or deleted fails only when
// somebody runs it, and half of these are run about once a quarter.
{
  const seen = new Set();
  for (const [name, cmd] of Object.entries(scripts)) {
    for (const m of cmd.matchAll(/(?:^|[\s"'])((?:tests|tools|scripts|server)\/[\w./-]+\.(?:mjs|js|py))/g)) {
      seen.add(m[1]);
      if (!existsSync(m[1])) bad(`npm script "${name}" runs ${m[1]}, which does not exist`);
    }
  }
}

// ---------------------------------------------------------------------
// 2. Each script namespace is one contiguous run.
//
// package.json is a list a person reads with their eyes, and the only
// thing that makes 114 entries navigable is that everything of a kind
// sits together. New scripts get appended wherever the last edit
// happened to end, which is how `test:` came to be in five places.
//
// Contiguity rather than alphabetical order on purpose: the groups are
// in the order somebody needs them — run it, ship it, regenerate it,
// check it, test it — and sorting the whole list would destroy that.
{
  const runs = [];
  let prev = null;
  for (const k of Object.keys(scripts)) {
    const ns = k.split(":")[0];
    if (ns !== prev) { runs.push(ns); prev = ns; }
  }
  const split = runs.filter((ns, i) => runs.indexOf(ns) !== i);
  for (const ns of new Set(split)) {
    bad(`npm scripts starting "${ns}" are in more than one block — keep a namespace together`);
  }
}

// ---------------------------------------------------------------------
// 3. No scratch file is tracked.
//
// Browser probes get written at the repo root because a file outside
// the project cannot resolve playwright-core, so the root collects
// them. .gitignore now carries the pattern; this catches anything that
// was committed before it did, which is how shot3-tmp.mjs survived.
{
  let tracked = [];
  try {
    tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    // Not a git checkout (a tarball, a container without .git). Say so
    // rather than passing silently: a rule that cannot run has not run.
    bad("cannot read the git index, so the scratch-file rule did not run");
  }
  for (const f of tracked) {
    if (/(^|\/)[\w.-]*-tmp\.(mjs|js|py|ts)$/.test(f)) {
      bad(`${f} is a scratch file and it is committed — delete it, .gitignore already has the pattern`);
    }
  }
}

// ---------------------------------------------------------------------
// 4. The README's map and the tree agree, both ways.
//
// Read from the fenced block under "## Project structure". A directory
// in the tree and not in the map is the failure that actually happened:
// the map went on describing a website while a game arrived beside it.
// The reverse — named but gone — is the failure that happens next, when
// somebody moves a directory and the map keeps promising it.
{
  const readme = readFileSync("README.md", "utf8");
  const at = readme.indexOf("## Project structure");
  if (at < 0) {
    bad("README.md has no \"## Project structure\" section to check against");
  } else {
    const fences = [...readme.slice(at).matchAll(/```/g)];
    if (fences.length < 2) {
      bad("the Project structure section has no fenced block in it");
    } else {
      const block = readme.slice(at + fences[0].index + 3, at + fences[1].index);

      // A TOP-LEVEL claim is a name in column zero. The map also names
      // nested directories — app/, shots/, api/grn/ — indented under
      // their parent or written as a path, and those are description
      // rather than a claim about the root. Matching every "word/" in
      // the block instead reported that the repo was missing grn/ and
      // cars/, which are real directories inside api/ and press/. A
      // rule that fires on a correct map is the thing this file's own
      // header warns about.
      const named = new Set();
      for (const line of block.split("\n")) {
        const m = /^([A-Za-z][\w.-]*)\/(?:\s|$)/.exec(line);
        if (m) named.add(m[1]);
      }

      const onDisk = readdirSync(".", { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !INVISIBLE.has(e.name))
        .map((e) => e.name);

      for (const d of onDisk) {
        if (!named.has(d)) bad(`${d}/ is in the repo but not in the README's structure map`);
      }
      for (const d of named) {
        if (!onDisk.includes(d)) bad(`the README's structure map names ${d}/ at the top level, which is not in the repo`);
      }
    }
  }
}

// ---------------------------------------------------------------------
// Does any of it fire?
//
// Same argument as check-arabic-grammar.mjs: a checker whose subject is
// clean reports "pass" whether its rules work or not. Each rule below is
// pointed at a planted fault and has to catch it.
if (process.argv.includes("--self-test")) {
  const probes = [
    ["missing target", () => {
      const s = { "test:ghost": "node tests/definitely-not-here.mjs" };
      for (const [name, cmd] of Object.entries(s)) {
        for (const m of cmd.matchAll(/((?:tests|tools)\/[\w./-]+\.mjs)/g)) {
          if (!existsSync(m[1])) return `runs ${m[1]}, which does not exist`;
        }
      }
      return null;
    }],
    ["split namespace", () => {
      const keys = ["test:a", "check:b", "test:c"];
      const runs = [];
      let prev = null;
      for (const k of keys) { const ns = k.split(":")[0]; if (ns !== prev) { runs.push(ns); prev = ns; } }
      const split = runs.filter((ns, i) => runs.indexOf(ns) !== i);
      return split.length ? `${split[0]} in more than one block` : null;
    }],
    ["scratch tracked", () =>
      /(^|\/)[\w.-]*-tmp\.(mjs|js|py|ts)$/.test("shot3-tmp.mjs") ? "shot3-tmp.mjs caught" : null],
    ["!a real file is not scratch", () =>
      /(^|\/)[\w.-]*-tmp\.(mjs|js|py|ts)$/.test("tools/shots/cardthumbs.mjs") ? "fired on a real tool" : null],
    ["undocumented directory", () => {
      const named = new Set(["src", "tests"]);
      const onDisk = ["src", "tests", "brandnew"];
      const miss = onDisk.filter((d) => !named.has(d));
      return miss.length ? `${miss[0]}/ not in the map` : null;
    }],
    // The map's own parsing, both ways round. A nested path must not be
    // read as a claim about the root — that false positive is why this
    // fixture exists.
    ["!nested path is not a top-level claim", () => {
      const block = "src/\n\u251c\u2500\u2500 app/\n\u2502   \u2514\u2500\u2500 api/grn/\npress/\n";
      const named = new Set();
      for (const line of block.split("\n")) {
        const m = /^([A-Za-z][\w.-]*)\/(?:\s|$)/.exec(line);
        if (m) named.add(m[1]);
      }
      const stray = [...named].filter((d) => d !== "src" && d !== "press");
      return stray.length ? `read ${stray.join(", ")} as top-level` : null;
    }],
    ["map names a directory that is gone", () => {
      const named = ["src", "attic"];
      const onDisk = ["src"];
      const gone = named.filter((d) => !onDisk.includes(d));
      return gone.length ? `${gone[0]}/ named but absent` : null;
    }],
  ];
  let broken = 0;
  for (const [name, run] of probes) {
    const mustFire = !name.startsWith("!");
    const got = run();
    if (mustFire && !got) { console.error(`  MISS  ${name}: nothing fired`); broken++; }
    else if (!mustFire && got) { console.error(`  FALSE ${name}: fired on a correct case — ${got}`); broken++; }
    else console.log(`  ok    ${name}`);
  }
  console.log(broken ? `\n${broken} rule(s) not working` : "\nevery rule fires on its own planted fault, and none fires on a correct one");
  process.exit(broken ? 1 : 0);
}

const groups = [];
{
  let prev = null;
  for (const k of Object.keys(scripts)) {
    const ns = k.split(":")[0];
    if (ns !== prev) { groups.push(ns); prev = ns; }
  }
}
console.log(`${Object.keys(scripts).length} npm scripts in ${groups.length} blocks`);
console.log(
  "rules        every script's target exists, one block per namespace,\n" +
  "             no scratch file committed, README's map matches the tree"
);
console.log(
  "not checked  whether the arrangement is a GOOD one — that a directory\n" +
  "             holds what it should, or a script sits in the right group.\n" +
  "             Every rule here compares the repo against something the\n" +
  "             repo already states, so it can be wrong about taste but\n" +
  "             not about fact."
);
if (fail.length) {
  console.error(`\n${fail.length} problem${fail.length > 1 ? "s" : ""}:\n`);
  for (const f of fail) console.error(`  ${f}`);
  process.exit(1);
}
console.log("\nthe tree, the map and the script list agree.");
