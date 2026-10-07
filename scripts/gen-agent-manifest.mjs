#!/usr/bin/env node
/**
 * docs/agent-live/MANIFEST.json — every file of the شوق/سالم import, with its
 * size and sha256.
 *
 * It exists for scripts/publish/agent-archive.php, which copies the import
 * into `<domain>/storage/agent-live/` on Hostinger. The server can only pull
 * (nothing can be pushed to that account from here), so it fetches each file
 * from a commit-pinned raw URL — and a hash taken here, before the commit, is
 * the only way it can know the bytes it got are the bytes that were meant.
 *
 *   node scripts/gen-agent-manifest.mjs           write it
 *   node scripts/gen-agent-manifest.mjs --check   fail if it is stale
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../docs/agent-live/", import.meta.url).pathname;
const OUT = join(ROOT, "MANIFEST.json");

function walk(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

const files = walk(ROOT)
  .filter((p) => p !== OUT)
  .map((p) => {
    const bytes = readFileSync(p);
    return {
      path: relative(ROOT, p),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });

const text = JSON.stringify({ files }, null, 2) + "\n";

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {}
  if (current !== text) {
    console.error("docs/agent-live/MANIFEST.json is stale — run node scripts/gen-agent-manifest.mjs");
    process.exit(1);
  }
  console.log(`agent manifest current (${files.length} files)`);
} else {
  writeFileSync(OUT, text);
  console.log(`wrote MANIFEST.json (${files.length} files, ${files.reduce((n, f) => n + f.bytes, 0)} bytes)`);
}
