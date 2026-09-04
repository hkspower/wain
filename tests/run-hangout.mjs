#!/usr/bin/env node
/**
 * The place-facing pieces:  npm run test:hangout
 *
 *   hangout       — the time rules and the message. No browser: what is under
 *                   test is a pure function of the clock and the place, and
 *                   Kuwait's clock is not the machine's.
 *   hangout-page  — the panel on a real place page, with the share sheet, the
 *                   popup and the clipboard each removed in turn. Only one
 *                   link of that fallback chain ever runs on a given device,
 *                   which is what makes the other two worth testing.
 *   map-pin       — the pins, on a phone and on a desktop. The two behaviours
 *                   that must not drift back together: one tap on a touch
 *                   device selects, one click on a desktop still opens.
 *   search-button — the navbar search button and the palette behind it: the
 *                   ⌘K shortcut its own header documents, focus landing in the
 *                   box, arrow keys and Enter, and the code-splitting the two
 *                   files exist for — a stray static import would undo that
 *                   silently, because the button would still work.
 *   search-keys   — arrowing through results, on BOTH surfaces. The palette
 *                   had the keys and the /search page had none, and the
 *                   palette's version moved a colour without ever naming an
 *                   option — so a screen reader heard nothing travel.
 *   shouq-search  — شوق ON the search page rather than beside it: the answer
 *                   she builds for every query, which used to be spoken and
 *                   never written, and the microphone that used to exist only
 *                   inside her call.
 *   swipe         — the category rail, the site's one swiped surface. It was
 *                   snap-mandatory, which turned a 4px nudge into a 120px
 *                   jump. Tests both directions, because the tempting
 *                   over-correction is to make it comfortable by making
 *                   snapping do nothing at all.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { requireFreshBuild } from "./stale-build.mjs";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const PORT = 4207;

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
    child.on("close", (code) => resolve(code ?? 1));
  });

let failed = 0;

console.log("\n════ الطلعة: the time rules and the message ════");
failed += (await run("node", ["tests/hangout.test.mjs"])) === 0 ? 0 : 1;

// Missing OR stale. Asking only whether out/ exists is what let a fix to this
// very panel pass its new test before the code had been built — see
// tests/stale-build.mjs.
requireFreshBuild(ROOT);

console.log("\n════ الطلعة: the panel, and every way it can fail ════");
{
  const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
    ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
    ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".xml": "application/xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    let f = join(OUT, p);
    if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
    if (!existsSync(f) || !f.startsWith(OUT)) { res.writeHead(404); return res.end("nope"); }
    res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));
  const env = { ...process.env, WAIN_URL: `http://127.0.0.1:${PORT}` };
  failed += (await run("node", ["tests/hangout-page.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ الخريطة: the pins, on a phone and on a desktop ════");
  failed += (await run("node", ["tests/map-pin.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ زر البحث: the button, the shortcut and the palette ════");
  failed += (await run("node", ["tests/search-button.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ لوحة المفاتيح: arrowing through results, on both surfaces ════");
  failed += (await run("node", ["tests/search-keys.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ شوق في البحث: her answer on the page, and the box listening ════");
  failed += (await run("node", ["tests/shouq-search.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ السحب: how the category rail feels under a thumb ════");
  failed += (await run("node", ["tests/swipe.test.mjs"], { env })) === 0 ? 0 : 1;
  srv.close();
}

console.log(failed ? `\n${failed} suite(s) failed` : "\nالطلعة: كل شي تمام");
process.exit(failed ? 1 : 0);
