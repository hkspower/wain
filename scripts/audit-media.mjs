#!/usr/bin/env node
/**
 * Does the upload bridge accept exactly what src/lib/media.ts promises a
 * visitor it will accept?
 *   npm run audit:media
 *
 * The browser's checks in `rejectReason()` are a courtesy — a clear Arabic
 * sentence before a multi-megabyte photo goes anywhere. The real limits are
 * enforced again, from the bytes, by `scripts/publish/media-endpoint.php`,
 * the same way `/api/tts.php`'s voice table is the real one and
 * `gen-voice.mjs`'s copy only has to agree with it. If the two numbers here
 * ever drift apart, the failure is silent and specific: raise MAX_BYTES on
 * one side only and every file between the old and new limit passes the
 * browser's check and is then rejected by the server, after the whole file
 * has already been sent over a phone connection — the exact "clear Arabic
 * message became an opaque upload failure" bug `media.ts`'s own MAX_SIZE_AR
 * comment already warns about for the number changing at all, here for the
 * two copies disagreeing instead.
 *
 * Each side is asked for its own values by its own interpreter — media.ts is
 * bundled and imported, media-endpoint.php is run with `limits` — so a rename
 * or a reformat on either side still produces the truth rather than a false
 * green from a regex.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENDPOINT = "scripts/publish/media-endpoint.php";

let errors = 0;
let notes = 0;
const fail = (m, d = "") => { errors++; console.log(`  ✗ ${m}${d ? `\n      ${d}` : ""}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const note = (m) => { notes++; console.log(`  · ${m}`); };

console.log("\n── does the bridge accept exactly what the browser promises? ──");

const tmp = mkdtempSync(join(tmpdir(), "wain-audit-media-"));
let clientMaxBytes, clientMaxPhotos, clientTypes;
try {
  const entry = join(tmp, "e.mjs");
  const bundle = join(tmp, "b.mjs");
  writeFileSync(
    entry,
    "export { MAX_BYTES, MAX_PHOTOS, ACCEPTED_TYPES } from " +
      `${JSON.stringify(join(ROOT, "src/lib/media.ts"))};\n`
  );
  execFileSync(join(ROOT, "node_modules/.bin/esbuild"), [
    entry, "--bundle", "--format=esm", `--alias:@=${join(ROOT, "src")}`,
    `--outfile=${bundle}`, "--log-level=error",
  ], { cwd: ROOT, stdio: "pipe" });
  const mod = await import(pathToFileURL(bundle).href);
  clientMaxBytes = mod.MAX_BYTES;
  clientMaxPhotos = mod.MAX_PHOTOS;
  clientTypes = [...mod.ACCEPTED_TYPES].sort();
} catch (e) {
  fail("could not read src/lib/media.ts's own limits", e.message);
  console.log(`\n${errors} errors, ${notes} notes`);
  process.exit(1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

let bridge;
try {
  bridge = JSON.parse(execFileSync("php", [ENDPOINT, "limits"], {
    cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
  }));
} catch (e) {
  /* PHP is not a build dependency of this site — the host's, and test:api
     already needs it. A machine without it must not be able to turn this
     check red, because a red check people cannot run is a check people stop
     reading. It says loudly that it did not run instead. */
  note(`php is not available here, so the bridge's limits were NOT compared (${ENDPOINT})`);
  console.log(`\n${errors} errors, ${notes} notes`);
  process.exit(0);
}

if (bridge.maxBytes === clientMaxBytes) {
  ok(`MAX_BYTES agrees: ${clientMaxBytes}`);
} else {
  fail("MAX_BYTES differs", `media.ts: ${clientMaxBytes}   bridge: ${bridge.maxBytes}`);
}

if (bridge.maxPhotos === clientMaxPhotos) {
  ok(`MAX_PHOTOS agrees: ${clientMaxPhotos}`);
} else {
  fail("MAX_PHOTOS differs", `media.ts: ${clientMaxPhotos}   bridge: ${bridge.maxPhotos}`);
}

/* The client checks File.type, an image/* MIME; the bridge's own allowlist
   is keyed the same way (what getimagesize() reports), so the two lists are
   directly comparable rather than needing an extension-to-MIME translation
   on either side. */
const bridgeTypes = [...(bridge.allowedTypes ?? [])].sort();
if (JSON.stringify(bridgeTypes) === JSON.stringify(clientTypes)) {
  ok(`accepted types agree: ${clientTypes.join(", ")}`);
} else {
  fail("accepted types differ", `media.ts: ${clientTypes.join(", ")}   bridge: ${bridgeTypes.join(", ")}`);
}

console.log(`\n${errors} errors, ${notes} notes`);
process.exit(errors ? 1 : 0);
