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
 *   search-keys   — arrowing through results on /search. There used to be a
 *                   second surface, the ⌘K palette, and a `search-button`
 *                   suite beside this one for the navbar button that opened
 *                   it; both went when the navbar did. The half kept is the
 *                   half that always mattered: the palette moved a colour
 *                   without ever naming an option, so a screen reader heard
 *                   nothing travel, and /search is where that is now proved.
 *   shouq-search  — شوق ON the search page rather than beside it: the answer
 *                   she builds for every query, which used to be spoken and
 *                   never written, and the microphone that used to exist only
 *                   inside her call.
 *   find          — the dial, now a plain link, and the choice page it leads
 *                   to: call شوق, or chat with سالم. Asserts `wain-ai:call`
 *                   actually fires on the شوق tap, not just that the page
 *                   moves to /search — a navigation alone would not have
 *                   caught the nested-button bug the first draft shipped.
 *   stand-ins     — deploy:plan's refusal of the drawn stand-ins of «معالم
 *                   الكويت», both ways, on the export in out/ and on small
 *                   archives made for it. No browser.
 *   landmarks     — «معالم الكويت»: on a normal build, that none of it shows;
 *                   on a preview build (NEXT_PUBLIC_SHOW_STANDINS=1), the
 *                   slideshow under the hero (bars, jump, swipe, pause, reduced
 *                   motion), the pictures on the five cards and at the top of
 *                   their pages, and the «صورة توضيحية» tag on each.
 *   back-button   — the round back button on every page but home: where it
 *                   sits, that it covers nothing at rest, and where it goes.
 *   ux-pass       — the 3 October pass: 40px for a finger and 24 for a mouse,
 *                   /search in the order it answers, the empty spots filled,
 *                   and a desktop home page with something to press.
 *   together      — سالم, شوق, the hangout and the map as one: the map and
 *                   the memory in his chat, the handoffs, his voice, the
 *                   shortlist and /pick, the invitation's way on.
 *   salem         — his own page, structure and client-side state only; see
 *                   the file's own header for why a live ElevenLabs
 *                   connection is deliberately not part of what is asserted.
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

console.log("\n════ معالم الكويت: no drawn stand-in may ship ════");
failed += (await run("node", ["tests/stand-ins.test.mjs"])) === 0 ? 0 : 1;

console.log("\n════ الطلعة: the panel, and every way it can fail ════");
{
  const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
    ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
    ".svg": "image/svg+xml", ".avif": "image/avif", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon",
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

  console.log("\n════ الخريطة المتحركة: what a tap buys, and what it costs ════");
  failed += (await run("node", ["tests/live-map.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ لوحة المفاتيح: arrowing through results on /search ════");
  failed += (await run("node", ["tests/search-keys.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ شوق في البحث: her answer on the page, and the box listening ════");
  failed += (await run("node", ["tests/shouq-search.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ صفحة البحث: the list first, the map beside it ════");
  failed += (await run("node", ["tests/search-layout.test.mjs"], { env })) === 0 ? 0 : 1;
  failed += (await run("node", ["tests/map-layout.test.mjs"], { env })) === 0 ? 0 : 1;
  failed += (await run("node", ["tests/boxes.test.mjs"], { env })) === 0 ? 0 : 1;
  failed += (await run("node", ["tests/borders.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ الطلعة من البحث: acting on a result without leaving it ════");
  failed += (await run("node", ["tests/search-plan.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ إلى وين: the dial, and the choice it leads to now ════");
  failed += (await run("node", ["tests/find.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ معالم الكويت: the slideshow under the hero ════");
  failed += (await run("node", ["tests/landmarks.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ رجوع: the back button on every page but home ════");
  failed += (await run("node", ["tests/back-button.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ 3 October: the UX pass ════");
  failed += (await run("node", ["tests/ux-pass.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ سالم: his own page ════");
  failed += (await run("node", ["tests/salem.test.mjs"], { env })) === 0 ? 0 : 1;

  console.log("\n════ مع بعض: سالم, شوق, the hangout and the map as one ════");
  failed += (await run("node", ["tests/together.test.mjs"], { env })) === 0 ? 0 : 1;
  srv.close();
}

console.log(failed ? `\n${failed} suite(s) failed` : "\nالطلعة: كل شي تمام");
process.exit(failed ? 1 : 0);
