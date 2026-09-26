// The Blender build has to reach the screen. Every asset in
// public/models is optional by design — a missing or renamed file falls
// back to the procedural build in silence — which is exactly why it
// needs a test: a broken node name, a dropped git add, or a swap that
// never fires all look identical to "working" from the outside.
//
// So this asserts the authored geometry is live on all five parts of
// all four wheels (mirrored on the left) wherever the build ships that
// wheel, and on the palm crowns, that
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
/** Spoke counts with an authored wheel in the build; any other wheel is
 *  the procedural fallback, by design, and must be asserted as such. */
const SHIPPED_SPOKES = [0, 4, 5, 6, 7, 8].filter((n) => ships(`wheel-${n}`));

/** The wheel the game FITS, not the section it is authored at: cars.ts
 *  scales the 0.36 / 0.13 section to these, and models.ts scales the
 *  authored GLB to the same. Read from the source, so the test follows
 *  a deliberate change instead of pinning the old number. */
const carsSrc = readFileSync("src/game/cars.ts", "utf8");
const constOf = (name) => {
  const m = carsSrc.match(new RegExp(`export const ${name} = ([0-9.]+);`));
  if (!m) { console.error(`cannot find ${name} in src/game/cars.ts`); process.exit(2); }
  return +m[1];
};
const TIRE_RADIUS = constOf("TIRE_RADIUS");
const TIRE_HALF_W = constOf("TIRE_HALF_W");

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
await page.waitForFunction(({ wantDriver, shipped }) => {
  const e = window.__grnEngine;
  let shells = 0, authored = 0, dparts = 0, dauth = 0;
  e.carBody.traverse((o) => {
    if (o.isMesh && o.userData.shell) { shells++; if (o.geometry.userData.authored) authored++; }
  });
  const w = (e.carBody.userData.wheels ?? [])[0];
  let parts = 0, wauth = 0;
  w?.traverse((o) => {
    if (o.isMesh && o.userData.wheelPart) { parts++; if (o.geometry.userData.authored) wauth++; }
  });
  // The driver hangs off the car (or its rig), not off a wheel — counted
  // under the wheel it was always 0, and every run sat out the timeout.
  const rig = e.carBody.userData.driver;
  (rig ? rig.group : e.carBody).traverse((o) => {
    // Only the slots driver.glb carries (the same five asserted below):
    // the handbrake grip and gear knob are procedural by design.
    if (o.isMesh && ["helmet", "visor", "glove", "wheel", "pedal"].includes(o.userData.driverPart)) {
      dparts++; if (o.geometry.userData.authored) dauth++;
    }
  });
  // Shells settle to a VERDICT, not to "authored". A shell that has
  // drifted from the profile it claims to be lofted from is rejected on
  // purpose, and waiting for it to land would wait for ever.
  const verdict = e.carBody.userData.shellSwap ?? {};
  const judged = verdict.all !== undefined || Object.keys(verdict).length >= shells;
  void authored;
  // Wait on the wheel swap only when there is one to wait for: a wheel
  // whose spoke count has no GLB stays procedural for ever.
  const wantWheel = shipped.includes(w?.userData.spokes ?? -1);
  return shells > 0 && judged && parts > 0 && (!wantWheel || parts === wauth)
    && (!wantDriver || (dparts > 0 && dparts === dauth));
}, { wantDriver: SHIPS_DRIVER, shipped: SHIPPED_SPOKES }, { timeout: 90000 }).catch(() => console.log("(timed out waiting for the authored swaps)"));

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
// still IS the car. That distinction was written after all four shipped
// shells were measured 160 to 206 mm taller and 80 to 120 mm longer at
// each end than the profile the game builds and positions everything
// against — lofted in August from a profiles.json that predated the body
// drop, the narrower widths and the sharper edges. models.ts rejected
// them and the procedural shell stood, and nothing had noticed.
//
// They are not stale now. All eight silhouettes were lofted from the
// current profiles.json and measured back with tools/shots/shelldrift.mjs:
// every one lands "authored", worst single-face box drift 1 mm against
// the 10 mm tolerance. The check below is what keeps that true — it is
// the drift that is forbidden, not any particular build.
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
  const want = SHIPPED_SPOKES.includes(w.spokes);
  const vals = Object.values(w.parts);
  const ok = want ? vals.every((p) => p.authored) : vals.every((p) => !p.authored);
  console.log(`  wheel ${i} side=${w.side} spokes=${w.spokes} ${want ? "authored" : "procedural (no wheel-" + w.spokes + ".glb)"} ` +
    `parts=[${names}] ${t} tris  ` +
    check(ok, want ? `wheel ${i} has procedural parts but wheel-${w.spokes} ships`
                   : `wheel ${i} has authored parts but no wheel-${w.spokes} ships`));
  // A pressed steel wheel (spokes 0) carries its vent slots as a sixth,
  // dark part; nothing else does.
  check(names === "alloy,barrel,lugs,rotor,tire" ||
        (w.spokes === 0 && names === "alloy,barrel,lugs,rotor,tire,vents"), `wheel ${i} parts: ${names}`);
  const tire = w.parts.tire;
  check(Math.abs(tire.r - TIRE_RADIUS) < 0.002, `wheel ${i} tire radius ${tire.r} != fitted ${TIRE_RADIUS}`);
  check(Math.abs(tire.x[0] + TIRE_HALF_W) < 0.002 && Math.abs(tire.x[1] - TIRE_HALF_W) < 0.002,
    `wheel ${i} tire width ${tire.x} != fitted +-${TIRE_HALF_W}`);
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
// The rim must match the radius the IK solves its grips against. The
// hands land on the rim's CENTRE line, and the authored rim is a torus:
// its outer extent is that radius plus the tube, and its thickness is
// the tube's diameter, so the centre line is (outer − thickness) / 2.
// This used to take the outer extent against a 30 mm tolerance, which
// passed a stale rim for any rig radius from 0.149 to 0.209 m.
if (r.driver.wheel && r.wheelRadius) {
  const size = r.driver.wheel.size;
  const outer = Math.max(...size), tube = Math.min(...size);
  const w = (outer - tube) / 2;
  console.log(`  rim centre line ${w.toFixed(3)} m (outer radius ${(outer / 2).toFixed(3)}, tube dia ${tube.toFixed(3)}) vs the rig's ${r.wheelRadius} m  ` +
    check(Math.abs(w - r.wheelRadius) < 0.003,
      `the authored rim's centre line is ${w.toFixed(3)} m but the hands are solved onto ${r.wheelRadius} m`));
}
console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nauthored geometry is live everywhere");
await browser.close();
process.exit(fail.length ? 1 : 0);
