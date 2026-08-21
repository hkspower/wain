// Does a crew actually exist in the game?
//
//   npm run dev
//   node tests/crew.mjs
//
// teams.ts has said since the day it was written that a crew's emblem is
// "a decal baked onto the car's roof". It was not. A crew lived in one
// running hub server's memory, appeared on one lobby card, and no part
// of the game the player drives had ever heard of it: cars.ts, engine.ts
// and RaceClient.tsx contained the word "team" zero times between them.
// Turn the hub off and your crew did not exist.
//
// So this checks the whole chain, from the saved crew to the pixels:
//
//   stored    a crew saved locally survives a reload with no hub running
//   tune      computeEffects reports it, which is how the car build hears
//   worn      the car carries a decal, seated on the roof panel — not
//             floating over it, not sunk inside it, not off the edge
//   upright   it reads the right way up from the chase camera, which is
//             the only place anyone will ever see it from
//   drawn     the emblem and the crew's NAME are really in the texture,
//             in the colours that were picked — the check that catches a
//             decal that is correctly placed and completely blank
//   solo      no crew, no decal, and the sunroof comes back
import { chromium } from "playwright-core";
import { existsSync, mkdtempSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium");
  process.exit(2);
}

/** The crew the test founds. Arabic name on purpose: this is a game set
 *  on the Gulf Road, and the tag sanitiser used to strip Arabic to an
 *  empty string, which the hub then threw away without a word. */
const CREW = {
  name: "ليالي السالمية",
  tag: "سلم",
  logo: { shape: "hex", symbol: "🦅", bg: "#0d0e11", fg: "#38c9ee" },
};

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate((crew) => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
  localStorage.setItem("gulf-road-nights-crew", JSON.stringify(crew));
}, CREW);
// No hub is running and none is needed. That is the point.
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 120000 });
await page.waitForTimeout(3500);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// --- The crew reaches the numbers the car is built from.
const tune = await page.evaluate(() => {
  // What the engine actually races with, not a fresh call that could
  // read storage the built car never saw.
  return window.__grnEngine.tune?.crew ?? null;
});
console.log(
  `tune      ${check(
    tune && tune.tag === CREW.tag && tune.name === CREW.name,
    tune
      ? `the tune reports crew [${tune.tag}] ${tune.name}, not [${CREW.tag}] ${CREW.name}`
      : "the tune reports no crew at all — the car build will never hear about it"
  )}  ${tune ? `[${tune.tag}] ${tune.name}` : "none"}`
);

// --- The car, as the engine actually built it for the player.
const worn = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  const car = e.carBody;
  const decal = car.userData.crewDecal;
  if (!decal) return { decal: false };
  car.updateMatrixWorld(true);
  let roof = null;
  car.traverse((o) => {
    if (o.userData.shell === "roof") roof = o;
  });
  roof.geometry.computeBoundingBox();
  const rb = roof.geometry.boundingBox;

  // Where the decal sits, in the car's own space — from its own local
  // matrix, not from a world box. The player's car is parked at whatever
  // heading the track had it on, and a world-space AABB of a rotated
  // plane is bigger than the plane, which would quietly turn every
  // measurement below into a different number every run.
  decal.updateMatrix();
  decal.geometry.computeBoundingBox();
  const local = decal.geometry.boundingBox.clone().applyMatrix4(decal.matrix);
  // The roof surface directly under the decal's centre, cast the same
  // way the builder measures it.
  const cx = (local.min.x + local.max.x) / 2;
  const cz = (local.min.z + local.max.z) / 2;
  const ray = new THREE.Raycaster(
    new THREE.Vector3(0, 6, cz),
    new THREE.Vector3(0, -1, 0)
  );
  const probe = new THREE.Mesh(roof.geometry, new THREE.MeshBasicMaterial());
  const hit = ray.intersectObject(probe, false)[0];
  const surfaceY = hit ? hit.point.y : null;

  // Which way is "up" in the picture, in car space. The chase camera sits
  // behind the car looking forward, so the top of the emblem has to point
  // at the nose (+z) or it reads upside down.
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(decal.quaternion);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(decal.quaternion);

  // And whether anything was drawn. The texture is a canvas — read it.
  const map = decal.material.map;
  const src = map.image;
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(src, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const band = (y0, y1) => {
    let lit = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < c.width; x++) {
        if (px[(y * c.width + x) * 4 + 3] > 40) lit++;
      }
    }
    return lit;
  };
  // The picked accent, anywhere in the image, within a tolerance for the
  // canvas's own antialiasing.
  const want = [0x38, 0xc9, 0xee];
  let accent = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (
      px[i + 3] > 200 &&
      Math.abs(px[i] - want[0]) < 26 &&
      Math.abs(px[i + 1] - want[1]) < 26 &&
      Math.abs(px[i + 2] - want[2]) < 26
    ) accent++;
  }

  return {
    decal: true,
    roof: {
      minZ: +rb.min.z.toFixed(3), maxZ: +rb.max.z.toFixed(3), maxX: +rb.max.x.toFixed(3),
    },
    box: {
      minX: +local.min.x.toFixed(3), maxX: +local.max.x.toFixed(3),
      minZ: +local.min.z.toFixed(3), maxZ: +local.max.z.toFixed(3),
      y: +((local.min.y + local.max.y) / 2).toFixed(4),
    },
    surfaceY: surfaceY === null ? null : +surfaceY.toFixed(4),
    upZ: +up.z.toFixed(3),
    upY: +up.y.toFixed(3),
    normalY: +normal.y.toFixed(3),
    texture: { w: c.width, h: c.height },
    emblemPx: band(0, c.width),
    namePx: band(c.width + 2, c.height),
    accentPx: accent,
  };
});

console.log(
  `worn      ${check(worn.decal, "the player's car carries no crew decal — the roof is bare")}` +
    (worn.decal ? `  ${worn.box.maxX - worn.box.minX > 0 ? "" : ""}decal on the roof` : "")
);

if (worn.decal) {
  const w = +(worn.box.maxX - worn.box.minX).toFixed(3);
  const l = +(worn.box.maxZ - worn.box.minZ).toFixed(3);
  console.log(
    `          ${w} x ${l} m on a ${(worn.roof.maxX * 2).toFixed(2)} x ` +
      `${(worn.roof.maxZ - worn.roof.minZ).toFixed(2)} m roof panel`
  );
  // Seated: paint-thin above the panel it lies on, not hovering, not sunk.
  const lift = worn.surfaceY === null ? null : +(worn.box.y - worn.surfaceY).toFixed(4);
  console.log(
    `seated    ${check(
      lift !== null && lift > 0 && lift < 0.03,
      lift === null
        ? "could not find the roof surface under the decal"
        : lift <= 0
          ? `the decal sits ${(-lift * 1000).toFixed(0)} mm INSIDE the roof — it is invisible`
          : `the decal floats ${(lift * 1000).toFixed(0)} mm above the roof`
    )}  ${lift === null ? "?" : (lift * 1000).toFixed(1)} mm of clearance`
  );
  // Inside the panel: a decal hanging off the roof edge is worse than none.
  const onPanel =
    worn.box.minZ > worn.roof.minZ - 0.01 &&
    worn.box.maxZ < worn.roof.maxZ + 0.01 &&
    Math.max(-worn.box.minX, worn.box.maxX) < worn.roof.maxX;
  console.log(
    `inside    ${check(onPanel, "the decal overhangs the roof panel it is supposed to lie on")}  ` +
      `z ${worn.box.minZ}..${worn.box.maxZ} within ${worn.roof.minZ}..${worn.roof.maxZ}`
  );
  // Lying flat, and reading the right way up from behind the car.
  console.log(
    `upright   ${check(
      worn.normalY > 0.85 && worn.upZ > 0.85,
      worn.normalY <= 0.85
        ? `the decal faces sideways (normal y ${worn.normalY}) instead of at the sky`
        : `the emblem's top points ${worn.upZ < 0 ? "backwards" : "sideways"} (z ${worn.upZ}) — ` +
          `it reads upside down from the chase camera`
    )}  face up ${worn.normalY}, top toward the nose ${worn.upZ}`
  );
  // Actually drawn. A perfectly placed blank plane passes every check above.
  console.log(
    `drawn     ${check(
      worn.emblemPx > 8000,
      `only ${worn.emblemPx} lit pixels in the emblem — the shield did not draw`
    )}  ${worn.emblemPx} emblem px`
  );
  console.log(
    `name      ${check(
      worn.namePx > 1200,
      `only ${worn.namePx} lit pixels under the emblem — the crew's NAME is missing from the decal`
    )}  ${worn.namePx} px in the name band`
  );
  console.log(
    `colours   ${check(
      worn.accentPx > 400,
      `the picked accent appears in ${worn.accentPx} pixels — the car is not wearing the crew's colours`
    )}  ${worn.accentPx} px of the chosen accent`
  );
}

// --- Every silhouette, not just the one on the road. The roofs run from
// 0.88 m long on the Z32 to 1.40 m on the hatch, and the R34 has a shark
// fin parked on the back of its own, so a decal sized for one panel is
// not automatically on any of the others.
const fleet = await page.evaluate((crew) => {
  const THREE = window.__grnThree;
  const out = [];
  for (const style of ["sedan", "zx", "gtr", "rx7", "hatch"]) {
    const g = window.__grnBuildCar({ body: 0x224466, style, crew });
    g.updateMatrixWorld(true);
    const decal = g.userData.crewDecal;
    let roof = null;
    let fin = null;
    g.traverse((o) => {
      if (o.userData.shell === "roof") roof = o;
    });
    if (!decal || !roof) { out.push({ style, decal: !!decal }); continue; }
    roof.geometry.computeBoundingBox();
    const rb = roof.geometry.boundingBox;
    decal.updateMatrix();
    decal.geometry.computeBoundingBox();
    const b = decal.geometry.boundingBox.clone().applyMatrix4(decal.matrix);
    const probe = new THREE.Mesh(roof.geometry, new THREE.MeshBasicMaterial());
    const cz = (b.min.z + b.max.z) / 2;
    const hit = new THREE.Raycaster(
      new THREE.Vector3(0, 6, cz),
      new THREE.Vector3(0, -1, 0)
    ).intersectObject(probe, false)[0];
    // The roof is not empty. Something slim and body-coloured stands on
    // the centreline at the trailing edge of both the saloon's panel and
    // the R34's, and a decal that drives through it is not on the roof,
    // it is inside the furniture.
    //
    // Measured in the car's own space, like the decal and the roof: the
    // group carries a per-silhouette scale, so a world-space box for the
    // fin against a group-local box for the decal compares 0.895 of one
    // number to all of another and reports a collision that is not there.
    for (const o of g.children) {
      if (o === decal || !o.isMesh || o.geometry === roof.geometry) continue;
      o.updateMatrix();
      o.geometry.computeBoundingBox();
      const ob = o.geometry.boundingBox.clone().applyMatrix4(o.matrix);
      // On the centreline, where the decal is — the saloon's roof rails
      // are the same slim shape at the same height, and they run down
      // the edges of the panel where nothing can collide with them.
      if (Math.abs(ob.min.x + ob.max.x) / 2 > 0.15) continue;
      if (ob.min.y > rb.min.y && ob.max.y - ob.min.y > 0.05 && ob.max.y - ob.min.y < 0.25 &&
          ob.max.x - ob.min.x < 0.1 && ob.min.z < rb.min.z + 0.3) fin = ob;
    }
    out.push({
      style,
      decal: true,
      lift: hit ? +((b.min.y + b.max.y) / 2 - hit.point.y).toFixed(4) : null,
      onPanel:
        b.min.z > rb.min.z - 0.01 && b.max.z < rb.max.z + 0.01 &&
        Math.max(-b.min.x, b.max.x) < rb.max.x,
      // 25 mm, because "they do not overlap" is not the same as "there
      // is room between them" on a panel this size.
      clearsFin: !fin || b.min.z > fin.max.z + 0.025,

      gap: fin ? +(b.min.z - fin.max.z).toFixed(3) : null,
      size: `${(b.max.x - b.min.x).toFixed(2)}x${(b.max.z - b.min.z).toFixed(2)}`,
    });
    g.traverse((o) => o.geometry && o.geometry.dispose?.());
  }
  return out;
}, CREW);

for (const f of fleet) {
  const ok =
    f.decal && f.lift !== null && f.lift > 0 && f.lift < 0.03 && f.onPanel && f.clearsFin;
  check(
    ok,
    !f.decal
      ? `the ${f.style} carries no crew decal at all`
      : f.lift === null || f.lift <= 0
        ? `the ${f.style} decal is ${f.lift === null ? "off" : "inside"} its roof`
        : f.lift >= 0.03
          ? `the ${f.style} decal floats ${(f.lift * 1000).toFixed(0)} mm over its roof`
          : !f.onPanel
            ? `the ${f.style} decal overhangs its roof panel`
            : `the ${f.style} decal leaves ${((f.gap ?? 0) * 1000).toFixed(0)} mm ` +
            `beside what already stands on its roof`
  );
  console.log(
    `  ${f.style.padEnd(7)} ${ok ? "ok  " : "FAIL"}  ${f.size ?? "-"} m, ` +
      `${f.lift === null ? "?" : (f.lift * 1000).toFixed(1)} mm clear` +
      (f.gap === null || f.gap === undefined ? "" : `, ${(f.gap * 1000).toFixed(0)} mm behind it`)
  );
}

// --- And a privateer's car is untouched: no decal, sunroof back.
const solo = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const withCrew = window.__grnBuildCar({
    body: 0xffffff,
    style: "sedan",
    crew: { name: "TEST", tag: "TST", logo: { shape: "shield", symbol: "🔥", bg: "#101010", fg: "#f5a524" } },
  });
  const without = window.__grnBuildCar({ body: 0xffffff, style: "sedan" });
  const glassRoofPanes = (g) => {
    g.updateMatrixWorld(true);
    let n = 0;
    g.traverse((o) => {
      // The sunroof is the only flat pane of GLASS above the beltline.
      // "Transparent and flat and up there" is not enough on its own —
      // the crew decal is all three, and counting it made a car with the
      // livery fitted look like a car that still had its sunroof.
      if (!o.isMesh || !o.material?.transparent) return;
      if (!o.material.isMeshPhysicalMaterial) return;
      const b = new THREE.Box3().setFromObject(o);
      if (b.min.y > 1.0 && b.max.y - b.min.y < 0.06 && b.max.x - b.min.x > 0.5) n++;
    });
    return n;
  };
  const out = {
    withDecal: !!withCrew.userData.crewDecal,
    withoutDecal: !!without.userData.crewDecal,
    sunroofWith: glassRoofPanes(withCrew),
    sunroofWithout: glassRoofPanes(without),
  };
  for (const g of [withCrew, without]) g.traverse((o) => o.geometry && o.geometry.dispose?.());
  return out;
});
console.log(
  `solo      ${check(
    !solo.withoutDecal,
    "a car built with no crew still carries a crew decal"
  )}  no crew, no decal`
);
console.log(
  `sunroof   ${check(
    solo.sunroofWithout === 1 && solo.sunroofWith === 0,
    solo.sunroofWithout !== 1
      ? `a privateer's car has ${solo.sunroofWithout} sunroofs — the glass roof went missing for everyone`
      : "a crew car still has a sunroof under its livery — the two are sharing the same panel"
  )}  ${solo.sunroofWithout} without a crew, ${solo.sunroofWith} with one`
);

// --- Online: the hub is where a crew gets SHARED, not where it lives.
//
// The lobby used to be the only place a crew could exist, which meant it
// existed in one process's memory: restart the hub and every crew in the
// game was gone. Now the save carries it, so the client can put it back.
//
// The lobby's socket URL is baked in at build time, so this has to use
// the port the app was built to talk to.
const HUB_PORT = Number(process.env.HUB_PORT_TEST ?? 8787);
const ledger = join(mkdtempSync(join(tmpdir(), "grn-crew-")), "referrals.json");
const startHub = () =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, ["server/hub-server.mjs"], {
      env: { ...process.env, HUB_PORT: String(HUB_PORT), HUB_LEDGER: ledger },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const onData = (b) => {
      out += b.toString();
      if (out.includes(String(HUB_PORT))) resolve(p);
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    setTimeout(() => resolve(p), 1500);
  });
const stopHub = (p) =>
  new Promise((r) => {
    if (!p || p.exitCode !== null) return r();
    p.on("exit", r);
    p.kill("SIGTERM");
    setTimeout(r, 1200);
  });

/** Open the lobby with this save's crew already in storage and join. */
const openLobby = async () => {
  const lobby = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  lobby.setDefaultTimeout(30000);
  await lobby.goto("http://localhost:3000/hub", { waitUntil: "networkidle" });
  await lobby.evaluate((crew) => {
    localStorage.setItem("gulf-road-nights-crew", JSON.stringify(crew));
    localStorage.setItem(
      "gulf-road-nights-profile",
      JSON.stringify({ name: "Faisal", color: "#f2f4f7" })
    );
  }, CREW);
  await lobby.reload({ waitUntil: "networkidle" });
  await lobby.click("text=JOIN THE HUB");
  return lobby;
};

let hub = null;
let lobby = null;
try {
  hub = await startHub();
  lobby = await openLobby();
  const seen = await lobby
    .waitForFunction(
      (name) => document.body.innerText.includes(name),
      CREW.name,
      { timeout: 15000 }
    )
    .then(() => true)
    .catch(() => false);
  console.log(
    `published ${check(
      seen,
      "a crew built offline never reaches the lobby — going online loses it"
    )}  the hub is showing ${CREW.name}`
  );

  // The hub forgets. The save does not.
  await lobby.close();
  await stopHub(hub);
  hub = await startHub();
  lobby = await openLobby();
  const again = await lobby
    .waitForFunction(
      (name) => document.body.innerText.includes(name),
      CREW.name,
      { timeout: 15000 }
    )
    .then(() => true)
    .catch(() => false);
  console.log(
    `restart   ${check(
      again,
      "the crew did not come back after the hub restarted — it only ever lived in that process"
    )}  the crew is back on a hub that never heard of it`
  );
} finally {
  if (lobby && !lobby.isClosed()) await lobby.close();
  await stopHub(hub);
}

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe crew is on the car.");
