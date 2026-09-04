#!/usr/bin/env node
// What window tint does — measured from both sides of the glass.
//
//   npm run dev
//   npm run check:tint
//
// Tint is the one styling choice that is also an OPTICAL one, and the
// two sides of it pull in opposite directions: the darker the car looks
// from outside, the less its driver can see out of it. Nobody can judge
// that by eye across two screenshots taken a minute apart, so this
// measures both — the flank from the chase camera, and the road ahead
// through the windscreen from the cockpit — at every step of the
// slider, and prints the pair.
//
// It also renders the shot each film produces, because "carbon" and
// "ceramic" are only worth different money if they are visibly
// different things.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import sharp from "sharp";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("No Chromium found."); process.exit(2); }

const OUT = "press/tint";
mkdirSync(OUT, { recursive: true });

const W = 900, H = 560;
const STEPS = [0, 25, 50, 75, 100];

const b = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});
const page = await b.newPage({ viewport: { width: W, height: H } });
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
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
await page.waitForTimeout(4000);

/** Park the car at a fixed place and hour, with nothing else in shot. */
const settle = async () => {
  await page.evaluate(async () => {
    const e = window.__grnEngine;
    e.setPaused(true);
    // setSky, not a bare assignment to timeHours. The game ships on the
    // real Kuwait clock, and the update loop READS that clock every
    // frame — so an hour poked in here is overwritten by the first of
    // the forty settling steps below, and the first run of this tool
    // measured tint at twenty to six in the evening while believing it
    // was half past two in the morning. setSky("night") turns the live
    // clock off and pins 00:30.
    e.setSky("night");
    const at = 1300; // the seaward leg: lamps down one side, sea down the other
    const far = e.track.wrap(at + e.track.length / 2);
    for (let i = 0; i < 40; i++) {
      e.update(1 / 60);
      for (const t of e.traffic) t.s = far;
      if (e.rival) { e.rival.s = far; e.rival.speed = 0; }
      e.player.s = at; e.player.lat = 0; e.player.speed = 0;
    }
    await new Promise((r) => setTimeout(r, 250));
  });
  await page.waitForTimeout(500);
};

/**
 * Set the darkness on the car being driven, rebuild it, and CHECK.
 *
 * The check is not ceremony. A fresh player has never written a garage,
 * so localStorage holds nothing and `g.car` is undefined — the first
 * version of this wrote the tint to a build keyed "undefined", read
 * back nothing, and reported that the slider changes the picture by 0.4
 * of a luma step at every setting. That is a measurement of the
 * measurer. An instrument that cannot confirm it applied the thing it
 * is about to measure has no business printing a table.
 */
const setTint = async (pct, film = "carbon") => {
  const got = await page.evaluate(({ p, film }) => {
    const e = window.__grnEngine;
    const KEY = "gulf-road-nights-garage";
    const g = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    g.kd ??= 0;
    g.cars = Array.isArray(g.cars) && g.cars.length ? g.cars : ["wain-special"];
    g.car = g.car && g.cars.includes(g.car) ? g.car : g.cars[0];
    g.builds ??= {};
    g.builds[g.car] ??= { owned: [], equipped: {} };
    const b = g.builds[g.car];
    b.owned = Array.isArray(b.owned) ? b.owned : [];
    b.equipped = b.equipped ?? {};
    // The film is the purchase, so a measurement that forgets to fit
    // one measures factory glass and calls it tint.
    const partId = `film-${film}`;
    if (!b.owned.includes(partId)) b.owned.push(partId);
    b.equipped.film = partId;
    b.tint = p;
    localStorage.setItem(KEY, JSON.stringify(g));
    e.applyGarage();
    return { tint: e.tune.tint, film: e.tune.tintFilm };
  }, { p: pct, film });
  if (got.tint !== pct || got.film !== film) {
    console.error(
      `asked for ${pct}% of ${film} and the car came back ${got.tint}% of ${got.film} ` +
      `— it never reached the shell`
    );
    await b.close();
    process.exit(1);
  }
};

/**
 * Mean luminance of the middle of the frame, 0-255.
 *
 * The middle, not the whole picture: from the cockpit the edges are
 * dashboard and pillar, which do not change with the tint and would
 * dilute exactly the number this is trying to read. Rec. 709 luma,
 * because the eye is not an average of three channels.
 */
//
// ONE crop, shared with the difference below, so the two numbers cannot
// be measuring different pictures. It also has to exclude the HUD: the
// clock in the top-right ticks between captures, and with the full
// frame in scope that moving text WAS the difference — 245 out of 255
// at the worst pixel, on a change that never touched it.
const CROP = (width, height) => ({
  left: Math.round(width * 0.3), top: Math.round(height * 0.3),
  width: Math.round(width * 0.4), height: Math.round(height * 0.4),
});

const luma = async (path) => {
  const im = sharp(path);
  const { width, height } = await im.metadata();
  const { data, info } = await im
    .extract(CROP(width, height))
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  const px = info.width * info.height;
  for (let i = 0; i < px; i++) {
    const o = i * info.channels;
    sum += 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
  }
  return sum / px;
};

// "close" rather than "chase": the chase camera sits far enough back
// that the rear window is a few dozen pixels, and the first run of this
// averaged a crop that was nine parts asphalt to one part glass — which
// is how a change to the glass came out as 0.9 of a luma step. Close is
// tucked in behind the boot lid, where the window fills the frame.
//
// Cockpit stays in the table for the opposite reason: to show that it
// does NOT change. The camera sits over the bonnet, outside the screen,
// so tinting the canopy cannot cost the driver any forward vision — and
// that is worth a measured line rather than an assumption either way.
const VIEWS_MEASURED = ["close", "cockpit"];

const rows = [];
for (const pct of STEPS) {
  await setTint(pct);
  await settle();
  const out = {};
  for (const view of VIEWS_MEASURED) {
    await page.evaluate((v) => window.__grnEngine.setView(v), view);
    await settle();
    const path = `${OUT}/${view}-${pct}.png`;
    await page.screenshot({ path, clip: { x: 0, y: 0, width: W, height: H } });
    out[view] = await luma(path);
  }
  rows.push({ pct, ...out });
}

/**
 * How much of the picture actually changed, against the untinted frame.
 *
 * The crop luma above says how dark one region got. This says whether
 * the frame changed AT ALL, and by how much, without anyone having to
 * pick the right rectangle first — which is the step the first version
 * of this tool got wrong.
 */
const raw = (path) => sharp(path).extract(CROP(W, H)).raw().toBuffer({ resolveWithObject: true });

const diff = async (a, c, mask) => {
  const [x, y] = await Promise.all([raw(a), raw(c)]);
  let sum = 0, max = 0, n = 0;
  const len = Math.min(x.data.length, y.data.length);
  for (let i = 0; i < len; i++) {
    if (mask && !mask[i]) continue;
    const d = Math.abs(x.data[i] - y.data[i]);
    sum += d;
    n++;
    if (d > max) max = d;
  }
  return { mean: n ? sum / n : 0, max, n };
};

/**
 * The pixels the tint touches, found rather than guessed.
 *
 * Averaging over a rectangle was the wrong question and gave a wrong
 * answer for a whole afternoon. The rear window is under 2% of even a
 * tight crop of this frame, so ANY change confined to the glass comes
 * out near 1 of 255 no matter how total it is — carbon against ceramic
 * measured 1.25 while individual pixels differed by 149. That is a
 * measurement of how much of the picture is glass, not of how different
 * two films are.
 *
 * So the mask is built from the effect itself: every channel that moves
 * between no film and 100% of one IS the glass, by definition, and the
 * films are then compared only there.
 */
const glassMask = async (clear, dark) => {
  const [a, b2] = await Promise.all([raw(clear), raw(dark)]);
  const m = new Uint8Array(a.data.length);
  let on = 0;
  for (let i = 0; i < m.length; i++) {
    // 8 of 255: above the renderer's own frame-to-frame jitter on this
    // scene, well below the change tint makes where it applies.
    if (Math.abs(a.data[i] - b2.data[i]) > 8) { m[i] = 1; on++; }
  }
  return { m, on, of: m.length };
};

console.log("\n  tint    glass luma   cockpit luma   frame vs 0%   worst pixel");
console.log("  ---------------------------------------------------------------");
for (const r of rows) {
  const d = await diff(`${OUT}/close-0.png`, `${OUT}/close-${r.pct}.png`, null);
  console.log(
    `  ${String(r.pct).padStart(3)}%  ${r.close.toFixed(1).padStart(9)}   ` +
    `${r.cockpit.toFixed(1).padStart(10)}   ${d.mean.toFixed(2).padStart(9)}   ` +
    `${String(d.max).padStart(8)}`
  );
}
console.log(`\n  ${OUT}/close-*.png, ${OUT}/cockpit-*.png`);

// --- and the three products, at one darkness ------------------------
//
// The shelf sells rolls at different prices. If two of them render the
// same picture, it is one roll with two price tags — so this renders
// each at the SAME 70% and diffs them against each other. The numbers
// below are the whole justification for the shop having more than one
// entry, and they have already cost it one: a ceramic film sat above
// carbon at 1400 KD until this measured the pair 2.95 apart.
// The shelf, and this check is what decides its length: it cut a
// ceramic roll for rendering the same window as carbon, and it is what
// the mirrored one had to clear before it went on.
const FILMS = ["dyed", "carbon", "mirror"];
const shots = {};
for (const film of FILMS) {
  await setTint(70, film);
  await settle();
  await page.evaluate(() => window.__grnEngine.setView("close"));
  await settle();
  const path = `${OUT}/film-${film}.png`;
  await page.screenshot({ path, clip: { x: 0, y: 0, width: W, height: H } });
  shots[film] = { path, luma: await luma(path) };
}
console.log(`\n  the ${FILMS.length} films, all cut at 70%`);
console.log("  ------------------------------------------------");
for (const f of FILMS) console.log(`  ${f.padEnd(9)} glass luma ${shots[f].luma.toFixed(1)}`);
// And this one is a CHECK, not a readout.
//
// Three rolls at three prices have to be three pictures. The threshold
// is 2.0 of 255 averaged over the crop, chosen against two measured
// numbers rather than picked: putting 70% of carbon on a car instead of
// leaving it clear moves the same crop by 5.3, and ceramic against
// carbon once measured 1.21 — a pair that reads as the same window in a
// side-by-side. 2.0 sits above the pair nobody could tell apart and
// well under the change the tint itself makes.
//
// The floor is on the GLASS, not on the frame. Over the glass pixels a
// change to the film is the only thing happening, so the number is the
// product difference rather than the product difference diluted by
// however much asphalt is in shot.
const FLOOR = 6.0;
const mask = await glassMask(`${OUT}/close-0.png`, `${OUT}/close-100.png`);
console.log(
  `\n  glass mask: ${mask.on} of ${mask.of} channels ` +
  `(${((mask.on / mask.of) * 100).toFixed(1)}% of the crop)`
);
let weakest = Infinity;
console.log("\n  against each other, over the glass only");
for (let i = 0; i < FILMS.length; i++) {
  for (let j = i + 1; j < FILMS.length; j++) {
    const d = await diff(shots[FILMS[i]].path, shots[FILMS[j]].path, mask.m);
    weakest = Math.min(weakest, d.mean);
    console.log(
      `  ${FILMS[i]} vs ${FILMS[j]}`.padEnd(26) +
      `mean ${d.mean.toFixed(2).padStart(5)}   worst pixel ${String(d.max).padStart(3)}   ` +
      (d.mean >= FLOOR ? "ok" : "FAIL")
    );
  }
}
if (weakest < FLOOR) {
  console.log(
    `\n  the closest pair differs by ${weakest.toFixed(2)}, under the ${FLOOR} floor — ` +
    `two of these are the same film at two prices`
  );
  await b.close();
  process.exit(1);
}

await b.close();
