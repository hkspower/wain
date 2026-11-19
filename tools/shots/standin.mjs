// The game's own night pictures of one car, the stand-ins Unreal's renders are compared with.
//
//   npm run dev
//   npm run shots:standin                         # the coast frame, black-demon, into its stand-in folder
//   CAR=black-demon OUT=/tmp/coast.jpg node tools/shots/standin.mjs
//   node tools/shots/standin.mjs --from press/ik/4k/brake.png press/unreal/black-demon/stand-in/web-night-city.jpg
//
// press/unreal/<car>/stand-in/ holds two pictures made by the running game
// (the rest of that folder is Cycles; see unreal/Showcase/README.md):
//
//   web-night-coast.jpg   the game's own chase camera, parked at the coast
//                         station (1300 m, the "coast" of tools/shots/capture.mjs)
//                         at 02:30, the car in its factory paint, traffic and
//                         the rival sent to the far side of the lap, the
//                         canvas read directly so no HUD is in the picture.
//                         That is what THIS tool makes.
//   web-night-city.jpg    ik4k.mjs's "brake" stage (a rear three-quarter in a
//                         200 km/h stop), a 3840x2160 frame brought down to
//                         2000x1125. The 4K frame is ik4k's; the bringing
//                         down is `--from`, above, so both pictures leave
//                         the same way:
//
//       CAR=black-demon PAINT=factory SHOTS=brake CLEAR_ROAD=1 OUT=/tmp/ik4k node tools/shots/ik4k.mjs
//       node tools/shots/standin.mjs --from /tmp/ik4k/brake.png <stand-in folder>/web-night-city.jpg
//
//                         (ik4k's OUT must be set, or it overwrites the tracked
//                         press/ik/4k stills; CLEAR_ROAD=1 empties the road of
//                         civilians, which its brake stage otherwise leaves.
//                         On this container's software GL the whole run is
//                         about ten minutes: 270 s to boot, 240 s for the
//                         authored parts to land, 110 s for the 4K frame.)
//
// Environment (all optional):
//   CAR       the car id (black-demon)
//   PAINT     a garage paint id; paint-white is "nothing bought", which is
//             a car's factory colour (paint-white)
//   STATION   metres along the lap (1300)
//   HOUR      hour of the night, 0-24 (2.5)
//   TIER      the game's quality tier (high)
//   W, H      the canvas, which is also the picture (2000, 1125)
//   BASE      where the game is served (http://localhost:3000)
//   OUT       where the JPEG goes (press/unreal/<CAR>/stand-in/web-night-coast.jpg)
//   CHROME_PATH  a Chromium; the usual places are tried otherwise
//
// The authored shells and wheels are fetched after the car is built, and a
// frame taken before they land is a picture of the procedural stand-in
// instead of the car; this waits for both and says so if they do not come.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import sharp from "sharp";

/** The way every stand-in leaves: 2000x1125, mozjpeg quality 88. */
const encode = (input, out) =>
  sharp(input).resize(2000, 1125).jpeg({ quality: 88, mozjpeg: true }).toFile(out);

const args = process.argv.slice(2);
const from = args.indexOf("--from");
if (from >= 0) {
  const [src, out] = [args[from + 1], args[from + 2]];
  if (!src || !out) {
    console.error("usage: node tools/shots/standin.mjs --from <png> <out.jpg>");
    process.exit(2);
  }
  mkdirSync(dirname(out), { recursive: true });
  const info = await encode(src, out);
  console.log(`${src} -> ${out}  ${info.width}x${info.height}, ${(info.size / 1024).toFixed(0)} kB`);
  process.exit(0);
}

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

const CAR = process.env.CAR ?? "black-demon";
const PAINT = process.env.PAINT === "factory" || !process.env.PAINT ? "paint-white" : process.env.PAINT;
const STATION = Number(process.env.STATION ?? 1300);
const HOUR = Number(process.env.HOUR ?? 2.5);
const TIER = process.env.TIER ?? "high";
const W = Number(process.env.W ?? 2000);
const H = Number(process.env.H ?? 1125);
const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? `press/unreal/${CAR}/stand-in/web-night-coast.jpg`;

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`${BASE}/race`, { waitUntil: "domcontentloaded" });
await page.evaluate(({ car, paint }) => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
  localStorage.setItem(
    "gulf-road-nights-garage",
    JSON.stringify({ car, cars: [car], owned: [], kd: 99999, equipped: { paint, glow: "glow-none" } })
  );
}, { car: CAR, paint: PAINT });
await page.reload({ waitUntil: "domcontentloaded" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });

await page.evaluate(({ tier, hour }) => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.applyGarage();
  e.applyQualityTier(tier);
  e.timeReal = false;
  e.timeCycling = false;
  e.timeHours = hour;
  e.world.setTimeOfDay(hour);
  e.applyDaylight();
}, { tier: TIER, hour: HOUR });

// Every shell slot decided and every authored tyre in, or say so. Polled
// from here, with the counts in hand, so a timeout says what was missing.
const authoredState = () =>
  page.evaluate(() => {
    const e = window.__grnEngine;
    let shells = 0, authored = 0, tyres = 0, tyresAuthored = 0;
    e.carBody.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.shell) { shells++; if (o.geometry.userData.authored) authored++; }
      if (o.userData.wheelPart === "tire" && (o.parent?.userData.spokes ?? 0) > 0) {
        tyres++;
        if (o.geometry.userData.authored) tyresAuthored++;
      }
    });
    return { shells, authored, tyres, tyresAuthored };
  });
const WAIT_S = Number(process.env.WAIT_S ?? 300);
const landed = (s) => s.shells > 0 && s.authored === s.shells && s.tyresAuthored === s.tyres;
const t0 = Date.now();
let state = await authoredState();
while (!landed(state) && Date.now() - t0 < WAIT_S * 1000) {
  await page.waitForTimeout(2000);
  state = await authoredState();
}
console.log(
  landed(state)
    ? `authored shells and tyres in after ${((Date.now() - t0) / 1000).toFixed(0)} s (${JSON.stringify(state)})`
    : `(authored shells or tyres did not all arrive in ${WAIT_S} s: ${JSON.stringify(state)}; rendering what is there)`
);

const info = await page.evaluate(async ({ at }) => {
  const e = window.__grnEngine;
  // Everything else on the road goes to the other side of the lap.
  const far = () => {
    const f = e.track.wrap(at + e.track.length / 2);
    for (const t of e.traffic) t.s = f;
    if (e.rival) { e.rival.s = f; e.rival.speed = 0; }
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < 40; i++) {
      e.update(1 / 60);
      far();
      e.player.s = at;
      e.player.lat = 0;
      e.player.speed = 0;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  e.composer.render();
  return { png: e.renderer.domElement.toDataURL("image/png"), w: e.renderer.domElement.width, h: e.renderer.domElement.height };
}, { at: STATION });
console.log(`canvas ${info.w}x${info.h}, ${CAR} at ${STATION} m, ${HOUR} h, tier ${TIER}`);
mkdirSync(dirname(OUT), { recursive: true });
const out = await encode(Buffer.from(info.png.split(",")[1], "base64"), OUT);
console.log(`wrote ${OUT}  ${out.width}x${out.height}, ${(out.size / 1024).toFixed(0)} kB`);
await browser.close();
