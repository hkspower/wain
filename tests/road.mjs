// The two roads the lap is made of, measured on the live track.
//
//   npm run dev
//   node tests/road.mjs
//
// The return leg used to be an invented expressway and is now the Second
// Ring Road, الدائري الثاني. "Invented" and "reproduced" look identical
// in a screenshot, so the things that make it the real road are the
// things asserted here:
//
//   * both its ends land on Gulf Road — the defining fact about it
//   * its arc-to-chord ratio is the real road's 1.52, which is what
//     "7 km across a 4.6 km chord" means at any scale
//   * it bulges inland, monotonically, with no second lobe
//   * the districts along it are the real ones, in the real order
//   * it is drivable: no corner tighter than the corniche's tightest
//
// And one thing that is not about the new road at all: every landmark on
// the COASTAL leg has to be exactly where it was. The lap grew by 1.15
// km, and anything still positioned as a lap fraction has silently slid
// a hundred metres or more down the corniche. That is the failure this
// change was most likely to cause and the hardest to see.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

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
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
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

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const m = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  const t = e.track;
  const L = t.length;
  const coastEnd = window.__grnCoastU.to * L;

  const p = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const at = (s) => {
    t.pointAt(s, p);
    return { x: p.x, z: p.z };
  };

  // Arc length of the ring leg is just the lap minus the coastal leg;
  // its chord is the straight line between the two Gulf Road junctions.
  const A = at(coastEnd);
  const B = at(L - 330); // the second junction, before the run to the line
  const ringLen = L - coastEnd - 330;
  const chord = Math.hypot(B.x - A.x, B.z - A.z);

  // How far inland the arc gets, sampled along it, and whether it does so
  // in one clean bulge. Distance from the A-B chord line, signed.
  const ux = (B.x - A.x) / chord, uz = (B.z - A.z) / chord;
  const off = [];
  for (let i = 0; i <= 60; i++) {
    const q = at(coastEnd + (ringLen * i) / 60);
    off.push((q.x - A.x) * uz - (q.z - A.z) * ux);
  }
  const peak = Math.max(...off.map(Math.abs));
  const peakAt = off.findIndex((v) => Math.abs(v) === peak) / 60;
  // A single bulge changes direction once. Count sign changes of the
  // slope: one lobe rises then falls, so exactly one turning point.
  let turns = 0;
  for (let i = 1; i < off.length - 1; i++) {
    const d0 = Math.abs(off[i]) - Math.abs(off[i - 1]);
    const d1 = Math.abs(off[i + 1]) - Math.abs(off[i]);
    if (d0 > 0.5 && d1 < -0.5) turns++;
  }

  // Tightest corner on each leg, as a radius.
  const tightest = (from, to) => {
    let minR = 1e9, minAt = from;
    const step = 4;
    for (let s = from; s < to; s += step) {
      t.tangentAt(s, a);
      t.tangentAt(s + step, b);
      const ang = a.angleTo(b);
      const R = ang > 1e-9 ? step / ang : 1e9;
      if (R < minR) { minR = R; minAt = s; }
    }
    return { minR, minAt };
  };

  // The sea is on the left of the coastal leg and nowhere near the ring.
  const seaSide = (s) => {
    t.pose(s, -60, p, a);
    return p.x;
  };

  return {
    L,
    coastEnd,
    ringLen,
    chord,
    ratio: ringLen / chord,
    peak,
    peakAt,
    turns,
    A,
    B,
    coastCorner: tightest(0, coastEnd),
    ringCorner: tightest(coastEnd, L - 330),
    areas: window.__grnAreas,
    landmarks: window.__grnLandmarks,
    seaAtStart: seaSide(1500),
  };
});

console.log(
  `lap      ${m.L.toFixed(0)} m — Gulf Road ${m.coastEnd.toFixed(0)} m, Second Ring ${m.ringLen.toFixed(0)} m`
);

// --- 1. Both ends on Gulf Road -------------------------------------
// The junctions are the first and last points of the ring leg; the coast
// leg has to be what lies between them the other way round.
console.log(
  `ends     ${check(
    m.coastEnd > 3000 && m.coastEnd < 3800 && m.ringLen > 4000,
    `legs are ${m.coastEnd.toFixed(0)} m and ${m.ringLen.toFixed(0)} m`
  )}  junctions at (${m.A.x.toFixed(0)}, ${m.A.z.toFixed(0)}) and (${m.B.x.toFixed(0)}, ${m.B.z.toFixed(0)})`
);

// --- 2. The proportion that makes it the Second Ring ----------------
// 7 km of road across a coastal chord of roughly 4.6 km. The ratio is
// what survives the map's compression; the metre count does not.
console.log(
  `shape    ${check(
    Math.abs(m.ratio - 1.52) <= 0.06,
    `arc/chord is ${m.ratio.toFixed(3)}, want 1.52 ±0.06 — that is not the Second Ring's shape`
  )}  arc ${m.ringLen.toFixed(0)} m / chord ${m.chord.toFixed(0)} m = ${m.ratio.toFixed(3)}`
);
console.log(
  `bulge    ${check(
    m.turns === 1 && m.peak > 1300,
    m.turns !== 1
      ? `the arc has ${m.turns} lobes — a ring road has one`
      : `only ${m.peak.toFixed(0)} m from the chord at its deepest`
  )}  ${m.peak.toFixed(0)} m inland at ${(m.peakAt * 100).toFixed(0)}% along, ${m.turns} lobe`
);

// --- 3. Drivable ---------------------------------------------------
console.log(
  `corners  ${check(
    m.ringCorner.minR >= m.coastCorner.minR * 0.9,
    `tightest ring corner is ${m.ringCorner.minR.toFixed(0)} m radius against the corniche's ${m.coastCorner.minR.toFixed(0)} m`
  )}  ring ${m.ringCorner.minR.toFixed(0)} m @ ${m.ringCorner.minAt.toFixed(0)}, coast ${m.coastCorner.minR.toFixed(0)} m @ ${m.coastCorner.minAt.toFixed(0)}`
);

// --- 4. The real districts, in the real order -----------------------
const WANT = [
  "Sharq",
  "Bneid Al-Gar",
  "Salmiya",
  "Ras Al-Ard",
  "Shuwaikh Residential",
  "Shamiya",
  "Mansuriya",
  "Da'iya",
  "Dasma",
  "Kuwait City",
];
const got = m.areas.map((a) => a.name);
console.log(
  `districts ${check(
    JSON.stringify(got) === JSON.stringify(WANT),
    `lap order is ${got.join(" → ")}`
  )} ${got.length} in order`
);
// Every ring district has to actually be ON the ring, not on the coast.
const ringNames = WANT.slice(4, 9);
for (const name of ringNames) {
  const i = m.areas.findIndex((x) => x.name === name);
  if (i < 1) {
    check(false, `${name} is not on the lap at all`);
    continue;
  }
  const start = m.areas[i - 1].to;
  if (!check(start >= m.coastEnd - 1, `${name} starts at ${start} m, on the coastal leg`)) {
    console.log(`  ${name} starts at ${start} m but the ring starts at ${m.coastEnd.toFixed(0)} m`);
  }
}
// Arabic on every one of them, or the gantries fall back to a system face.
console.log(
  `arabic   ${check(
    m.areas.every((a) => /[؀-ۿ]/.test(a.arabic)),
    "a district has no Arabic name"
  )}  ${m.areas.length}/${m.areas.length} named in both scripts`
);

// --- 5. The coastal landmarks did not move --------------------------
// Metres from the start line, as measured off the placed objects. These
// are the numbers from before the return leg was replaced.
const WANT_AT = {
  "kuwait-towers": 117,
  "green-island": 734,
  "scientific-center": 2827,
  "ras-al-ard-light": 3414,
};
let worst = 0, worstName = "";
for (const [name, want] of Object.entries(WANT_AT)) {
  const got = m.landmarks[name];
  if (got === undefined) {
    check(false, `${name} is not in the world at all`);
    continue;
  }
  const d = Math.abs(got - want);
  if (d > worst) { worst = d; worstName = name; }
}
console.log(
  `landmarks ${check(worst <= 6, `${worstName} is ${worst.toFixed(0)} m from where it belongs`)} ` +
    `worst drift ${worst.toFixed(1)} m (${worstName || "none"})`
);

// --- 6. The sea is still on the left of the corniche ----------------
console.log(
  `sea      ${check(m.seaAtStart < 800, `60 m to the left of the corniche is x=${m.seaAtStart.toFixed(0)}, inland`)}  x=${m.seaAtStart.toFixed(0)} at 1500 m`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nGulf Road and the Second Ring ok.");
