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
import { readFileSync, existsSync, readdirSync } from "node:fs";
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
  else notes.push(`denied: ${name} — ${why}`);
}

/* ── the CSP has to know about every host the bundle talks to ───────────────
   connect-src is where a feature goes to die quietly. The n8n speech bridge
   shipped with its host missing from the policy: every call the browser made
   was refused, the site fell back to the robot voice, the deploy log still
   reported «live bridge», and nothing anywhere said why. Nobody edits a CSP
   because they set an environment variable.

   So: every external origin that reaches a shipped chunk must be named in the
   policy, or named here with a reason it needs no directive. The exceptions
   are all things a CSP does not govern — a link the visitor follows, or a
   string in a framework error message that is never fetched. */
const NO_DIRECTIVE_NEEDED = [
  ["https://wa.me", "window.open target — a navigation, not a fetch"],
  ["https://www.google.com", "maps directions link, opened as a navigation"],
  ["https://developer.mozilla.org", "text inside a Next.js error message"],
  ["https://github.com", "text inside a Next.js error message"],
  ["https://nextjs.org", "text inside a Next.js error message"],
  ["https://react.dev", "text inside a Next.js error message"],
  ["https://www.wainkw.com", "this site — canonical URLs and share links"],
  ["https://schema.org", "JSON-LD vocabulary, never fetched"],
];

/* WHICH directive, not merely somewhere in the policy.
   The first version of this check asked whether the origin appeared anywhere
   in the CSP string, and that is not the question. unpkg is named in both
   script-src and connect-src, so deleting it from connect-src — precisely the
   omission that killed the speech bridge — left the check green. A policy is
   per-directive and so is the failure. */
const DIRECTIVE = {
  "https://unpkg.com": ["script-src", "connect-src"],
  "https://www.openstreetmap.org": ["frame-src"],
};
// Anything not named above is assumed to be fetched, because that is both the
// common case and the one that fails silently. An origin that turns out to
// need a different directive gets an entry here rather than an exemption.
const DEFAULT_DIRECTIVE = ["connect-src"];

/** `default-src 'self'; connect-src 'self' https://x` → { "connect-src": Set }. */
function parseCsp(policy) {
  const out = {};
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out[name] = new Set(sources);
  }
  return out;
}
const csp = (readFileSync(join(ROOT, "public/.htaccess"), "utf8")
  .match(/Content-Security-Policy "([^"]+)"/) || [])[1] ?? "";
if (!csp) {
  errors.push("no Content-Security-Policy in public/.htaccess — nothing to check the bundle against");
} else {
  const chunkText = [];
  (function read(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) read(p);
      else if (e.name.endsWith(".js")) chunkText.push(readFileSync(p, "utf8"));
    }
  })(join(OUT, "_next/static/chunks"));
  const origins = [...new Set(
    chunkText.join("\n").match(/https:\/\/[a-zA-Z0-9.*-]+\.[a-z]{2,}/g) ?? []
  )];
  const excused = new Set(NO_DIRECTIVE_NEEDED.map(([o]) => o));
  // Counted, not subtracted: the exception list names more hosts than any one
  // build happens to contain, so `origins.length - excused.size` reported zero
  // covered origins while quietly covering unpkg.
  const governed = origins.filter((o) => !excused.has(o));
  const parsed = parseCsp(csp);
  /** Is `origin` named in every directive it needs? Returns the missing ones. */
  const missing = (origin) =>
    (DIRECTIVE[origin] ?? DEFAULT_DIRECTIVE).filter((d) => !parsed[d]?.has(origin));
  for (const origin of governed) {
    const gaps = missing(origin);
    if (!gaps.length) continue;
    errors.push(
      `${origin} is in the shipped JavaScript but missing from ${gaps.join(" and ")} ` +
        `in public/.htaccess. The browser will refuse the request and say nothing the ` +
        `site can see — add the origin to that directive. If it is only a link or a ` +
        `string, add it to NO_DIRECTIVE_NEEDED in this file with the reason; if it ` +
        `belongs in a different directive, say which one in DIRECTIVE.`
    );
  }
  // Only claim coverage when it is true. Printing «covers all» beside an
  // uncovered origin is the checker contradicting itself in the same output.
  if (governed.every((o) => !missing(o).length))
    notes.push(
      `allowed: CSP names all ${governed.length} bundled origin(s) in the directives they need: ` +
        governed.map((o) => `${o} (${(DIRECTIVE[o] ?? DEFAULT_DIRECTIVE).join(", ")})`).join("; ")
    );
}

console.log(`audit-htaccess: ${rules.length} deny rules, ${shipped.length} files in out/\n`);
// Each note says what it is — this list mixes «denied» rules with the «allowed»
// CSP origins, and one shared prefix labelled the second kind as the first.
for (const n of notes) console.log(`  ✓ ${n}`);
if (errors.length) {
  console.log("");
  for (const e of errors) console.log(`  ✗ ${e}`);
}
console.log(
  `\n${errors.length ? "✗" : "✓"} ${errors.length} problem${errors.length === 1 ? "" : "s"}` +
    (errors.length ? "" : " — every deny rule misses the export, and the live data stays covered")
);
process.exit(errors.length ? 1 : 0);
