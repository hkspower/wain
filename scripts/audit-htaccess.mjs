#!/usr/bin/env node
/**
 * Does .htaccess deny anything the site actually ships?   npm run audit:htaccess
 *
 * The deny rules in public/.htaccess exist because the live docroot is full of
 * things that should never have been reachable — backups, scratch output, a
 * zipped copy of the whole site, an installer, and a shell script with the FTP
 * password in it. They are written as filename patterns, and a filename pattern
 * does not know the difference between the server's junk and the export's own
 * files.
 *
 * That is not hypothetical. The first draft of those rules denied `index.txt`,
 * to clear a 92KB dump left by the old app. Next's App Router writes an
 * `index.txt` beside every `index.html` — its prefetch payload — so the rule
 * would have blocked 45 shipped files and broken client-side navigation on
 * every route, in order to tidy one stale file the deploy overwrites anyway.
 *
 * So: every deny pattern is applied to the real build output, and any rule that
 * matches something in out/ fails the run. A rule may only deny what the site
 * does not ship.
 *
 * `<FilesMatch>` and `<Files>` test the BASENAME, not the path — that is what
 * makes a rule like `\.md$` reach into every directory at once, and it is why
 * this checks basenames too.
 */
import { readFileSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTACCESS = join(ROOT, "public/.htaccess");
const OUT = join(ROOT, "out");

const errors = [];
const notes = [];

/** Pull every pattern that sits inside a block ending in `Require all denied`. */
function denyPatterns(src) {
  const out = [];
  // <FilesMatch "…"> … </FilesMatch>  and  <Files "…"> … </Files>
  const re = /<Files(Match)?\s+(?:~\s*)?"([^"]+)"\s*>([\s\S]*?)<\/Files(?:Match)?>/g;
  let m;
  while ((m = re.exec(src))) {
    const [, isMatch, pattern, body] = m;
    if (!/Require\s+all\s+denied/i.test(body)) continue;
    out.push({ pattern, regex: !!isMatch || pattern.includes("\\") || pattern.includes("$") });
  }
  return out;
}

if (!existsSync(HTACCESS)) {
  console.error("audit-htaccess: public/.htaccess is missing");
  process.exit(1);
}
if (!existsSync(OUT)) {
  console.log("audit-htaccess: no out/ — run `npm run build` first");
  process.exit(0);
}

const rules = denyPatterns(readFileSync(HTACCESS, "utf8"));

/** Every file the export ships, as repo-relative paths. */
async function walk(dir, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, acc);
    else acc.push(p.slice(OUT.length + 1));
  }
  return acc;
}
const shipped = await walk(OUT);

/** .htaccess is denied on purpose — Apache never serves it anyway. */
const EXPECTED = new Set([".htaccess"]);

for (const { pattern } of rules) {
  let re;
  try {
    re = new RegExp(pattern);
  } catch {
    errors.push(`pattern is not valid regex: ${pattern}`);
    continue;
  }
  const hits = shipped.filter((f) => re.test(basename(f)) && !EXPECTED.has(f));
  if (hits.length) {
    const shown = hits.slice(0, 5).join(", ");
    errors.push(
      `deny rule /${pattern}/ blocks ${hits.length} shipped file${hits.length === 1 ? "" : "s"}: ` +
        `${shown}${hits.length > 5 ? `, +${hits.length - 5} more` : ""}`
    );
  }
}

/* The rules that matter most are the ones protecting live data. Losing one of
   these to a careless edit is silent and expensive, so they are named. */
const MUST_DENY = [
  ["wain.db", "the live SQLite database"],
  ["wain.db-wal", "the database's write-ahead log — recent orders live here"],
  ["admin.token", "the admin panel's bcrypt token hash"],
  ["upload-ftp.sh", "a shell script holding the FTP password in plaintext"],
  ["files.wain.zip", "a zipped copy of the whole site"],
  ["index.bak-300.html", "one of 33 backups of the site at guessable names"],
  ["keys-out.txt", "a saved a=list response — the database's whole key index"],
  ["wain-inst.php", "the old installer"],
  ["package.json", "build configuration that leaked into the web root"],
];
for (const [name, why] of MUST_DENY) {
  const covered = rules.some(({ pattern }) => {
    try { return new RegExp(pattern).test(name); } catch { return false; }
  });
  if (!covered) errors.push(`nothing denies ${name} — ${why}`);
  else notes.push(`${name} — ${why}`);
}

console.log(`audit-htaccess: ${rules.length} deny rules, ${shipped.length} files in out/\n`);
for (const n of notes) console.log(`  ✓ denied: ${n}`);
if (errors.length) {
  console.log("");
  for (const e of errors) console.log(`  ✗ ${e}`);
}
console.log(
  `\n${errors.length ? "✗" : "✓"} ${errors.length} problem${errors.length === 1 ? "" : "s"}` +
    (errors.length ? "" : " — every deny rule misses the export, and the live data stays covered")
);
process.exit(errors.length ? 1 : 0);
