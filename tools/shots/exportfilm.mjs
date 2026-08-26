// Export the pre-race film as a video file.
//
//   npm run dev
//   node tools/shots/exportfilm.mjs [--fps 30] [--width 1280] [--out press/film/intro.mp4]
//
// Not a screen recording. A screen recording of this would be a
// recording of THIS MACHINE, which renders the scene in software at
// roughly a frame a second — fourteen seconds of film would take a
// quarter of an hour and play back as a slideshow.
//
// So the film is rendered the way a film is rendered: its clock is
// driven to each frame's timestamp in turn, that frame is drawn and
// read back, and the sequence is encoded at the frame rate it was
// authored for. Wall time stops mattering. The output is a true 24 fps
// video of a 14 s film whether the machine took two minutes or twenty
// to draw it.
//
// EVERY FRAME IS SYNCHRONOUS, and the reason is measured rather than
// stylistic. Profiled on this machine, per frame:
//
//   update + render        2.6 s
//   waiting on one rAF     5.8 s   (the engine's own loop, doing it again)
//   drawImage to a 2D canvas  27 s (a GPU readback, the whole cost)
//   toDataURL png          26 s
//   toDataURL jpeg          9 s    (same readback, cheap encode)
//
// So the loop pauses the engine and calls update and render itself,
// which removes the duplicated frame, and reads back as JPEG, which is
// the only readback on offer that is not catastrophic. The intermediate
// is re-encoded to H.264 anyway, so a quality-95 JPEG costs nothing
// visible and turns a two-and-a-half hour render into fifty minutes.
//
// FFMPEG IS NOT VENDORED. A static build is 70 MB and does not belong
// in a game repository. This looks for one in three places, in order:
// $FFMPEG, anything on PATH, then an `ffmpeg-static` package if some
// other tool has already installed one. If none is found it says how to
// get one and writes the frames out anyway, so the render is never
// wasted on a missing encoder.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const FPS = Number(arg("fps", 24));
const WIDTH = Number(arg("width", 1280));
const HEIGHT = Math.round((WIDTH * 9) / 16);
const OUT = arg("out", "press/film/intro.mp4");
const FRAMEDIR = arg("frames", "press/film/frames");

/** Where to find an encoder, in order of preference. */
function findFfmpeg() {
  if (process.env.FFMPEG && existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  try {
    return execFileSync("which", ["ffmpeg"], { encoding: "utf8" }).trim() || null;
  } catch {}
  try {
    const require = createRequire(import.meta.url);
    const p = require("ffmpeg-static");
    if (p && existsSync(p)) return p;
  } catch {}
  // Also honour one installed beside a scratch dir by an earlier run.
  for (const guess of (process.env.FFMPEG_SEARCH ?? "").split(":").filter(Boolean)) {
    if (existsSync(guess)) return guess;
  }
  return null;
}

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.click("text=START ENGINE");
let up = false;
for (let i = 0; i < 600 && !up; i++) {
  up = await page.evaluate(() => !!window.__grnDebug);
  if (!up) await page.waitForTimeout(1000);
}
if (!up) { console.error("game never booted"); process.exit(2); }
await page.waitForTimeout(1500);
await page.evaluate(() => window.__grnEngine?.skipCinematic?.());
await page.waitForTimeout(800);

// Start the film once and drive it by hand. No clock pin and no stubbed
// ending here, unlike tools/shots/introfilm.mjs: both of those exist to
// survive frames that arrive whenever they like, and this loop never
// waits for a frame at all — it sets the clock and renders in the same
// synchronous breath, so nothing can go stale between them.
const setup = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const r = e.rival;
  if (!r) return { error: "no rival on the road" };
  e.setTimeOfDay?.(1.5);
  e.player.speed = 34;
  r.state = "cruise";
  r.speed = 34;
  r.s = e.track.wrap(e.player.s + 20);
  e.beginBattleCinematic(r);
  await new Promise((res) => requestAnimationFrame(res));
  if (!e.cine) return { error: "the film did not start" };
  // The engine's own loop would render a second, unwanted frame for
  // every one of ours — 5.8 s of the 9 s each frame costs.
  e.setPaused(true);
  return { len: e.cineLength };
});
if (setup.error) { console.error(setup.error); await browser.close(); process.exit(2); }
const LEN = setup.len;
if (!LEN) { console.error("the engine does not publish cineLength"); await browser.close(); process.exit(2); }

const total = Math.round((LEN ?? 14.0) * FPS);
console.log(
  `rendering    ${LEN ?? 14.0} s at ${FPS} fps = ${total} frames, ${WIDTH}x${HEIGHT}`
);

rmSync(FRAMEDIR, { recursive: true, force: true });
mkdirSync(FRAMEDIR, { recursive: true });

const t0 = Date.now();
let lastBytes = -1;
let identical = 0;
for (let i = 0; i < total; i++) {
  const at = i / FPS;
  const jpg = await page.evaluate(async (sec) => {
    const e = window.__grnEngine;
    if (!e.cine) return null;
    // Clock, world, picture, readback — one synchronous run, so the
    // camera is solved for exactly this instant and nothing eases past
    // it while a frame is awaited.
    e.cine.start = performance.now() - sec * 1000;
    e.update(1 / 24);
    e.composer.render();
    return e.renderer.domElement.toDataURL("image/jpeg", 0.95);
  }, at);
  if (!jpg) { console.error(`frame ${i} at ${at.toFixed(2)} s: the film ended early`); break; }
  // Two identical frames in a row means the render is not advancing —
  // a paused engine that has stopped solving, or a clock that is not
  // moving. Better to say so than to encode a still image and call it
  // a film.
  if (jpg.length === lastBytes) identical++;
  lastBytes = jpg.length;
  writeFileSync(
    `${FRAMEDIR}/f${String(i).padStart(5, "0")}.jpg`,
    Buffer.from(jpg.split(",")[1], "base64")
  );
  if (i % 10 === 0 || i === total - 1) {
    const done = i + 1;
    const rate = done / ((Date.now() - t0) / 1000);
    console.error(
      `  ${done}/${total} frames (${at.toFixed(2)} s of film) — ` +
      `${rate.toFixed(2)} fps, ~${Math.round((total - done) / rate / 60)} min left`
    );
  }
}
if (identical > total * 0.2) {
  console.log(`WARNING      ${identical} frames were byte-identical to the one before — the film may not be advancing`);
}

await page.evaluate(() => {
  const e = window.__grnEngine;
  e.setPaused(false);
  e.skipCinematic();
});
await browser.close();

const frames = readdirSync(FRAMEDIR).filter((f) => f.endsWith(".jpg")).length;
console.log(`\nframes       ${frames} written to ${FRAMEDIR}`);

const ff = findFfmpeg();
if (!ff) {
  console.log(
    `encoder      none found — the frames are on disk, so nothing is lost.\n` +
    `             Set FFMPEG=/path/to/ffmpeg, put one on PATH, or\n` +
    `             npm i -D ffmpeg-static, then re-run to encode.`
  );
  process.exit(0);
}
mkdirSync(OUT.replace(/\/[^/]+$/, ""), { recursive: true });
execFileSync(
  ff,
  [
    "-y", "-hide_banner", "-loglevel", "error",
    "-framerate", String(FPS),
    "-i", `${FRAMEDIR}/f%05d.jpg`,
    // yuv420p and even dimensions, or half the players in the world
    // refuse the file — the most common way a technically valid export
    // turns out to be unplayable where it matters.
    "-c:v", "libx264", "-preset", "slow", "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-movflags", "+faststart",
    OUT,
  ],
  { stdio: ["ignore", "inherit", "inherit"] }
);
const bytes = execFileSync("stat", ["-c", "%s", OUT], { encoding: "utf8" }).trim();
console.log(
  `encoded      ${OUT} — ${(Number(bytes) / 1e6).toFixed(2)} MB, ` +
  `${frames} frames at ${FPS} fps = ${(frames / FPS).toFixed(2)} s`
);
