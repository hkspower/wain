/**
 * Refuse to test a build older than the source it claims to test.
 *
 * Every browser suite in here serves `out/`, and none of them builds it. The
 * check each one had asked only whether `out/` exists — so a source change with
 * no rebuild runs the PREVIOUS bundle and reports green. The suite says the
 * code is fine while testing code that no longer exists, which is worse than a
 * failure, because a failure gets looked at.
 *
 * This was not theoretical. A fix to ShareHangout's clock passed its brand-new
 * test before any rebuild, and the same assertions had failed a minute earlier
 * against the old bundle. The only reason it was noticed is that the failure
 * came first; the other order would have shipped a fix that was never run.
 *
 * `src/` and `public/` are watched because both end up in the bundle — the
 * voice clips and the manifest ship out of `public/`. Docs and tests are not,
 * because editing a test is not a reason to rebuild the site.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WATCHED = ["src", "public"];
const SKIP = new Set(["node_modules", ".next", ".git"]);

/** The most recently modified file under `dir`, as [mtimeMs, path]. */
function newest(dir) {
  let best = [0, ""];
  if (!existsSync(dir)) return best;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    const found = e.isDirectory() ? newest(p) : [statSync(p).mtimeMs, p];
    if (found[0] > best[0]) best = found;
  }
  return best;
}

/**
 * Is `out/` older than the source? Returns the offending path, or null.
 * Separated from the exit so a runner that knows how to build can rebuild
 * instead of refusing.
 */
export function staleBuild(root) {
  const index = join(root, "out", "index.html");
  if (!existsSync(index)) return "out/index.html";
  const built = statSync(index).mtimeMs;
  for (const dir of WATCHED) {
    const [mtime, path] = newest(join(root, dir));
    if (mtime > built) return relative(root, path);
  }
  return null;
}

/** For runners that cannot build: say what is stale and stop. */
export function requireFreshBuild(root) {
  const stale = staleBuild(root);
  if (!stale) return;
  console.error(
    stale === "out/index.html"
      ? "\nout/ is missing — run: npm run build"
      : `\nout/ is older than the source it would be testing.\n` +
        `  ${stale} changed after the last build.\n` +
        `  A stale build reports green against code that is gone. Run: npm run build`
  );
  process.exit(1);
}
