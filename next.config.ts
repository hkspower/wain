import type { NextConfig } from "next";
import { execSync } from "node:child_process";

/**
 * A build id that is the same for the same source, instead of a fresh random
 * string every time.
 *
 * Next defaults to a random id, and it ends up in the path
 * `/_next/static/<buildId>/_buildManifest.js`. gen-sw.mjs precaches that path
 * and derives the service worker's VERSION from a hash of the precache list —
 * so a random id meant `sw.js` differed between two builds of the *same
 * commit*, and `build.json`'s digest with it. Two things came of that:
 *
 *  - make-release.mjs documents "two builds of the same commit produce the
 *    same digest", and it was not true. Measured: 20fb841ae1cf2c18 →
 *    7b2b7d01b225fcd6 with nothing but docs changed between them.
 *  - every deploy bumped the service worker version even when not one byte
 *    of the site had changed, so every installed visitor re-downloaded the
 *    shell for nothing.
 *
 * The commit sha fixes both. It is only used when the tree is CLEAN, and that
 * condition is the point rather than tidiness: `.htaccess` caches everything
 * under /_next/static/ as immutable for a year, so two different builds must
 * never share a build id. A dirty tree can produce different output at the
 * same sha, so it falls back to null — which is Next's documented way of
 * asking for the random id, exactly the behaviour this replaces. CI always
 * builds clean, which is where reproducibility is worth having.
 */
function buildIdFromGit(): string | null {
  // No `as const` on stdio: it makes the tuple readonly, and execSync's
  // StdioOptions is a mutable array, so the config stops type-checking while
  // still working at runtime — the sort of mismatch that only shows up in
  // `tsc`, because Next compiles this file with SWC and never type-checks it.
  const run = (cmd: string) =>
    execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    if (run("git status --porcelain") !== "") return null;
    return run("git rev-parse HEAD") || null;
  } catch {
    return null;
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  generateBuildId: buildIdFromGit,
  // Emit a fully static site into `out/` for upload to static hosting (Hostinger).
  output: "export",
  // Apache serves /explore/ -> out/explore/index.html cleanly with trailing slashes.
  trailingSlash: true,
  // No Node image optimizer exists on a static host.
  images: { unoptimized: true },
};

export default nextConfig;
