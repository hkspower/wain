// A red lamp has to stay red.
//
//   npm run dev
//   node tests/taillights.mjs
//
// The rear lamps ran the lens at emissive 7 and the core at 10 under
// braking, with an additive halo behind them, and then the whole thing
// went through ACES and a bloom. Rendered and sampled, the core came out
// at (255, 248, 234) — saturation 0.08. That is not a bright red light,
// it is a white one, and from the driver's seat it is the back of the
// car turning into a sheet of glare every time the pedal goes down.
//
// The cause is not the lamp, it is the tone map. ACES walks every bright
// colour toward white, so the only headroom an emissive has is whatever
// its green and blue start at: 0xff2222 begins at 13% of each and is
// most of the way to white by intensity 4. A lamp that is going to be
// bright has to start at pure red and stay at an intensity the shoulder
// has not eaten.
//
//   red       the lens and the core are still red at full brakes,
//             measured off a render with the real tone map on it
//   white     and almost none of the lamp has gone achromatic
//   step      braking is plainly brighter than running — that is the
//             entire job of a brake light
//   one place the engine's per-frame flare and the material it flares
//             agree, because they read the same six numbers
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
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnTail, null, { timeout: 180000 });
await page.waitForTimeout(1500);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// The car alone, in the dark, with the same tone map the game renders
// with. No world lights, no bloom: bloom adds glow around a lamp but it
// cannot put red back into one that the tone map has already turned
// white, and leaving it out means the only thing in frame IS the lamps.
const look = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const T = window.__grnTail;
  const shot = (brake) => {
    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0x05070c);
    sc.add(new THREE.AmbientLight(0x334455, 0.5));
    const g = window.__grnBuildCar({ body: 0x2a3038, style: "sedan" });
    sc.add(g);
    g.userData.tailMat.emissiveIntensity = brake ? T.lensBrake : T.lensIdle;
    g.userData.tailCoreMat.emissiveIntensity = brake ? T.coreBrake : T.coreIdle;
    (g.userData.tailGlowMats ?? []).forEach((m) => (m.opacity = brake ? T.glowBrake : T.glowIdle));
    const cam = new THREE.PerspectiveCamera(24, 800 / 520, 0.1, 100);
    cam.position.set(0, 0.95, -6.4);
    cam.lookAt(0, 0.8, 0);
    const cv = document.createElement("canvas");
    cv.width = 800;
    cv.height = 520;
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    r.setSize(800, 520, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.15;
    r.render(sc, cam);
    const c2 = document.createElement("canvas");
    c2.width = 800;
    c2.height = 520;
    const ctx = c2.getContext("2d");
    ctx.drawImage(cv, 0, 0);
    const px = ctx.getImageData(0, 0, 800, 520).data;
    // No coordinates. On a dark car in a dark room the only lit thing is
    // the lamps, so "lit" finds them wherever the body puts them and the
    // check does not break the next time a silhouette moves a lens.
    let n = 0, white = 0, R = 0, G = 0, B = 0, sat = 0, peak = 0;
    for (let i = 0; i < px.length; i += 4) {
      const mx = Math.max(px[i], px[i + 1], px[i + 2]);
      if (mx < 120) continue;
      const mn = Math.min(px[i], px[i + 1], px[i + 2]);
      const s = (mx - mn) / mx;
      n++; R += px[i]; G += px[i + 1]; B += px[i + 2]; sat += s;
      peak = Math.max(peak, mx);
      if (s < 0.25) white++;
    }
    g.traverse((o) => o.geometry && o.geometry.dispose?.());
    r.dispose();
    return {
      lit: n,
      mean: [Math.round(R / n), Math.round(G / n), Math.round(B / n)],
      sat: +(sat / n).toFixed(3),
      whitePct: +((white / n) * 100).toFixed(1),
      peak,
    };
  };
  return { brake: shot(true), coast: shot(false), T: { ...T } };
});

for (const [name, r] of [["running", look.coast], ["braking", look.brake]]) {
  console.log(
    `${name.padEnd(9)} ${String(r.lit).padStart(5)} lit px  mean rgb ${r.mean.join(",").padEnd(12)} ` +
      `saturation ${r.sat}  achromatic ${r.whitePct}%`
  );
}
console.log(
  `red       ${check(
    look.brake.sat >= 0.55 && look.coast.sat >= 0.6,
    `the lamps average ${look.brake.sat} saturation on the brakes and ${look.coast.sat} running — ` +
      `at 0.08 the old core was a white light with a red surround`
  )}  ${look.brake.sat} on the brakes, ${look.coast.sat} running`
);
console.log(
  `white     ${check(
    look.brake.whitePct <= 3 && look.coast.whitePct <= 3,
    `${look.brake.whitePct}% of a braking lamp has lost its colour entirely`
  )}  ${look.brake.whitePct}% of the braking lamp is achromatic`
);
// A brake light that is not obviously brighter than a tail light is not
// doing its one job.
//
// Brightness, not area. The lit AREA is the same in both states here and
// should be: it is the same lenses, and the halo that does grow under
// braking is an additive sprite the bloom would spread — and there is no
// bloom in this render, on purpose, because bloom can add glow around a
// lamp but cannot put red back into one the tone map has whitened. What
// has to be true without it is that the lamp is plainly brighter.
const brighter =
  look.brake.mean.reduce((a, b) => a + b, 0) / look.coast.mean.reduce((a, b) => a + b, 0);
console.log(
  `step      ${check(
    brighter > 1.25,
    `a braking lamp is only ${((brighter - 1) * 100).toFixed(0)}% brighter than a running one`
  )}  ${((brighter - 1) * 100).toFixed(0)}% brighter on the pedal ` +
    `(peak ${look.coast.peak} → ${look.brake.peak}; both lenses clip, which is what a lamp does)`
);

// --- One set of numbers, not two ---------------------------------------
//
// The levels were six unnamed constants: three baked into the materials
// in cars.ts and three assigned every frame by the engine's brake flare,
// with nothing to stop the pair drifting apart. They read the same
// object now, and this is what says so.
const wired = await page.evaluate(() => {
  const e = window.__grnEngine;
  const T = window.__grnTail;
  const read = () => ({
    lens: e.carBody.userData.tailMat.emissiveIntensity,
    core: e.carBody.userData.tailCoreMat.emissiveIntensity,
    glow: e.carBody.userData.tailGlowMats[0].opacity,
  });
  e.setPaused(true);
  e.player.speed = 60 / 3.6;
  for (let i = 0; i < 4; i++) { e.setTouchInput({ brake: 1, throttle: 0 }); e.update(1 / 60); }
  const braking = read();
  for (let i = 0; i < 4; i++) { e.setTouchInput({ brake: 0, throttle: 0.3 }); e.update(1 / 60); }
  const running = read();
  return { braking, running, T: { ...T } };
});
const matches =
  wired.braking.lens === wired.T.lensBrake &&
  wired.braking.core === wired.T.coreBrake &&
  Math.abs(wired.braking.glow - wired.T.glowBrake) < 1e-6 &&
  wired.running.lens === wired.T.lensIdle &&
  wired.running.core === wired.T.coreIdle &&
  Math.abs(wired.running.glow - wired.T.glowIdle) < 1e-6;
console.log(
  `one place ${check(
    matches,
    `the engine flares to lens ${wired.braking.lens} / core ${wired.braking.core} where the ` +
      `materials are built from ${wired.T.lensBrake} / ${wired.T.coreBrake}`
  )}  the live car matches TAIL in both states`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe brake lights are red.");
