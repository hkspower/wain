// How much of the frame is crushed to black, in one number.
//
//   npm run dev
//   node tools/shots/blacks.mjs
//
// tools/shots/dark.mjs is the diagnosis: it tiles the frame, renders a
// lifted copy, and says of each dark tile whether the detail is there
// and being thrown away (CRUSHED), whether nothing is lit it (UNLIT), or
// whether nothing is there at all (EMPTY). It takes twenty minutes.
//
// This is the thermometer, not the diagnosis. One frame per viewpoint,
// no lifted copy, no tiling — just the shadow end of the histogram, so a
// change to the grade or the lighting can be measured in a minute
// instead of half an hour. It answers exactly one question: how much of
// the picture is sitting at or near zero, where no display and no eye
// can get anything back out of it.
//
// WHY THE FLOOR IS 2/255 AND NOT 0
//
// A pixel at 0 is black. A pixel at 1 or 2 is also black to every panel
// this will ever run on, and the difference between them is not
// something a player can see — so counting only exact zeros would report
// a picture as healthy while it is entirely made of 2s. The bands below
// are cumulative for the same reason: what matters is not the mode of
// the histogram but how much of the frame is below the point where
// detail stops existing.
//
// A NIGHT GAME IS SUPPOSED TO BE DARK. This prints numbers; it does not
// have an opinion about them. The sky at midnight belongs down there and
// so does the sea. Read it as a before-and-after against the same
// viewpoints, which is what it is for.

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium"].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium; set CHROME_PATH"); process.exit(2); }

const b = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await b.newPage({ viewport: { width: 960, height: 600 } });
page.setDefaultTimeout(180000);
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

// Fixed places along the road, so two runs compare the same picture.
// Chosen to include the parts of the night that are legitimately dark
// (the open corniche) and the parts that should not be (under the
// flyover, beside a lit building).
const ALL_STOPS = [
  ["open corniche", 400],
  ["city block", 3400],
  ["under the flyover", 2100],
  ["the roundabout", 5200],
];
// Each stop costs three hundred update()s to pose and then three shots
// of thirty renders each, and on the software rasteriser this runs on
// that is minutes. STOPS=2 keeps the two that can actually answer a
// question about the black end — the open coast, which is the darkest
// place in the game, and a city block, which is the one with both ends
// of the histogram in it.
const STOPS = ALL_STOPS.slice(0, Number(process.env.STOPS || ALL_STOPS.length));
/** Renders before each shot. Whatever converges in this chain needs more
 *  than a couple; 30 was enough and too slow to finish inside a sensible
 *  timeout on a software rasteriser, so it is a knob and the A-B-A
 *  control below is what says whether the value in use is sufficient. */
const SETTLE = Number(process.env.SETTLE || 14);

console.log("        pixels at or below, as a share of the frame");
console.log("        (exposure frozen per stop at whatever the night metered to)");
console.log("stop                      2/255    8/255   16/255   median   levels  plateau");

const rows = [];
for (const [label, s] of STOPS) {
  // Posed the way dark.mjs poses a viewpoint, and for its reasons.
  //
  // There is no warpTo on the debug surface — an earlier version of this
  // called one and it would have measured the same opening frame four
  // times and printed four numbers that looked like four viewpoints.
  // Traffic and the rival go to the far side of the lap because they
  // carry headlights, and where they happen to be wandering is not
  // repeatable: dark.mjs records five dark tiles on one run and forty on
  // the next from that alone.
  await page.evaluate((z) => {
    const e = window.__grnEngine;
    e.setPaused(false);
    const away = e.track.wrap(z + e.track.length / 2);
    for (let i = 0; i < 300; i++) {
      e.player.s = z;
      e.player.lat = 0;
      e.player.speed = 22;
      for (const t of e.traffic) t.s = away;
      if (e.rival) e.rival.s = away;
      e.update(1 / 60);
    }
    for (const t of e.traffic) t.s = away;
    if (e.rival) e.rival.s = away;
    e.player.s = z;
    e.setPaused(true);
  }, s);
  await page.waitForTimeout(900);
  // BOTH KNEES, ON THE SAME FRAME.
  //
  // The difference this is looking for is a few 8-bit levels at the
  // bottom of a night picture, which is far smaller than the difference
  // between two runs of the game — traffic elsewhere, a different bit of
  // road, the auto-exposure having settled somewhere else. Comparing two
  // sessions would be comparing noise. So the knee is toggled on the
  // live uniform and the same parked camera is photographed twice.
  // PIN THE EXPOSURE BEFORE COMPARING ANYTHING.
  //
  // Auto-exposure is a feedback loop over the rendered frame, so changing
  // the black point changes what it meters, which changes the exposure,
  // which changes the frame. Photographed a few renders apart, two knees
  // are also two different exposures partway through adapting — and the
  // first version of this A/B did exactly that and produced a swing far
  // too large for the knee to be responsible for.
  // PINNED TO THE NIGHT'S OWN EXPOSURE, not to zero on the slider.
  //
  // setExposure(0, false) does not mean "leave it where it is". It means
  // uManual = 1.15, the hand-set figure the game shipped with before it
  // had auto-exposure — which is a great deal brighter than an adapted
  // midnight. Pinned there the frame had 0.0% of itself below 8/255 at
  // every stop, i.e. nothing anywhere near the black point, and the knee
  // measured as doing nothing because there was nothing down there for it
  // to do. That is a true measurement of the wrong picture.
  //
  // So the loop is allowed to settle on the real thing, read back, and
  // then frozen at what it found.
  const held = await page.evaluate(async () => {
    const e = window.__grnEngine;
    for (let i = 0; i < 40; i++) e.composer.render();
    const { exposure } = await e.sampleExposure();
    const u = e.autoExp.exposureMat.uniforms;
    u.uAuto.value = 0;
    u.uBias.value = 0;
    u.uManual.value = exposure;
    return +exposure.toFixed(4);
  });
  await page.waitForTimeout(200);
  // A, B, then A again. If the two clip shots do not agree the comparison
  // is measuring drift and nothing it says about the knee is worth
  // reading — so the tool says so rather than averaging over it.
  const shots = {};
  for (const [name, soft] of [["clip", 0], ["knee", 1], ["clip2", 0]]) {
    await page.evaluate((v) => {
      const e = window.__grnEngine;
      e.grainPass.uniforms.uSoftBlack.value = v.v;
      // THIRTY, not three. Something in this chain converges over
      // successive renders rather than settling in one — the first A-B-A
      // came back 64, 66, 74 on the same stop, monotonically climbing,
      // which is an accumulation and not a knee. Three renders
      // photographed it partway up and handed the difference to whatever
      // change happened to be under test.
      for (let i = 0; i < v.n; i++) e.composer.render();
    }, { v: soft, n: SETTLE });
    await page.waitForTimeout(140);
    shots[name] = (await page.screenshot({ type: "png" })).toString("base64");
  }
  // Leave it where the game ships.
  await page.evaluate(() => {
    const e = window.__grnEngine;
    e.grainPass.uniforms.uSoftBlack.value = 1;
    for (let i = 0; i < 2; i++) e.composer.render();
  });
  const shot = Buffer.from(shots.knee, "base64");
  const measure = async (b64) => page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const hist = new Uint32Array(256);
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      // Rec.709 luma on the DISPLAYED pixels: this is about what reaches
      // the eye, not about scene-referred light.
      const y = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      hist[y]++; n++;
    }
    const under = (t) => { let s2 = 0; for (let v = 0; v <= t; v++) s2 += hist[v]; return s2 / n; };
    let acc = 0, med = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n / 2) { med = v; break; } }
    // ---- the GRADIENT at the black end, as opposed to the amount of it -
    //
    // "How much is crushed" and "does the dark roll smoothly" are two
    // different questions and this file only ever asked the first. A
    // picture can have a perfectly reasonable 8% below 8/255 and still
    // look terraced, because what the eye objects to is not the depth of
    // the shadows but a hard edge running through them where a whole
    // region shares one level.
    //
    //   levels   how many of the bottom twenty-one 8-bit steps are used
    //            at all. A smooth roll-off populates most of them; a
    //            clipped one uses a handful.
    //   plateau  the largest share any SINGLE level holds down there, and
    //            which level it is. This is the clip's own signature: a
    //            hard black point puts every pixel below it on one step,
    //            so it shows up as one bar holding a big fraction of the
    //            frame with empty steps beneath it.
    const LOW = 20;
    let levels = 0, plateau = 0, plateauAt = 0;
    for (let v = 0; v <= LOW; v++) {
      if (hist[v] > 0) levels++;
      if (hist[v] > plateau) { plateau = hist[v]; plateauAt = v; }
    }
    return {
      p2: under(2), p8: under(8), p16: under(16), med,
      levels, plateau: plateau / n, plateauAt,
    };
  }, b64);
  const clip = await measure(shots.clip);
  const stats = await measure(shots.knee);
  const clip2 = await measure(shots.clip2);
  rows.push([label, stats, clip, clip2]);
  const line = (tag, x) =>
    `${tag.padEnd(22)} ${(x.p2 * 100).toFixed(1).padStart(6)}% ` +
    `${(x.p8 * 100).toFixed(1).padStart(7)}% ${(x.p16 * 100).toFixed(1).padStart(7)}% ` +
    `${String(x.med).padStart(8)} ${String(x.levels).padStart(8)} ` +
    `${(x.plateau * 100).toFixed(1).padStart(8)}% @${String(x.plateauAt).padStart(3)}`;
  console.log(`${label}  — exposure held at ${held}`);
  console.log(line("", clip) + "   clip");
  console.log(line("", stats) + "   knee");
  console.log(line("", clip2) + "   clip again");
}
const mean = (k) => rows.reduce((a, [, s]) => a + s[k], 0) / rows.length;
const meanClip = (k) => rows.reduce((a, [, , c]) => a + c[k], 0) / rows.length;
console.log(
  `\nacross ${rows.length} stops: ${(mean("p2") * 100).toFixed(1)}% of the picture is at or below 2/255, ` +
  `${(mean("p8") * 100).toFixed(1)}% at or below 8/255`
);
console.log(
  `the bottom of the picture: ${meanClip("levels").toFixed(1)} of 21 levels used with the clip, ` +
  `${mean("levels").toFixed(1)} with the knee; ` +
  `biggest single level ${(meanClip("plateau") * 100).toFixed(1)}% -> ${(mean("plateau") * 100).toFixed(1)}%`
);
// THE CONTROL IS READ FIRST, because if it fails nothing below means
// anything. The two clip shots are the same settings on the same parked
// camera; whatever separates them is what this rig cannot hold still,
// and no claim about the knee is allowed to be smaller than that.
const drift = rows.map(([label, , c1, c2]) => ({
  label,
  med: Math.abs(c1.med - c2.med),
  p8: Math.abs(c1.p8 - c2.p8),
}));
const worstDrift = drift.reduce((a, b) => (a.med > b.med ? a : b));
console.log(
  `control: the same settings twice moved the median by at most ` +
  `${worstDrift.med} level(s) (${worstDrift.label}), and p8 by ` +
  `${(Math.max(...drift.map((d) => d.p8)) * 100).toFixed(1)} points`
);
const fail = [];
if (worstDrift.med > 2)
  fail.push(
    `the rig is not holding still: two identical shots differ by ${worstDrift.med} levels of median ` +
      `at ${worstDrift.label}, so the knee comparison above is measuring drift`
  );
if (!(mean("levels") >= meanClip("levels")))
  fail.push(`the knee uses ${mean("levels").toFixed(1)} of the bottom levels against the clip's ${meanClip("levels").toFixed(1)} — it is meant to use more`);
if (!(mean("plateau") <= meanClip("plateau")))
  fail.push(`the knee's biggest single dark level holds ${(mean("plateau") * 100).toFixed(1)}% against the clip's ${(meanClip("plateau") * 100).toFixed(1)}% — the terrace has not gone`);
// And it must not have made the picture milky, which is the failure mode
// the hard clip was there to prevent.
if (mean("p2") > meanClip("p2") + 0.02)
  fail.push(`the knee lifted the floor: ${(mean("p2") * 100).toFixed(1)}% at or below 2/255 against ${(meanClip("p2") * 100).toFixed(1)}%`);
if (fail.length) { console.error(`\n${fail.length} problem(s):`); for (const f of fail) console.error(`  ${f}`); }
else console.log("\nthe dark rolls off instead of stopping.");
await b.close();
