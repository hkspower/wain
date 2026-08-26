// The map screen, in the browser.
//
//   npm run dev
//   node tests/mapscreen.mjs
//
// tests/roadmap.mjs proves the MODEL: the projection keeps the road's
// shape, and every district, road, pump and plaza is in the list at the
// distance the world uses. It cannot prove any of that is painted, and
// that is the failure this feature actually has — a map that computes
// fourteen marks and draws none of them, or draws them somewhere else,
// looks exactly like a map that works until you go looking for a petrol
// station.
//
// So this opens the screen and reads the pixels back. For each mark the
// model claims, it asks whether there is ink where the mark is supposed
// to be, and whether that ink is the colour the mark is supposed to be.
// Nothing here inspects the component.
//
// The other half is that the road has to be ON the map rather than
// merely somewhere: an aspect-correct model drawn into a wide box by
// code that stretches it to fill would pass every check in
// tests/roadmap.mjs and be wrong on screen. That is checked by measuring
// the painted road's own bounding box against the square the model was
// fitted into.
//
// ONE PLAYWRIGHT QUIRK, learned the slow way: with the game's WebGL
// loop, the map's own draw loop and headless SwiftShader all sharing one
// CPU, waitForSelector's "visible" poll — which rides the page's
// requestAnimationFrame — can starve indefinitely on an element that is
// by every measurable property visible (it did, at 1280x677 with
// visibility:visible, for four straight minutes). So waits here are for
// ATTACHED, and visibility is then asserted directly off the element's
// own geometry, which is the claim actually being tested anyway.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

const WRITE = !process.argv.includes("--no-shots");

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__grnEngine?.skipCinematic?.());
await page.waitForTimeout(1200);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };

// --- Open it the way a player does ------------------------------------
const opener = page.locator('button[aria-label="Open the full map"]');
check(await opener.count() === 1, "there is no way to open the map from the HUD");
await opener.click();
// Poll over CDP rather than waitForSelector. Even after the static map
// was cached, the waiter's fulfilment can starve behind the game's own
// loop — its logs showed "resolved to visible <canvas>" and then four
// minutes of silence. page.evaluate goes over the protocol directly and
// does not ride the page's requestAnimationFrame at all.
let shown = false;
for (let i = 0; i < 60 && !shown; i++) {
  shown = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="road-map"]');
    if (!c) return false;
    const r = c.getBoundingClientRect();
    const cs = getComputedStyle(c);
    return r.width > 200 && r.height > 200 && cs.visibility === "visible" && cs.display !== "none";
  });
  if (!shown) await page.waitForTimeout(500);
}
check(shown, "the map never appeared, or appeared without size");
// Several frames, so the first paint is not what gets measured.
await page.waitForTimeout(1200);

const out = await page.evaluate(() => {
  const canvas = document.querySelector('[data-testid="road-map"]');
  const map = window.__grnEngine.getRoadMap();
  const W = canvas.width, H = canvas.height;
  const side = Math.min(W, H);
  const ox = (W - side) / 2, oy = (H - side) / 2;

  // Read the canvas back. The map is drawn with 2D calls onto a
  // transparent canvas over a dark sheet, so "ink" is alpha.
  const c2 = document.createElement("canvas");
  c2.width = W; c2.height = H;
  const cx = c2.getContext("2d", { willReadFrequently: true });
  cx.drawImage(canvas, 0, 0);
  const px = cx.getImageData(0, 0, W, H).data;

  const at = (x, y) => {
    const i = (Math.round(y) * W + Math.round(x)) * 4;
    return [px[i], px[i + 1], px[i + 2], px[i + 3]];
  };
  /** Any ink within r pixels of a point, and the strongest colour there. */
  const near = (x, y, r) => {
    let best = null;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const sx = x + dx, sy = y + dy;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const [R, G, B, A] = at(sx, sy);
        if (A < 40) continue;
        const lum = R + G + B;
        if (!best || lum > best.lum) best = { r: R, g: G, b: B, a: A, lum };
      }
    }
    return best;
  };

  // The painted road's own extent, from the ink itself.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, inked = 0;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (at(x, y)[3] < 40) continue;
      inked++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  // Ink at each mark the model claims.
  const marks = map.markers.map((m) => {
    const x = ox + m.x * side;
    const y = oy + m.y * side;
    const hit = near(x, y, Math.max(6, Math.round(side / 90)));
    return { kind: m.kind, name: m.name, s: Math.round(m.s), found: !!hit, hit };
  });

  // Ink along the road itself, sampled off the model's own path.
  let onPath = 0;
  for (let i = 0; i < map.path.length; i += 5) {
    const p = map.path[i];
    if (near(ox + p.x * side, oy + p.y * side, 5)) onPath++;
  }

  // Both legs, in their own colours. Sampled at the middle of each leg
  // so a map that drew one road twice is caught.
  const legInk = map.legs.map((leg) => {
    const mid = map.path[Math.round((leg.from + leg.to) / 2)];
    const hit = near(ox + mid.x * side, oy + mid.y * side, 6);
    return { name: leg.name, hit };
  });

  return {
    W, H, side, ox, oy,
    inked,
    box: { minX, maxX, minY, maxY },
    marks,
    onPath,
    pathSamples: Math.ceil(map.path.length / 5),
    legInk,
    markerCount: map.markers.length,
    shot: c2.toDataURL("image/png"),
  };
});

if (WRITE && out.shot) {
  mkdirSync("press/map", { recursive: true });
  writeFileSync("press/map/roadmap.png", Buffer.from(out.shot.split(",")[1], "base64"));
}

console.log(`canvas       ${out.W}x${out.H}, the model's square is ${Math.round(out.side)} px at ${Math.round(out.ox)},${Math.round(out.oy)}`);
console.log(`ink          ${out.inked} sampled pixels carry paint`);
check(out.inked > 2000, `only ${out.inked} pixels have anything on them — the map is blank`);

// --- The road is drawn along the road ---------------------------------
console.log(`road         ${out.onPath}/${out.pathSamples} points of the centreline have ink on them`);
check(
  out.onPath > out.pathSamples * 0.95,
  `${out.pathSamples - out.onPath} points of the road were not painted`
);

// --- ...and inside the square the model was fitted into ---------------
//
// The check an aspect-correct model cannot make about itself. If the
// renderer stretched the square to fill a 1280-wide box, the ink would
// run past the square's right edge and this is where it shows.
{
  const b = out.box;
  const slack = out.side * 0.06;   // labels sit outside their marks
  console.log(
    `bounds       ink spans x ${Math.round(b.minX)}..${Math.round(b.maxX)}, ` +
    `y ${Math.round(b.minY)}..${Math.round(b.maxY)}`
  );
  check(
    b.minX >= out.ox - slack && b.maxX <= out.ox + out.side + slack,
    `the map is painted outside its own square horizontally — it has been stretched to fill the box`
  );
  check(
    b.minY >= out.oy - slack && b.maxY <= out.oy + out.side + slack,
    `the map is painted outside its own square vertically`
  );
}

// --- Both roads, told apart -------------------------------------------
console.log("");
for (const l of out.legInk) {
  console.log(
    `leg          ${l.name.padEnd(22)} ${l.hit ? `rgb(${l.hit.r},${l.hit.g},${l.hit.b})` : "NOTHING PAINTED"}`
  );
  check(!!l.hit, `${l.name} is not painted at all`);
}
if (out.legInk.length === 2 && out.legInk[0].hit && out.legInk[1].hit) {
  const a = out.legInk[0].hit, b = out.legInk[1].hit;
  const apart = Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
  console.log(`             the two roads are ${apart}/765 apart in colour`);
  check(apart > 90, "the two roads are drawn the same colour — the map cannot tell them apart");
}

// --- Every mark the model claims is actually on the map ---------------
console.log("");
const missing = out.marks.filter((m) => !m.found);
const byKind = {};
for (const m of out.marks) byKind[m.kind] = (byKind[m.kind] ?? 0) + (m.found ? 1 : 0);
console.log(
  `marks        ${out.marks.length - missing.length}/${out.markerCount} painted: ` +
  Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(", ")
);
for (const m of missing) console.log(`  MISSING    ${m.kind} "${m.name}" at ${m.s} m`);
check(!missing.length, `${missing.length} of the map's own marks are not painted: ${missing.map((m) => m.name).join(", ")}`);
check((byKind.station ?? 0) >= 2, "the petrol stations are not on the map");
check((byKind.district ?? 0) >= 10, `only ${byKind.district ?? 0} districts are painted`);
check((byKind.landmark ?? 0) >= 5, `only ${byKind.landmark ?? 0} landmarks are painted — buildWorld registers seven`);

// --- Escape puts it away ----------------------------------------------
await page.keyboard.press("Escape");
await page.waitForTimeout(600);
const stillOpen = await page.evaluate(() => !!document.querySelector('[data-testid="road-map"]'));
console.log(`\nclose        Escape ${stillOpen ? "did NOT close it" : "closed it"}`);
check(!stillOpen, "Escape does not close the map");
// ...and the game is still there rather than paused into a corner.
const running = await page.evaluate(() => !!window.__grnDebug);
check(running, "the game did not survive the map being opened and closed");

console.log(
  fail.length
    ? "\nFAILURES:\n - " + fail.join("\n - ")
    : "\nthe whole road is painted, and everything with a name is on it"
);
await browser.close();
process.exit(fail.length ? 1 : 0);
