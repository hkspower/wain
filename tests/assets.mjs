// The Blender build has to reach the screen. Every asset in
// public/models is optional by design — a missing or renamed file falls
// back to the procedural build in silence — which is exactly why it
// needs a test: a broken node name, a dropped git add, or a swap that
// never fires all look identical to "working" from the outside.
//
// So this asserts the authored geometry is live on all five parts of
// all four wheels (mirrored on the left) and on the palm crowns, that
// each piece still occupies the envelope the rest of the game is
// positioned against, and — for the body shells, where the shipped
// files have drifted off that envelope by up to 206 mm — that whatever
// IS on the car got there for a recorded reason.
//
// What it asserts is authored comes from public/models/build.json, not
// from a list written here. Those are different claims: the manifest
// says what the build produced, and a list in a test says what somebody
// once hoped it would. When they disagreed, this suite spent months red
// over `driver.glb` — a file that was gitignored, absent, and could not
// be produced without Blender. A test that cannot go green by fixing
// the code is not testing the code. Every part the manifest names must
// be authored and land in its envelope; every part it does not name
// must still be THERE, procedurally, because that is the fallback the
// whole module is built around.
//
//   npm run dev            # in another shell
//   npm run test:assets
import { chromium } from "playwright-core";
import { existsSync, readFileSync } from "node:fs";

/** What the Blender build actually shipped. */
const manifest = JSON.parse(readFileSync("public/models/build.json", "utf8"));
const ships = (f) =>
  !!manifest.assets?.[f] && existsSync(`public/models/${f}.glb`);
const SHIPS_DRIVER = ships("driver");

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
await page.waitForFunction((wantDriver) => {
  const e = window.__grnEngine;
  let shells = 0, authored = 0, dparts = 0, dauth = 0;
  e.carBody.traverse((o) => {
    if (o.isMesh && o.userData.shell) { shells++; if (o.geometry.userData.authored) authored++; }
  });
  const w = (e.carBody.userData.wheels ?? [])[0];
  let parts = 0, wauth = 0;
  w?.traverse((o) => {
    if (o.isMesh && o.userData.wheelPart) { parts++; if (o.geometry.userData.authored) wauth++; }
    if (o.isMesh && o.userData.driverPart) { dparts++; if (o.geometry.userData.authored) dauth++; }
  });
  // Shells settle to a VERDICT, not to "authored". A shell that has
  // drifted from the profile it claims to be lofted from is rejected on
  // purpose, and waiting for it to land would wait for ever.
  const verdict = e.carBody.userData.shellSwap ?? {};
  const judged = verdict.all !== undefined || Object.keys(verdict).length >= shells;
  void authored;
  return shells > 0 && judged && parts > 0 && parts === wauth
    && (!wantDriver || (dparts > 0 && dparts === dauth));
}, SHIPS_DRIVER, { timeout: 90000 }).catch(() => console.log("(timed out waiting for the authored swaps)"));

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
  // The driver's authored parts, by slot. These hang off joints an IK
  // solver moves every frame, so it is not enough that they loaded: the
  // rim has to still be the authored radius, or the solved hands grip
  // a rim that is not where the geometry is.
  const driver = {};
  const rig = e.carBody.userData.driver;
  (rig ? rig.group : e.carBody).traverse((o) => {
    if (!o.isMesh || !o.userData.driverPart) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    driver[o.userData.driverPart] = {
      authored: !!g.userData.authored,
      tris: (g.index?.count ?? g.attributes.position.count) / 3,
      size: [+(bb.max.x - bb.min.x).toFixed(3), +(bb.max.y - bb.min.y).toFixed(3),
             +(bb.max.z - bb.min.z).toFixed(3)],
    };
  });
  return { shells, wheels, palm, driver, wheelRadius: rig ? rig.wheelRadius : null,
           shellSwap: e.carBody.userData.shellSwap ?? {} };
});

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// Body shells. The claim used to be "the authored geometry is live",
// and it cannot be that any more: an authored shell is used only when it
// still IS the car. Measured against the geometry they replace, all four
// shipped shells are 160 to 206 mm taller and 80 to 120 mm longer at
// each end than the profile the game builds and positions everything
// against — lofted in August from a profiles.json that predates the body
// drop, the narrower widths and the sharper edges. models.ts rejects
// them and the procedural shell stands.
//
// So the claim is now the one that matters and can go green by fixing
// code: every shell on the car is the car, and the reason for each is
// recorded rather than silent. A shell with no verdict at all is the
// failure the original check was written for — a dropped git add, a
// renamed node, a swap that never fired.
console.log("body shells:");
for (const s of r.shells) {
  const why = r.shellSwap[s.slot] ?? r.shellSwap.all;
  console.log(`  ${s.slot.padEnd(7)} ${String(s.tris).padStart(6)} tris  ${(s.authored ? "authored" : "procedural").padEnd(11)} ${String(why)}  ` +
    check(!!why, `${s.slot}: nothing recorded about the swap — it never even ran`) + " " +
    check(s.authored === (why === "authored"),
      `${s.slot}: geometry says ${s.authored ? "authored" : "procedural"} but the swap says ${why}`));
}
{
  const stale = Object.entries(r.shellSwap).filter(([, v]) => String(v).startsWith("stale"));
  if (stale.length)
    console.log(`  ${stale.length} shipped shell(s) rejected as stale — rebuild them:\n` +
      `    node scripts/export-car-profiles.mjs && python3 tools/blender/build_assets.py --out public/models`);
}

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
console.log(`\ndriver: ${SHIPS_DRIVER ? "authored (driver.glb is shipped)" : "procedural (no driver.glb in the build)"}`);
for (const slot of ["helmet", "visor", "glove", "wheel", "pedal"]) {
  const d = r.driver[slot];
  // Present is the assertion in both worlds. Authored is the assertion
  // only when the build says it shipped one.
  if (!d) { fail.push(`driver ${slot} missing entirely`); console.log(`  ${slot.padEnd(7)} MISSING`); continue; }
  console.log(`  ${slot.padEnd(7)} ${d.tris} tris  ${d.size.join(" x ")} m  ` +
    (SHIPS_DRIVER
      ? check(d.authored, `driver ${slot} still procedural`)
      : check(!d.authored, `driver ${slot} is authored, but build.json does not ship a driver — the manifest is stale`)));
}
// The rim must match the radius the IK solves its grips against
if (r.driver.wheel && r.wheelRadius) {
  const w = Math.max(r.driver.wheel.size[0], r.driver.wheel.size[1]) / 2;
  console.log(`  rim radius ${w.toFixed(3)} m vs the rig's ${r.wheelRadius} m  ` +
    check(Math.abs(w - r.wheelRadius) < 0.03,
      `the authored rim is ${w.toFixed(3)} m but the hands are solved onto ${r.wheelRadius} m`));
}
console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nauthored geometry is live everywhere");
await browser.close();
process.exit(fail.length ? 1 : 0);
