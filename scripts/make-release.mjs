#!/usr/bin/env node
/**
 * Build a full, versioned export.   npm run release
 *
 * The site is a static export dropped into a document root, and for months
 * nobody could answer the simplest question about it: what is actually up
 * there? The live `index.html` referenced fourteen `/_next/` assets and the
 * `_next` directory did not exist, and there was no way to see that from here
 * or from the server — the file was just an old copy of something.
 *
 * So a release is not only a zip. It writes `build.json` into the export, at a
 * fixed URL, carrying the version, the commit and the build time. Once a
 * release is deployed, `https://www.wainkw.com/build.json` answers the
 * question in one request, from anywhere, with no credentials.
 *
 *   npm run release           build, stamp, archive
 *   npm run release -- --dry  everything except writing the archive
 *
 * The archive is named for the version, so two of them cannot be confused for
 * each other on a desktop full of downloads.
 */
import { execSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const DRY = process.argv.includes("--dry");
const SKIP_BUILD = process.argv.includes("--no-build");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const { version } = pkg;

const git = (args, fallback = "unknown") => {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
};

const commit = git(["rev-parse", "HEAD"]);
const shortCommit = commit.slice(0, 8);
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
/** Uncommitted work makes a release unreproducible — say so rather than hide it. */
const dirty = git(["status", "--porcelain"], "") !== "";

console.log(`\nwain ${version} — full export`);
console.log(`  commit  ${shortCommit}${dirty ? "  (working tree is dirty)" : ""}`);
console.log(`  branch  ${branch}\n`);

/* ── build ──────────────────────────────────────────────────────────────── */
if (!SKIP_BUILD) {
  console.log("▸ building…");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
} else if (!existsSync(OUT)) {
  console.error("--no-build was passed but out/ does not exist.");
  process.exit(1);
}

/* ── stamp ──────────────────────────────────────────────────────────────── */
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
})(OUT);

const totalBytes = files.reduce((a, f) => a + statSync(f).size, 0);
const pages = files.filter((f) => f.endsWith("index.html")).length;

/**
 * A fingerprint of the export's contents — path and bytes of every file.
 * Two builds of the same commit produce the same digest, so this is what
 * says "the thing on the server is the thing I built" rather than "the
 * version string in it claims to be".
 */
const tree = files
  .map((f) => relative(OUT, f).split("\\").join("/"))
  .sort();
const hash = createHash("sha256");
for (const rel of tree) {
  hash.update(rel);
  hash.update(readFileSync(join(OUT, rel)));
}
const digest = hash.digest("hex").slice(0, 16);

const build = {
  name: "wain",
  version,
  commit,
  branch,
  dirty,
  builtAt: new Date().toISOString(),
  files: files.length,
  pages,
  bytes: totalBytes,
  digest,
};
writeFileSync(join(OUT, "build.json"), JSON.stringify(build, null, 2) + "\n");
console.log(`\n▸ stamped out/build.json`);
for (const [k, v] of Object.entries(build)) console.log(`    ${k.padEnd(9)} ${v}`);

/* ── the things whose absence broke the last deploy ──────────────────────── */
const REQUIRED = [
  ["_next", "the directory the live site is missing — without it every page is unstyled"],
  ["index.html", "the front door"],
  [".htaccess", "carries the deny rules for wain.db and admin.token"],
  ["404.html", "the custom not-found page"],
  ["sw.js", "the service worker"],
  ["manifest.webmanifest", "the installable app manifest"],
  ["robots.txt", "crawl rules"],
  ["sitemap.xml", "the sitemap"],
];
console.log(`\n▸ checking what a deploy needs`);
let missing = 0;
for (const [rel, why] of REQUIRED) {
  const ok = existsSync(join(OUT, rel));
  if (!ok) missing++;
  console.log(`    ${ok ? "✓" : "✗"} ${rel.padEnd(22)} ${ok ? "" : `MISSING — ${why}`}`);
}
if (missing) {
  console.error(`\n${missing} required item(s) missing from the export. Not archiving.`);
  process.exit(1);
}

/* ── archive ────────────────────────────────────────────────────────────── */
const archive = join(ROOT, `wain-${version}.zip`);
if (DRY) {
  console.log(`\n▸ --dry: would write ${relative(ROOT, archive)}`);
} else {
  rmSync(archive, { force: true });
  // -r from inside out/ so paths are relative to the document root, and the
  // dotfiles come along: .htaccess is the whole reason the last deploy was
  // dangerous, and a zip built from the parent directory silently drops it.
  execSync(`cd ${JSON.stringify(OUT)} && zip -qr ${JSON.stringify(archive)} .`, {
    stdio: "inherit",
    shell: "/bin/bash",
  });
  const zipBytes = statSync(archive).size;
  const zipSha = createHash("sha256").update(readFileSync(archive)).digest("hex");
  const sums = join(ROOT, `wain-${version}.zip.sha256`);
  writeFileSync(sums, `${zipSha}  wain-${version}.zip\n`);

  // The archive must contain .htaccess — verified, not assumed, because the
  // failure is silent and puts a live database on the public web.
  const listed = execSync(`unzip -l ${JSON.stringify(archive)}`, { encoding: "utf8" });
  if (!/\s\.htaccess$/m.test(listed)) {
    console.error("\n.htaccess is not in the archive — refusing to hand over a deploy without it.");
    process.exit(1);
  }

  console.log(`\n▸ wrote ${relative(ROOT, archive)}`);
  console.log(`    ${(zipBytes / 1048576).toFixed(2)} MB, ${files.length} files`);
  console.log(`    sha256 ${zipSha.slice(0, 32)}…`);
  console.log(`    checksum written to ${relative(ROOT, sums)}`);
}

console.log(`\nDeploy: extract into public_html. Do NOT use hPanel's`);
console.log(`"deploy static archive" button — it empties the folder first, and`);
console.log(`wain.db is still live in there.`);
console.log(`\nAfterwards, confirm what landed:`);
console.log(`    curl -s https://www.wainkw.com/build.json`);
console.log(`    → version ${version}, digest ${digest}\n`);
if (dirty) {
  console.log(`Note: built from a dirty working tree, so ${shortCommit} does not`);
  console.log(`fully describe it. Commit first for a reproducible release.\n`);
}
