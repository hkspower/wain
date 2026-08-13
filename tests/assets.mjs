// The Blender build has to reach the screen. Every asset in
// public/models is optional by design — a missing or renamed file falls
// back to the procedural build in silence — which is exactly why it
// needs a test: a broken node name, a dropped git add, or a swap that
// never fires all look identical to "working" from the outside.
//
// So this asserts the authored geometry is live on the hero car's
// shells, on all five parts of all four wheels (mirrored on the left),
// and on the palm crowns, and that each piece still occupies the
// envelope the rest of the game is positioned against.
//
//   npm run dev            # in another shell
//   npm run test:assets
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium");
  process.exit(2);
}
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 120000 });
// The swaps are async fetches of multi-megabyte files: wait on the
// condition, not on a guessed delay.
await page.waitForFunction(() => {
  const e = window.__grnEngine;
  let shells = 0, authored = 0;
  e.carBody.traverse((o) => {
    if (o.isMesh && o.userData.shell) { shells++; if (o.geometry.userData.authored) authored++; }
  });
  const w = (e.carBody.userData.wheels ?? [])[0];
  let parts = 0, wauth = 0;
  w?.traverse((o) => {
    if (o.isMesh && o.userData.wheelPart) { parts++; if (o.geometry.userData.authored) wauth++; }
  });
  return shells > 0 && shells === authored && parts > 0 && parts === wauth;
}, null, { timeout: 90000 }).catch(() => console.log("(timed out waiting for the authored swaps)"));

const r = await page.evaluate(() => {
  const e = window.__grnEngine;
  let root = e.world.moonLight;
  while (root.parent) root = root.parent;

  const shells = [];
  e.carBody.traverse((o) => {
    if (o.isMesh && o.userData.shell)
      shells.push({ slot: o.userData.shell, authored: !!o.geometry.userData.authored,
                    tris: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 });
  });

  const wheels = (e.carBody.userData.wheels ?? []).map((w) => {
    const parts = {};
    let side = 0;
    w.traverse((o) => {
      if (!o.isMesh || !o.userData.wheelPart) return;
      side = o.userData.wheelSide;
      const g = o.geometry;
      g.computeBoundingBox();
      const bb = g.boundingBox;
      parts[o.userData.wheelPart] = {
        authored: !!g.userData.authored,
        tris: (g.index?.count ?? g.attributes.position.count) / 3,
        x: [+bb.min.x.toFixed(3), +bb.max.x.toFixed(3)],
        r: +Math.max(Math.abs(bb.min.y), bb.max.y, Math.abs(bb.min.z), bb.max.z).toFixed(3),
      };
    });
    return { side, spokes: w.userData.spokes, parts };
  });

  let palm = null;
  root.traverse((o) => {
    if (o.isInstancedMesh && o.geometry.userData.authored && !palm)
      palm = { count: o.count, tris: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 };
  });
  return { shells, wheels, palm };
});

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

console.log("body shells:");
for (const s of r.shells)
  console.log(`  ${s.slot.padEnd(7)} ${s.tris} tris  ${check(s.authored, `${s.slot} still procedural`)}`);

console.log("\nwheels:");
for (const [i, w] of r.wheels.entries()) {
  const names = Object.keys(w.parts).sort().join(",");
  const t = Object.values(w.parts).reduce((a, p) => a + p.tris, 0);
  const auth = Object.values(w.parts).every((p) => p.authored);
  console.log(`  wheel ${i} side=${w.side} spokes=${w.spokes} parts=[${names}] ${t} tris  ` +
    check(auth, `wheel ${i} has procedural parts`));
  check(names === "Alloy,Barrel,Lugs,Rotor,Tire".toLowerCase().split(",").sort().join(",") ||
        names === "alloy,barrel,lugs,rotor,tire", `wheel ${i} parts: ${names}`);
  const tire = w.parts.tire;
  check(Math.abs(tire.r - 0.36) < 0.002, `wheel ${i} tire radius ${tire.r} != 0.36`);
  check(Math.abs(tire.x[0] + 0.13) < 0.002 && Math.abs(tire.x[1] - 0.13) < 0.002,
    `wheel ${i} tire width ${tire.x} != +-0.13`);
  // Outboard parts must sit on the wheel's own outboard side
  const lug = w.parts.lugs;
  const outboard = w.side > 0 ? lug.x[0] > 0 : lug.x[1] < 0;
  check(outboard, `wheel ${i} (side ${w.side}) lugs at x ${lug.x} are on the wrong face`);
}
console.log(`\npalm crowns: ${r.palm ? `${r.palm.tris} tris x ${r.palm.count} instances = ${r.palm.tris * r.palm.count} tris` : "NONE"}  ` +
  check(!!r.palm, "palm crowns never upgraded"));
console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nauthored geometry is live everywhere");
await browser.close();
process.exit(fail.length ? 1 : 0);
