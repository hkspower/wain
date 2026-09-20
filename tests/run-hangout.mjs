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
 *   areas         — Kuwait by area. The half that can rot quietly is the
 *                   filter: `?area=` is an exact match on `areaAr`, and the
 *                   tempting name-search version looks identical until «شرق»
 *                   quietly returns «سوق شرق», which is in مدينة الكويت.
 *   search-button — whether a thumb can reach search at all. The suite of
 *                   this name used to test the navbar button that opened the
 *                   ⌘K palette and went when the navbar did; what came back
 *                   is the question nobody was asking, after /explore, a
 *                   place page and /about each measured 0 visible links to
 *                   /search on a shipped build.
 *   search-keys   — arrowing through results on /search. There used to be a
 *                   second surface, the ⌘K palette; it went when the navbar
 *                   did. The half kept is the half that always mattered: the
 *                   palette moved a colour without ever naming an option, so
 *                   a screen reader heard nothing travel, and /search is
 *                   where that is now proved.
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
import { existsSync, readFileSync, statSync } from "node:fs";
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
    // A request for "/search" rather than "/search/" resolves to a directory,
    // and readFileSync on one throws EISDIR *inside the request handler* —
    // which killed this server and took every suite after it down with it,
    // reporting the whole thing as ERR_CONNECTION_REFUSED. The real host
    // serves the directory index here, so this does too.
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
    if (!existsSync(f) || !f.startsWith(OUT)) { res.writeHead(404); return res.end("nope"); }
    res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));
  const env = { ...process.env, WAIN_URL: `http://127.0.0.1:${PORT}` };
  failed += (await run("node", ["tests/hangout-page.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ الخريطة: the pins, on a phone and on a desktop ════");
  failed += (await run("node", ["tests/map-pin.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ المناطق: Kuwait by area, and the filter it opens ════");
  failed += (await run("node", ["tests/areas.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ زر البحث: can a thumb reach search from where it stands ════");
  failed += (await run("node", ["tests/search-button.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ لوحة المفاتيح: arrowing through results on /search ════");
  failed += (await run("node", ["tests/search-keys.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ شوق في البحث: her answer on the page, and the box listening ════");
  failed += (await run("node", ["tests/shouq-search.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ الطلعة من البحث: acting on a result without leaving it ════");
  failed += (await run("node", ["tests/search-plan.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ السحب: how the category rail feels under a thumb ════");
  failed += (await run("node", ["tests/swipe.test.mjs"], { env })) === 0 ? 0 : 1;
  srv.close();
}

console.log(failed ? `\n${failed} suite(s) failed` : "\nالطلعة: كل شي تمام");
process.exit(failed ? 1 : 0);
