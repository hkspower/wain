// The assets are where the declaration says, and are the kind it says.
//
//   npm run check:assets
//
// scripts/lib/assets.mjs names every asset family in the repository and
// says whether it is a deliverable or instrument output. This proves
// that claim against the disk and against git, because the claim was
// wrong twice before it was written down once:
//
//   * press/README.md said "in four folders" and there were
//     twenty-seven.
//   * .gitignore carried a second, longer, differently-shaped list of
//     the same thing — twenty hand-written /press/xxx/ entries — and
//     nothing compared the two.
//
// Every rule below compares the repo against something the repo already
// states, so it can be wrong about taste but not about fact.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ASSETS } from "./lib/assets.mjs";

const problems = [];
const bad = (m) => problems.push(m);

const git = (args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

/** Does one of a family's `keep` globs match this path? */
const kept = (fam, rel) =>
  (fam.keep ?? []).some((g) => {
    const re = new RegExp(
      "^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$"
    );
    return re.test(rel.split("/").pop()) || re.test(rel);
  });

// ---- 1. The map covers everything, and everything it names is there --
//
// Both directions. A directory with no entry is an asset family nobody
// wrote down; an entry with no directory is a map describing a repo
// that has moved on.
{
  const onDisk = [];
  for (const root of ["press", "public"]) {
    if (!existsSync(root)) continue;
    for (const e of readdirSync(root)) {
      const p = join(root, e);
      if (statSync(p).isDirectory()) onDisk.push(p);
    }
  }
  const declared = new Set(ASSETS.map((a) => a.path));
  const unmapped = onDisk.filter((p) => !declared.has(p));
  // An `optional` family is one whose directory only appears when its
  // tool runs, so its absence is not a phantom.
  const phantom = ASSETS.filter((a) => !a.optional && !existsSync(a.path)).map((a) => a.path);
  for (const p of unmapped) bad(`${p}/ exists and is in no asset family — add it to scripts/lib/assets.mjs`);
  for (const p of phantom) bad(`the map names ${p}/ and it is not there`);
  console.log(
    `map          ${onDisk.length} asset directories, ${ASSETS.length} declared, ` +
      `${unmapped.length} unmapped, ${phantom.length} phantom`
  );
}

// ---- 2. Kept means committed; scratch means not -----------------------
//
// The distinction is the whole point of the declaration, and it is the
// one a tool breaks by accident: a new instrument writes into press/ and
// its output gets committed, or a deliverable is produced and never
// added. Both look like nothing from the outside.
{
  let keptFiles = 0, scratchFiles = 0;
  for (const fam of ASSETS) {
    if (!existsSync(fam.path)) continue;
    const tracked = new Set(git(["ls-files", fam.path]));
    const all = [];
    const walk = (d) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else all.push(p);
      }
    };
    walk(fam.path);

    if (fam.kind === "kept") {
      keptFiles += all.length;
      const loose = all.filter((p) => !tracked.has(p));
      if (loose.length) {
        bad(
          `${fam.path}/ is a deliverable and ${loose.length} file(s) are not committed: ` +
            loose.slice(0, 3).map((p) => p.replace(fam.path + "/", "")).join(", ") +
            (loose.length > 3 ? ", …" : "")
        );
      }
    } else if (fam.kind === "scratch") {
      scratchFiles += all.length;
      if (tracked.size) {
        bad(
          `${fam.path}/ is instrument output and ${tracked.size} file(s) are committed: ` +
            [...tracked].slice(0, 3).map((p) => p.replace(fam.path + "/", "")).join(", ")
        );
      }
    } else {
      // split: what the globs name must be tracked, and nothing else.
      const shouldKeep = all.filter((p) => kept(fam, p.replace(fam.path + "/", "")));
      keptFiles += shouldKeep.length;
      scratchFiles += all.length - shouldKeep.length;
      const missing = shouldKeep.filter((p) => !tracked.has(p));
      const extra = [...tracked].filter((p) => !kept(fam, p.replace(fam.path + "/", "")));
      if (missing.length) bad(`${fam.path}/ keeps ${fam.keep.join(", ")} and ${missing.length} of them are not committed`);
      if (extra.length) bad(`${fam.path}/ has ${extra.length} committed file(s) outside ${fam.keep.join(", ")}: ${extra.slice(0, 2).join(", ")}`);
    }
  }
  console.log(`kind         ${keptFiles} files kept, ${scratchFiles} regenerated on demand`);
}

// ---- 3. Scratch is actually ignored ----------------------------------
//
// "Not committed" and "cannot be committed by accident" are different
// claims, and only the second one survives somebody running `git add
// -A` after a tool has filled a directory with fifty-six renders.
{
  let unguarded = 0;
  for (const fam of ASSETS) {
    if (fam.kind === "kept" || !existsSync(fam.path)) continue;
    const all = [];
    const walk = (d) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else all.push(p);
      }
    };
    walk(fam.path);
    const loose = all.filter(
      (p) => !kept(fam, p.replace(fam.path + "/", "")) && git(["check-ignore", p]).length === 0
    );
    // A file that is already tracked is not "loose" — that is section
    // 2's complaint, and reporting it twice sends you to the wrong fix.
    const tracked = new Set(git(["ls-files", fam.path]));
    const real = loose.filter((p) => !tracked.has(p));
    if (real.length) {
      unguarded += real.length;
      bad(
        `${fam.path}/ is regenerated but ${real.length} file(s) are neither ignored nor committed — ` +
          `one \`git add -A\` away from the tree: ${real.slice(0, 2).join(", ")}`
      );
    }
  }
  console.log(`ignored      every regenerated family is guarded${unguarded ? ` — except ${unguarded} file(s)` : ""}`);
}

// ---- 4. Every family can still be rebuilt ----------------------------
{
  let handmade = 0, missing = 0;
  for (const fam of ASSETS) {
    if (fam.by === "—") { handmade++; continue; }
    if (!existsSync(fam.by)) { missing++; bad(`${fam.path}/ names a producer that is gone: ${fam.by}`); }
  }
  console.log(`producers    ${ASSETS.length - handmade - missing} scripted, ${handmade} made by hand`);
}

// ---- 5. The README's table IS the declaration, rendered ---------------
//
// The map that started all this said four folders where there were
// twenty-seven, so it is not maintained by hand any more: the table
// between the markers is GENERATED from ASSETS, and this compares what
// is in the file against what would be generated now.
//
// `npm run check:assets -- --write` puts it back. That is the whole
// mechanism — a map that can drift is a map that will, and the only
// map that cannot is one nobody edits.
{
  const START = "<!-- assets:begin -->";
  const END = "<!-- assets:end -->";
  const path = "press/README.md";
  const readme = existsSync(path) ? readFileSync(path, "utf8") : "";
  const table = renderTable();
  const i = readme.indexOf(START), j = readme.indexOf(END);
  if (i < 0 || j < 0) {
    bad(`${path} has no ${START} / ${END} markers to hold the generated table`);
  } else {
    const have = readme.slice(i + START.length, j).trim();
    if (have !== table.trim()) {
      if (process.argv.includes("--write")) {
        writeFileSync(path, readme.slice(0, i + START.length) + "\n" + table + "\n" + readme.slice(j));
        console.log(`README       rewritten from the declaration`);
      } else {
        bad(`${path}'s table is not what the declaration would generate — run: npm run check:assets -- --write`);
      }
    } else {
      console.log(`README       the table matches the declaration`);
    }
  }
}

/** The press kit's table, from ASSETS. */
function renderTable() {
  const rows = ASSETS.filter((a) => a.path.startsWith("press/"));
  const kindWord = { kept: "kept", scratch: "regenerated", split: "part kept" };
  const out = [
    "| Folder | What | Rebuild | |",
    "| --- | --- | --- | --- |",
  ];
  for (const a of rows) {
    const dir = a.path.replace("press/", "") + "/";
    const by = a.by === "—" ? "by hand" : `\`${a.by}\``;
    out.push(`| \`${dir}\` | ${a.what} | ${by} | ${kindWord[a.kind]} |`);
  }
  return out.join("\n");
}

// ---- 6. .gitignore is not a second list -------------------------------
//
// It was. Twenty-four hand-written /press/xxx/ entries, each with its
// own paragraph saying the thing it names is regenerated — which is the
// same fact the declaration now carries, written twice in two places
// that never agreed. Neither list is going away, so they are held to
// each other instead: every scratch family must be ignored, and every
// press path .gitignore names must be a family somebody declared.
{
  const ig = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : "";
  const declared = new Set(ASSETS.map((a) => a.path));
  const unguarded = ASSETS.filter(
    (a) => a.kind === "scratch" && !ig.includes(a.path)
  ).map((a) => a.path);
  for (const p of unguarded) bad(`${p}/ is declared scratch and .gitignore does not name it`);

  const named = [...ig.matchAll(/^\/?(press\/[a-z0-9-]+)\/\s*$/gm)].map((m) => m[1]);
  const stray = [...new Set(named)].filter((p) => !declared.has(p));
  for (const p of stray) bad(`.gitignore ignores ${p}/ and no asset family declares it`);
  console.log(
    `gitignore    ${named.length} press paths ignored, ${unguarded.length} scratch families unguarded, ${stray.length} stray`
  );
}

console.log(
  "\nrules        every family is declared, every declaration exists, kept is\n" +
    "             committed, scratch is ignored, producers resolve, and the\n" +
    "             press README names all of it, and .gitignore agrees.\n" +
    "not checked  whether a family is worth keeping. That is taste, and this\n" +
    "             file only compares the repo against what the repo says."
);

if (problems.length) {
  console.log(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}:\n`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
console.log("\nthe assets are arranged the way the declaration says they are.");
