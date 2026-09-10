// The underpass, as it is actually driven.
//
//   npm run dev
//   node tools/shots/tunnel.mjs
//
// There has been a tunnel on the Second Ring since the world was built —
// 290 m of it, walls and ceiling lofted from TUNNEL_BOX, portal frames,
// strip lights, and acoustics that sound.ts derives from the same two
// numbers. What there has never been is a picture of it. Every other
// landmark in this game has a shot tool; the one place the sky goes away
// entirely did not, which is how a feature ends up half-finished without
// anybody deciding to leave it that way.
//
// Four stations through it, because a tunnel is a sequence rather than a
// place: the approach with the portal ahead, the mouth, the middle where
// there is no sky at all, and the exit looking back out.
//
// It also reports what the picture is DOING at each station — mean luma,
// how much of the frame is lit, and whether any sky is visible — so a
// tunnel that stops covering the road, or strip lights that stop
// arriving, fail here rather than waiting to be noticed.
import { chromium } from "playwright-core";
import { statSync, mkdirSync, writeFileSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => { try { return statSync(p).isFile(); } catch { return false; } });
if (!exe) { console.error("no chromium"); process.exit(2); }

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
         "--force-color-profile=srgb"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("text=START ENGINE", { timeout: 120000 });
await page.click("text=START ENGINE");
// Three attempts. The race scene boots a WebGL world on a software
// rasteriser and on a loaded machine it comes up perhaps one try in
// three; a tool that gives up after one is a tool nobody can run.
let up = false;
for (let a = 0; a < 3 && !up; a++) {
  try { await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 100000 }); up = true; }
  catch { console.log(`the world did not come up (attempt ${a + 1})`); }
}
if (!up) { console.error("never booted — nothing shot"); await browser.close(); process.exit(2); }
await page.evaluate(() => window.__grnEngine?.skipCinematic?.());
await page.waitForTimeout(800);

// LET THE CAMERA ARRIVE BEFORE THE FIRST SHUTTER.
//
// The chase camera lerps toward the car rather than being placed at it,
// and after skipCinematic it starts from wherever the cinematic left it
// — which is a long way off. The first station used to be shot 40
// frames later, two thirds of a second, and the camera was still on its
// way: the car came out a tenth of the size it is in every other shot
// and the "approach" plate showed a distant streetscape with no tunnel
// portal in it at all.
//
// That is worth spelling out because the plate was believable. It looked
// like a finding about the world — you cannot see the tunnel coming —
// and it was a finding about this file. Worse, the ceiling-band check at
// the bottom compares the middle against the approach, so a bogus
// approach made it pass more easily.
await page.evaluate(async () => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.player.s = 4790; e.player.lat = 0; e.player.speed = 0;
  for (let i = 0; i < 240; i++) e.update(1 / 60);
});

mkdirSync("press/tunnel", { recursive: true });
const fail = [];
const rows = [];
// LAP.tunnel is 4855..5145. Stations relative to the mouth.
const STATIONS = [
  ["approach", 4790, "the portal ahead, still under sky"],
  ["mouth", 4870, "just inside"],
  ["middle", 5000, "no sky at all"],
  ["exit", 5130, "the far mouth"],
];
for (const [name, s, what] of STATIONS) {
  const r = await page.evaluate(async (s) => {
    const e = window.__grnEngine;
    e.setPaused(true);
    e.applyQualityTier("high");
    e.timeReal = false; e.timeCycling = false;
    e.timeHours = 1.5; e.world.setTimeOfDay(1.5); e.applyDaylight();
    const park = () => {
      const away = e.track.wrap(s + e.track.length / 2);
      for (const t of e.traffic) t.s = away;
      if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
      e.player.s = s; e.player.lat = 0; e.player.speed = 0;
    };
    park();
    // 180, not 40. Long enough for the camera to close the distance from
    // the previous station as well — the stations are 60 to 130 m apart
    // and the chase lerp does not teleport either.
    for (let i = 0; i < 180; i++) { e.update(1 / 60); park(); }
    for (let i = 0; i < 4; i++) e.composer.render();
    const gl = e.renderer.domElement;
    const W = gl.clientWidth || 1280, H = gl.clientHeight || 720;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.drawImage(gl, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    let sum = 0, lit = 0, n = 0;
    // The top eighth of the frame: under open sky at night that band is
    // the sky, and inside a tunnel it is concrete a metre from the
    // camera. Their brightness is not the tell — the tell is that the
    // ceiling is LIT and the night sky is not.
    let topSum = 0, topN = 0, topBlue = 0, halfN = 0, halfBright = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        sum += l; n++;
        if (l > 40) lit++;
        if (y < H / 8) {
          topSum += l; topN++;
          // Blue minus red. This game's night sky is a saturated blue and
          // a concrete soffit is not, so this separates "there is sky up
          // there" from "there is a roof up there" in a way brightness
          // cannot — see the note by the checks.
          topBlue += d[i + 2] - d[i];
        }
        // The lamps are counted over the top HALF, not the top eighth.
        // The eighth is the sky/roof band and it was reused here without
        // checking, which reported 0% strip lights in a frame that has
        // eight of them in it: from ten metres back the ceiling fittings
        // sit around a quarter to two fifths of the way down the picture,
        // well below a band drawn to catch the sky.
        if (y < H / 2) { halfN++; if (l > 180) halfBright++; }
      }
    }
    return {
      mean: +(sum / n).toFixed(1),
      lit: +((lit / n) * 100).toFixed(1),
      top: +(topSum / topN).toFixed(1),
      blue: +(topBlue / topN).toFixed(1),
      lamps: +((halfBright / halfN) * 100).toFixed(2),
      // How far the camera is from the car it is supposed to be behind.
      // Reported so a shot taken mid-lerp can never again be read as a
      // statement about the world.
      camDist: +e.camera.position.distanceTo(e.playerMesh.position).toFixed(1),
      png: c.toDataURL("image/png").split(",")[1],
    };
  }, s);
  writeFileSync(`press/tunnel/${name}.png`, Buffer.from(r.png, "base64"));
  rows.push({ name, s, what, ...r });
  console.log(
    `${name.padEnd(9)} s=${String(s).padStart(4)}  mean ${String(r.mean).padStart(5)}  ` +
      `lit ${String(r.lit).padStart(5)}%  roof ${String(r.top).padStart(5)}  ` +
      `blue ${String(r.blue).padStart(6)}  lamps ${String(r.lamps).padStart(5)}%  ` +
      `cam ${String(r.camDist).padStart(5)} m   ${what}`
  );
  if (r.camDist > 25)
    fail.push(`${name}: the camera was ${r.camDist} m from the car — it had not finished moving, so this plate is not of the place it claims`);
}
await browser.close();

// INSIDE IS NOT OUTSIDE — BUT NOT BY BRIGHTNESS.
//
// The first version of these checks asserted that the roof band inside
// reads BRIGHTER than the sky band outside, and that the middle of the
// tunnel is a larger fraction lit than the approach. Both are false, and
// measuring them said so: this game's night sky sits around 57 in that
// band and its road is lit by lamps the whole way, so the approach comes
// out at 97 mean and 91% lit while a concrete soffit under strip lights
// comes out darker than the sky it replaces. A real tunnel is like that
// too — the ceiling is the dimmest surface in it.
//
// What is actually true is that the sky is GONE. This sky is a saturated
// blue and concrete is neutral, so blue-minus-red over the top of the
// frame separates the two cleanly however bright either happens to be.
// And the strip lights have to be in shot, which is what says the tunnel
// is lit at all rather than merely roofed.
const approach = rows.find((r) => r.name === "approach");
const middle = rows.find((r) => r.name === "middle");
if (!(middle.blue < approach.blue * 0.5))
  fail.push(
    `overhead in the tunnel still reads like sky: blue-minus-red ${middle.blue} ` +
      `against ${approach.blue} out under the open sky`
  );
if (!(middle.lamps > 0.5))
  fail.push(
    `no strip lights overhead in the middle of the tunnel — ` +
      `${middle.lamps}% of the upper half is above 180, so nothing up there is lit`
  );

if (fail.length) {
  console.error(`\n${fail.length} problem(s):\n`);
  for (const f of fail) console.error(`  ${f}`);
  process.exit(1);
}
console.log("\nthe roof is on and the lights are lit. press/tunnel/*.png");
