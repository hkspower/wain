#!/usr/bin/env node
/**
 * Write the catalogue as rows: out/data/places.json
 *   node scripts/gen-places-json.mjs [--out <file>]
 *
 * This is what `php wain.php seed` reads on the server. The site's back end
 * (`/api/wain.php`) keeps its own `places` table so an admin can edit a place
 * live; the table has to start from somewhere, and «somewhere» is the catalogue
 * the export was built from — the same 52 records, in the row shape the API
 * stores (`placeToRow`, src/lib/place-rows.ts), so the seed, the admin's edits
 * and the snapshot every page renders from agree on one spelling of every
 * column.
 *
 * It ships INSIDE the export, at `data/places.json`, rather than being fetched
 * from git: the server already has the export, the deploy's own sha256 check
 * covers it, and `seed` inserts only slugs the table lacks — so a redeploy can
 * add a new catalogue place and can never undo a live edit.
 *
 * Bundled from the real modules with esbuild, the way audit:places and the
 * MCP server do, so this file cannot drift from `places.ts`: a field added
 * there is in the next JSON without anyone remembering this script exists.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outArg = args.indexOf("--out");
const OUT = outArg >= 0 ? args[outArg + 1] : join(ROOT, "out", "data", "places.json");

const tmp = mkdtempSync(join(tmpdir(), "wain-places-json-"));
try {
  const entry = join(tmp, "entry.ts");
  writeFileSync(
    entry,
    `import { places } from "@/lib/places";
import { placeToRow } from "@/lib/place-rows";
export const rows = places.map((p) => placeToRow(p));
`
  );
  const bundle = join(tmp, "bundle.mjs");
  execFileSync(
    "npx",
    ["-y", "esbuild", entry, "--bundle", "--format=esm", "--platform=node", `--alias:@=${join(ROOT, "src")}`,
     "--log-level=error", `--outfile=${bundle}`],
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] }
  );
  const { rows } = await import(pathToFileURL(bundle).href);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("the catalogue bundled to nothing");
  for (const r of rows) {
    if (typeof r.slug !== "string" || !/^[a-z0-9-]+$/.test(r.slug)) throw new Error(`a row has no slug: ${JSON.stringify(r).slice(0, 80)}`);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(rows) + "\n");
  console.log(`▸ wrote ${rows.length} place rows to ${OUT}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
