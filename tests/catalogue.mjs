/**
 * The real catalogue, for a browser suite that needs to know what the data
 * says — bundled once with esbuild the way scripts/audit-places.mjs does it,
 * so a test asserts against the records the site ships and never against a
 * count somebody typed («0 of 52» was that count, and it was carried in three
 * test files until the day menus started arriving).
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** `{ places, acceptsOrders, takesQueue, getPlace }` from src/lib/places.ts. */
export async function loadCatalogue() {
  const tmp = mkdtempSync(join(tmpdir(), "wain-catalogue-"));
  const bundle = join(tmp, "places.mjs");
  execSync(
    `npx -y esbuild ${JSON.stringify(join(ROOT, "src/lib/places.ts"))} --bundle --format=esm ` +
      `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(bundle)} --log-level=error`,
    { cwd: ROOT, stdio: "pipe" }
  );
  const mod = await import(pathToFileURL(bundle).href);
  rmSync(tmp, { recursive: true, force: true });
  return mod;
}
