// Where is the picture too dark to read?
//
//   npm run dev
//   node tools/shots/dark.mjs            # the whole sweep
//   node tools/shots/dark.mjs --no-shots # numbers only
//
// This is a night game, so "dark" is not a fault — the sky is supposed
// to be dark, the sea is supposed to be dark, and a game that lifts them
// has stopped being set at midnight. The fault is a region that is dark
// AND has something in it, which a player experiences as a hole in the
// world: a wall they cannot see, a kerb they hit, a car with no shape.
//
// So the test is not "how dark is this tile". It is:
//
//   Is there anything in this tile that a stop and a half of exposure
//   would reveal, that the player cannot see now?
//
// Two frames per viewpoint answer that. One at the exposure the game
// actually shows, one lifted. Then per tile:
//
//   CRUSHED — near black now, structure when lifted. The detail is
//             being rendered and thrown away by the display transform.
//             The fix is grading.
//   UNLIT   — near black in both. Nothing is reaching it at all. The
//             fix is a light, an emissive, or a material.
//   EMPTY   — near black in both, and nothing but sky is there. Not a
//             fault. Decided by re-rendering with every mesh hidden and
//             asking which pixels did not change, rather than by a depth
//             buffer: the depth is long gone by the time a frame has
//             been through the post chain, and this needs no readback.
//
// Distinguishing those three matters, because the fixes are opposite: a
// grade that rescues a crushed tile does nothing for an unlit one, and
// lighting an empty tile means lighting the night sky.
//
// But do not read CRUSHED as "therefore grade it". The verdict says what
// the tile CAN be rescued by, not what it SHOULD be. The road under the
// flyovers came back crushed on every run — a stop and a half brought
// the soffit and the asphalt straight back, so the detail was genuinely
// being rendered — and the right fix was still a light, because the
// reason the picture was down there in the first place was that a real
// underpass has luminaires and this one had none. Grading it up instead
// would have lifted the whole frame to rescue one part of it.
//
// Read CRUSHED as "there is something here". Then go and find out why it
// is dark, which is a question about the world and not about the curve.
//
// The lifted frame is taken with auto-exposure FROZEN. The metering is a
// GPU feedback loop that closes around whatever it is shown, so an
// unfrozen "lifted" frame simply re-meters back to the same picture and
// the comparison measures nothing at all.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

const WRITE = !process.argv.includes("--no-shots");

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });
await page.waitForTimeout(4000);

const result = await page.evaluate(async ([write]) => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  e.setPaused(true);
  e.applyQualityTier("high");

  // Bloom off. It spreads every bright pixel across a wide radius, which
  // is exactly the thing that would fill a dark tile with light that is
  // not in the scene — and then remove it again when the exposure moves.
  const bloomWas = e.bloomPass.enabled;
  e.bloomPass.enabled = false;

  const cam = e.camera;
  const saved = {
    pos: cam.position.clone(), quat: cam.quaternion.clone(),
    up: cam.up.clone(), fov: cam.fov,
  };

  const grab = () => {
    e.exposurePass.dt = 0; // freeze the eye — see the header
    for (let i = 0; i < 6; i++) e.composer.render();
    const gl = e.renderer.domElement;
    const c = document.createElement("canvas");
    c.width = gl.width; c.height = gl.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(gl, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    ctx.putImageData(img, 0, 0);
    return { canvas: c, w: c.width, h: c.height, data: img.data };
  };

  // Rec.709 luma on the DISPLAYED pixel — what the player's eye gets,
  // not what the renderer thought it was making.
  const luma = (d, i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;

  /** Is there geometry here at all, or is it sky? */
  const skyMask = () => {
    // Rendered by hiding everything the scene draws EXCEPT the sky, and
    // asking which pixels are unchanged. Cheaper and more honest than
    // reading a depth buffer back through a post chain that has already
    // resolved it.
    const hidden = [];
    e.scene.traverse((o) => {
      if (o === e.scene) return;
      if (o.userData?.isSky || o.name === "sky") return;
      if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
        if (o.visible) { hidden.push(o); o.visible = false; }
      }
    });
    const bare = grab();
    for (const o of hidden) o.visible = true;
    return bare;
  };

  const COLS = 16, ROWS = 10;
  /**
   * The level below which a player reads a pixel as "black", not "dark".
   *
   * It was 3/255 — the literal bottom of the range — and every tile in
   * every scan came back readable, which is TRUE and is the answer to a
   * question nobody asked. The grade already puts a floor two 8-bit
   * steps up (uLift in grade.ts, deliberately), so nothing in this game
   * ever sits at 3/255 and a test pinned there can only ever pass.
   *
   * A screen in a lit room shows nothing below about 4% of white — the
   * room's own light on the glass is brighter than the panel's output
   * there. 10/255 is that, and it is the level at which "dark" becomes
   * "a hole in the picture".
   */
  const FLOOR = 10 / 255;
  /** Structure: the spread of luma inside one tile. Below this the tile
   *  is one flat colour, and there is nothing in it to see. */
  const FLAT = 0.012;

  /**
   * Let the eye adapt to this viewpoint, then hold it there.
   *
   * This has to be done by RENDERING, and that is the thing that was
   * wrong for four rounds of tuning. Auto-exposure meters the rendered
   * frame on the GPU and advances by exposurePass.dt — and e.update()
   * does not render. With the game paused and frames driven by hand,
   * every render in this tool went through grab(), which pins dt to
   * zero so the two frames of a comparison share one eye. So the eye
   * never adapted at all: it stayed wherever the page's own animation
   * loop had left it before the tool took over, which is why the
   * headlights-off scan flapped between five dark tiles and forty on
   * identical code, and why making the settle four times longer changed
   * nothing. Running the clock is not the same as running the eye.
   */
  const settleEye = () => {
    e.exposurePass.dt = 1 / 30;
    for (let i = 0; i < 110; i++) {
      e.composer.render();
      e.exposurePass.dt = 1 / 30;
    }
  };

  const shots = {};
  const scan = (label) => {
    settleEye();
    const shown = grab();
    // A stop and a half up, metering frozen so the loop cannot undo it.
    e.setExposure(1.5, false);
    const lifted = grab();
    e.setExposure(0, true);
    const bare = skyMask();

    const tiles = [];
    const tw = Math.floor(shown.w / COLS), th = Math.floor(shown.h / ROWS);
    for (let ry = 0; ry < ROWS; ry++) {
      for (let rx = 0; rx < COLS; rx++) {
        let sum = 0, n = 0, dark = 0;
        let lMin = 1, lMax = 0, lSum = 0;
        let sky = 0;
        for (let y = ry * th; y < (ry + 1) * th; y += 2) {
          for (let x = rx * tw; x < (rx + 1) * tw; x += 2) {
            const i = (y * shown.w + x) * 4;
            const a = luma(shown.data, i);
            sum += a; n++;
            if (a <= FLOOR) dark++;
            const b = luma(lifted.data, i);
            lSum += b;
            if (b < lMin) lMin = b;
            if (b > lMax) lMax = b;
            // Unchanged when everything is hidden => nothing but sky.
            const c0 = bare.data[i], c1 = bare.data[i + 1], c2 = bare.data[i + 2];
            const s0 = shown.data[i], s1 = shown.data[i + 1], s2 = shown.data[i + 2];
            if (Math.abs(c0 - s0) + Math.abs(c1 - s1) + Math.abs(c2 - s2) <= 6) sky++;
          }
        }
        const mean = sum / n;
        const darkFrac = dark / n;
        const skyFrac = sky / n;
        const spread = lMax - lMin;
        let verdict = "ok";
        if (darkFrac > 0.75) {
          if (skyFrac > 0.8) verdict = "empty";
          else if (spread > FLAT) verdict = "crushed";
          else verdict = "unlit";
        }
        tiles.push({
          rx, ry, mean: +mean.toFixed(4), darkFrac: +darkFrac.toFixed(3),
          skyFrac: +skyFrac.toFixed(2), lifted: +(lSum / n).toFixed(4),
          spread: +spread.toFixed(4), verdict,
        });
      }
    }
    if (write) shots[label] = shown.canvas.toDataURL("image/png");
    return { label, tiles, w: shown.w, h: shown.h };
  };

  // ---- The viewpoints.
  //
  // Chosen as the places a player actually spends the night: the lit
  // corniche, the unlit inland leg, a tunnel/underpass if there is one,
  // and the moment a rival pulls alongside. A sweep of pretty angles
  // would measure the screenshots rather than the game.
  //
  // The settle is 360 frames — six seconds — and that number is the
  // whole difference between a measurement and a coincidence. Ninety
  // frames is what this had first, and the eye does not converge in
  // ninety frames: adaptation upward runs at 0.7 per second by design
  // (uRates in grade.ts, slow on purpose so a tunnel mouth does not
  // strobe), so a frame taken after 1.5 s is still carrying the
  // exposure of wherever the car was BEFORE. It showed: inserting one
  // extra viewpoint ahead of the headlights-off scan moved that scan
  // from zero dark tiles to eleven, with nothing about the scene
  // changed. A test whose answer depends on what was measured before it
  // is not measuring the game.
  // The car is held in place while the eye settles. It is not enough to
  // run the clock: at 22 m/s a six-second settle drives the car 132 m
  // down the road, so every "the same viewpoint, adapted" frame was
  // actually a different piece of road — and the tool reported changes
  // that were the map moving, not the lighting.
  // Held in place, but still DRIVING. Two separate things had to be got
  // right here and each one was wrong first:
  //
  //   Running the clock without pinning drove the car 132 m down the
  //   road while the eye settled, so "the same viewpoint, adapted" was
  //   a different piece of road every time.
  //
  //   Pinning it with speed 0 parked the car, and a parked car is not
  //   the game: the frame came back with no headlight beam on the road
  //   ahead at all. Speed feeds more of this engine than position does.
  //
  // So: the speed the game runs at, the position held constant.
  //
  // 1200 frames — twenty seconds. Six was not enough and the way that
  // showed is worth recording: the headlights-off scan, which is the
  // darkest of the five and follows the brightest, came back with five
  // dark tiles on one run and thirty-nine on the next with nothing
  // between them but a change 220 m away that could not reach it.
  // Adaptation DOWNWARD is fast by design and adaptation upward is
  // slow — 2.2 against 0.7 per second, so a tunnel mouth does not
  // strobe — and a scan that goes from a lit underpass to an unlit road
  // is asking for the slow direction. Twenty seconds converges it, and
  // the same run repeated gives the same numbers.
  //
  // Traffic and the rival are pushed to the far side of the lap. They
  // carry headlights, and where they happen to be is not repeatable: the
  // headlights-off scan came back with five dark tiles on one run and
  // forty on the next, from the same code, because on one of them a
  // traffic car was close enough to light the road the player's own
  // beams were switched off from. A measurement that depends on where
  // the traffic wandered is not a measurement.
  const at = (s, lat, cameraTweak) => {
    const away = e.track.wrap(s + e.track.length / 2);
    for (let i = 0; i < 300; i++) {
      e.player.s = s;
      e.player.lat = lat;
      e.player.speed = 22;
      for (const t of e.traffic) t.s = away;
      if (e.rival) e.rival.s = away;
      e.update(1 / 60);
    }
    for (const t of e.traffic) t.s = away;
    if (e.rival) e.rival.s = away;
    e.player.s = s;
    e.player.lat = lat;
    if (cameraTweak) cameraTweak();
  };

  const scans = [];
  e.timeHours = 0.5;
  e.world.setTimeOfDay(0.5);
  e.applyDaylight();

  at(587, 0);
  scans.push(scan("corniche"));

  at(2400, 0);
  scans.push(scan("inland"));

  at(4200, -3);
  scans.push(scan("far-side"));

  // Under a flyover. Street poles are suppressed for 30 m either side of
  // one — a column is 8.4 m tall and a deck soffit is at 6.4, so a pole
  // there would grow through the bridge — which leaves a 60 m stretch of
  // carriageway, five times a lap, lit by nothing at all.
  at(640, 0);
  scans.push(scan("under-flyover"));

  // Headlights off: what the world looks like when the car is not
  // lighting it. Half the night is spent looking past your own beams.
  // Headlights off, through headlightBase rather than through the
  // light's own intensity: applyDaylight recomputes intensity from the
  // base every frame, so zeroing the intensity is undone by the next
  // update and this scan came back byte-identical to the one above it.
  // ...and applyDaylight has to be re-run, because that is what turns
  // the base into an intensity. Setting the base alone changed nothing
  // until the next time of day was applied, and this scan came back
  // byte-identical to the one above it twice before that was noticed.
  const hlWas = e.headlightBase;
  e.headlightBase = 0;
  e.applyDaylight();
  at(2400, 0);
  // Report what the beams ACTUALLY came out at, rather than trusting
  // that setting the base turned them off. This scan claimed to be the
  // headlights-off case through three rounds of tuning while returning
  // numbers identical to the scan above it, and an identical answer is
  // the one result a different condition should never give. If this
  // prints anything but 0 the scan is not measuring what it says.
  const beamsNow = e.headlight.intensity;
  const sc = scan("inland-no-beams");
  sc.note = `headlight intensity ${beamsNow.toFixed(2)}` +
    (beamsNow > 0.01 ? "  <-- NOT OFF, this scan is invalid" : "");
  scans.push(sc);
  e.headlightBase = hlWas;
  e.applyDaylight();

  cam.position.copy(saved.pos);
  cam.quaternion.copy(saved.quat);
  cam.up.copy(saved.up);
  cam.fov = saved.fov;
  cam.updateProjectionMatrix();
  e.bloomPass.enabled = bloomWas;
  e.setPaused(false);
  return { scans, shots };
}, [WRITE]);

if (WRITE) {
  mkdirSync("press/dark", { recursive: true });
  for (const [k, v] of Object.entries(result.shots)) {
    writeFileSync(`press/dark/${k}.png`, Buffer.from(v.split(",")[1], "base64"));
  }
}

let bad = 0;
for (const s of result.scans) {
  const counts = { ok: 0, empty: 0, crushed: 0, unlit: 0 };
  for (const t of s.tiles) counts[t.verdict]++;
  console.log(
    `\n${s.label.padEnd(18)} ${s.tiles.length} tiles: ` +
    `${counts.ok} readable, ${counts.empty} sky, ` +
    `${counts.crushed} CRUSHED, ${counts.unlit} UNLIT`
  );
  // A picture of the verdict, laid out the way the frame is.
  const g = { ok: ".", empty: " ", crushed: "c", unlit: "U" };
  for (let ry = 0; ry < 10; ry++) {
    let line = "  ";
    for (let rx = 0; rx < 16; rx++) {
      line += g[s.tiles[ry * 16 + rx].verdict];
    }
    console.log(line);
  }
  if (s.note) console.log(`    ${s.note}`);
  const means = s.tiles.map((t) => t.mean).sort((a, b) => a - b);
  const pct = (q) => means[Math.min(means.length - 1, Math.floor(q * means.length))];
  console.log(
    `    tile luma  p10 ${pct(0.1).toFixed(3)}  median ${pct(0.5).toFixed(3)}` +
    `  p90 ${pct(0.9).toFixed(3)}  darkest ${means[0].toFixed(4)}`
  );
  const worst = s.tiles
    .slice()
    .sort((a, b) => a.mean - b.mean)
    .slice(0, 5);
  for (const t of worst) {
    console.log(
      `    (${t.rx},${t.ry}) ${t.verdict.padEnd(8)} mean ${t.mean.toFixed(4)}` +
      ` -> ${t.lifted.toFixed(4)} lifted, ${Math.round(t.darkFrac * 100)}% at the floor,` +
      ` spread ${t.spread.toFixed(4)}`
    );
  }
  bad += counts.crushed + counts.unlit;
}

console.log(
  bad
    ? `\n${bad} tile(s) are too dark to read. "c" is recoverable by grading; "U" needs light.`
    : "\nnothing in the frame is too dark to read"
);
await browser.close();
process.exit(bad ? 1 : 0);
