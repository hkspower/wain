#!/usr/bin/env node
/**
 * The call widget, served from wainkw.com:   node scripts/vendor-widget.mjs
 *
 * شوق's call ran on `unpkg.com/@elevenlabs/convai-widget-embed@<v>/dist/index.js`
 * — a third-party CDN, so the moment a visitor tapped the call button their
 * phone opened a cold DNS + TLS connection to a host nothing else on the page
 * uses, and then pulled ~460K gzipped from it. Asked on 2 October to run her
 * on our own host's speed instead: the same bytes, from the origin the page
 * already has a warm HTTP/3 connection to, behind the same CDN, with a year's
 * immutable cache.
 *
 * The package is a devDependency pinned EXACTLY (package.json says `0.18.3`,
 * not `^0.18.3`): the bytes that ship are whatever npm installed, so a range
 * would let an install change the call without a commit saying so.
 *
 * What this writes:
 *
 *   src/lib/widget-src.g.ts   the path and its SRI integrity, for wain-ai.ts
 *   out/<that path>           with --copy, after `next build` (package.json)
 *
 * The path sits under `_next/static/media/` and carries the content's hash,
 * because `.htaccess` gives that directory a year's `immutable` cache and
 * check-cache-safety refuses anything there whose name does not change with
 * its bytes. It is not referenced by any page's HTML, so gen-sw leaves it out
 * of the service worker's precache — it is on-demand, like the live map.
 *
 * The file is the package's `dist/index.js` with its MIT licence in front, as
 * a `/*!` comment: the licence requires the notice to travel with every copy,
 * and the published bundle carries none of its own. The hash and the
 * integrity are of what ships, licence included.
 *
 * `--check` fails when the generated module is not what the installed
 * package would produce (wired into audit:shouq-call).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_DIR = join(ROOT, "node_modules/@elevenlabs/convai-widget-embed");
const OUT_TS = join(ROOT, "src/lib/widget-src.g.ts");

const pkg = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));
const declared = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).devDependencies?.[
  "@elevenlabs/convai-widget-embed"
];
if (declared !== pkg.version) {
  console.error(
    `vendor-widget: package.json pins ${declared ?? "nothing"}, node_modules has ${pkg.version} — ` +
      "pin an exact version and reinstall."
  );
  process.exit(1);
}
const licence = readFileSync(join(PKG_DIR, "LICENSE"), "utf8").trim().replace(/\*\//g, "* /");
const body = readFileSync(join(PKG_DIR, pkg.unpkg ?? "dist/index.js"));
const bytes = Buffer.concat([
  Buffer.from(`/*! ${pkg.name} ${pkg.version}\n\n${licence}\n*/\n`),
  body,
]);
const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
const integrity = `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
const path = `/_next/static/media/convai-${pkg.version}-${hash}.js`;

const ts = `// GENERATED — do not edit by hand.
// Produced by scripts/vendor-widget.mjs from ${pkg.name}@${pkg.version}
// (node_modules), which says why it is served from this origin.

export const WAIN_AI_WIDGET_VERSION = "${pkg.version}";
export const WAIN_AI_WIDGET_PATH = "${path}";
export const WAIN_AI_WIDGET_INTEGRITY = "${integrity}";
`;

if (process.argv.includes("--check")) {
  const current = existsSync(OUT_TS) ? readFileSync(OUT_TS, "utf8") : "";
  if (current !== ts) {
    console.error("vendor-widget: src/lib/widget-src.g.ts is stale — run `node scripts/vendor-widget.mjs`.");
    process.exit(1);
  }
  console.log(`vendor-widget: current (${pkg.version}, ${hash})`);
  process.exit(0);
}

if (!existsSync(OUT_TS) || readFileSync(OUT_TS, "utf8") !== ts) writeFileSync(OUT_TS, ts);

if (process.argv.includes("--copy")) {
  const target = join(ROOT, "out", path);
  if (!existsSync(join(ROOT, "out"))) {
    console.error("vendor-widget: no out/ — run next build first.");
    process.exit(1);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  console.log(`vendor-widget: ${path} (${(bytes.length / 1024).toFixed(0)}K) ✓`);
} else {
  console.log(`vendor-widget: ${path}`);
}
