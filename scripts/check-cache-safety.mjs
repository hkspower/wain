/**
 * The .htaccess caches every .js/.css/.woff2 for a year as `immutable`.
 * That is only safe because Next.js content-hashes those filenames under
 * /_next/static/. If an unhashed one ever lands elsewhere, returning
 * visitors would be pinned to a stale copy for a year with no way to bust it.
 * Fail the build instead.
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const OUT = "out";
const IMMUTABLE = /\.(js|mjs|css|woff2|woff)$/;
const SAFE_PREFIX = "_next/static/";
// sw.js is deliberately unhashed — an installed app fetches it by that exact
// name to discover new builds. .htaccess gives it max-age=0, must-revalidate,
// so the immutable rule never applies to it.
const EXEMPT = new Set(["sw.js"]);
// vendor/<package>-<x.y.z>/ is not content-hashed, but it is version-pinned,
// which here amounts to the same thing: scripts/vendor-widget.mjs refuses to
// write a directory whose version differs from the locked package's, and npm's
// integrity check fixes those bytes. A new version is a new directory, so a
// visitor holding the old one for a year is holding the right file for the URL
// it was asked for. A range or a tag in that name would break the promise, so
// only an exact version passes.
const VERSIONED_VENDOR = /^vendor\/[a-z0-9-]+-\d+\.\d+\.\d+\//;

if (!existsSync(OUT)) {
  console.error("check-cache-safety: out/ not found — run the build first.");
  process.exit(1);
}

const offenders = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else {
      const rel = relative(OUT, full).split("\\").join("/");
      if (IMMUTABLE.test(rel) && !rel.startsWith(SAFE_PREFIX) && !EXEMPT.has(rel) &&
          !VERSIONED_VENDOR.test(rel))
        offenders.push(rel);
    }
  }
})(OUT);

if (offenders.length) {
  console.error(
    "check-cache-safety: unhashed asset(s) outside /_next/static/ would be " +
      "cached as immutable for a year:\n" +
      offenders.map((o) => "  - " + o).join("\n")
  );
  process.exit(1);
}
console.log("check-cache-safety: all immutable-cached assets are content-hashed ✓");
