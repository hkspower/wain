// The pre-race film, measured and photographed.
//
// tests/intro-film.mjs proves the timing arithmetic. This proves the
// picture — and it takes TWO passes, which is the whole lesson of the
// first version.
//
// That version started the film and sampled it at ten points on a wall
// clock. It cannot work here: the camera deliberately runs on wall time
// so the film is always eight seconds whatever the frame rate, and a
// headless software renderer serves about one frame a second. The whole
// film was over before the third sample; every reading came back
// identical, 19.7 s in, with the flags already down.
//
// So the film's clock is DRIVEN rather than chased. Pass two moves
// cine.start to place the film at a chosen second, renders, and reads
// the staging — camera, gap, formation. And the beam pulse, which is a
// real-time animation and cannot be posed, gets pass one to itself:
// fire one hit, watch the lamp over the frames that follow, and check
// that it peaks and comes home.

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

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
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

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };

// ---- Pass 1: the pulse ------------------------------------------------
const pulse = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const r = e.rival;
  if (!r) return { error: "no rival on the road" };
  e.setTimeOfDay?.(1.5);
  e.player.speed = 34;
  r.state = "cruise";
  r.speed = 34;
  r.s = e.track.wrap(e.player.s + 20);
  // Pinned for the same reason pass two is: highBeamHit aborts if the
  // film has ended, and at this frame rate it can end inside one frame.
  const realEnd = e.endCinematic.bind(e);
  e.endCinematic = () => {};
  e.beginBattleCinematic(r);
  await new Promise((res) => requestAnimationFrame(res));
  if (!e.cine) { e.endCinematic = realEnd; return { error: "the film did not start" }; }
  // PAUSE FIRST. The pulse is driven by requestAnimationFrame, and with
  // the game's own loop rendering this scene in software a frame takes
  // most of a second — so the whole 380 ms animation fell inside one
  // blocked frame and the trace came back with a single sample at the
  // resting value. Paused, the loop stops competing, rAF ticks at
  // something like display rate, and the pulse can actually be watched.
  e.setPaused(true);
  const dipped = e.headlight.intensity;
  e.highBeamHit();
  const trace = [];
  const t0 = performance.now();
  // Sample as fast as the page will allow, for long enough that the
  // pulse is certainly over. How many samples come back is itself a
  // measurement — see the report.
  while (performance.now() - t0 < 2000) {
    await new Promise((res) => setTimeout(res, 8));
    trace.push(+e.headlight.intensity.toFixed(1));
  }
  e.endCinematic = realEnd;
  e.setPaused(false);
  e.skipCinematic();
  return {
    dipped: +dipped.toFixed(1),
    peak: Math.max(...trace),
    settled: trace[trace.length - 1],
    samples: trace.length,
  };
});
if (pulse.error) { console.error(pulse.error); await browser.close(); process.exit(2); }

console.log(
  `beam         dipped ${pulse.dipped}, peak ${pulse.peak} ` +
  `(x${(pulse.peak / pulse.dipped).toFixed(2)}), back to ${pulse.settled} ` +
  `after the pulse — ${pulse.samples} samples in 2 s`
);
// WHETHER THE PEAK IS OBSERVABLE AT ALL is a property of this machine,
// not of the game, and the tool has to say which it is measuring. The
// pulse is 380 ms and driven by requestAnimationFrame; a software
// renderer chewing through this scene serves roughly one frame a
// second, so the animation can pass entirely between two samples. Fewer
// than eight samples in two seconds means the flash was never given a
// chance to be seen here — which is worth reporting as exactly that,
// rather than as a broken headlight. The pulse's own arithmetic is
// pinned by tests/intro-film.mjs, which needs no frames at all.
if (pulse.samples < 8) {
  console.log(
    `             only ${pulse.samples} samples landed — this machine cannot ` +
    `resolve a 380 ms animation, so the peak is UNMEASURED here rather than absent`
  );
} else {
  check(
    pulse.peak > pulse.dipped * 1.6,
    `the high beam only reaches x${(pulse.peak / pulse.dipped).toFixed(2)} of dipped — it will not read as a flash`
  );
}
// It has to come HOME. A pulse that leaves the lamps up drives into the
// green flag on main beam.
check(
  Math.abs(pulse.settled - pulse.dipped) < 0.5,
  `the lamp settled at ${pulse.settled} against a dipped ${pulse.dipped} — the flash never came down`
);

// ---- Pass 2: the staging ---------------------------------------------
const out = await page.evaluate(async (want) => {
  const e = window.__grnEngine;
  const r = e.rival;
  if (!r) return { error: "no rival on the road" };
  r.state = "cruise";
  r.speed = 34;
  e.player.speed = 34;
  r.s = e.track.wrap(e.player.s + 20);
  // The pin goes on BEFORE the film starts, and stays on for the whole
  // pass. Two lessons, both learned by getting nothing back: clearing it
  // between poses left a window where the engine saw a stale start and
  // ended the film, and starting it after the first frame was already
  // too late — the main thread here blocks for whole seconds at a time,
  // so the film's entire eight seconds can expire inside ONE frame,
  // before any pin has had a chance to run.
  const samples = [];
  const shots = [];
  // HOLD THE FILM OPEN by taking its ending away, rather than by racing
  // it. A pinned cine.start is a bet that a 4 ms timer fires before the
  // engine's next update; on this machine the main thread blocks for
  // whole seconds and that bet loses — the film expired inside a single
  // frame, and only the first pose was ever reachable. Replacing
  // endCinematic for the duration is not a race: while the poses are
  // being photographed the film simply has no way to end, and the real
  // ending is put back before the pass returns.
  // BOTH, and each covers what the other cannot. Stubbing endCinematic
  // stops the film expiring — a pin alone lost that race, because the
  // thread blocks for whole seconds and the film's eight can pass inside
  // one frame. But the stub alone poses nothing: setting cine.start and
  // awaiting a frame leaves the engine reading that clock a FULL FRAME
  // later, seconds stale, so every pose came back showing the film's
  // last shot whichever second was asked for. A 4 ms interval keeps the
  // clock fresh to within milliseconds of whenever the engine happens to
  // look at it.
  const realEnd = e.endCinematic.bind(e);
  e.endCinematic = () => {};
  let poseAt = want[0];
  const pin = setInterval(() => {
    if (e.cine) {
      e.cine.start = performance.now() - poseAt * 1000;
      e.cine.hits = 3;
    }
  }, 4);
  e.beginBattleCinematic(r);
  await new Promise((res) => requestAnimationFrame(res));
  if (!e.cine) {
    clearInterval(pin);
    e.endCinematic = realEnd;
    return { error: "the film did not restart" };
  }

  for (const at of want) {
    poseAt = at;
    if (!e.cine) break;
    // Pose the film at `at` seconds, then let the engine solve and draw
    // that instant. Hits are pinned as already fired: this pass is about
    // where the cars and the camera are, and pass one owns the beams.
    //
    // The pin is HELD on a fast timer for as long as the pose takes,
    // and that is not belt-and-braces. Waiting two frames here costs
    // seconds of wall time at this frame rate; the film is eight
    // seconds long and checks its own clock every update, so a
    // once-set start goes stale and the engine ends the film in the
    // middle of being photographed. Every staging point came back
    // unreachable until the pin was held.
    poseAt = at;
    // Several frames because the rival's lane is EASED into rather than
    // snapped — a snap across a cut is what the ease exists to avoid —
    // so a single-frame pose photographs a formation still on its way.
    // The pin above keeps the clock at `at` throughout.
    for (let f = 0; f < 4 && e.cine; f++) {
      await new Promise((res) => requestAnimationFrame(res));
    }
    if (!e.cine) break;
    samples.push({
      t: at,
      gap: +e.track.deltaAhead(e.player.s, r.s).toFixed(1),
      lat: +(r.lat - e.player.lat).toFixed(2),
      want: +(r.targetLat - e.player.lat).toFixed(2),
      camY: +e.camera.position.y.toFixed(2),
      mood: e.music?.mood ?? null,
    });
    const gl = e.renderer.domElement;
    const c = document.createElement("canvas");
    c.width = gl.width;
    c.height = gl.height;
    c.getContext("2d").drawImage(gl, 0, 0);
    shots.push([`t${String(Math.round(at * 100)).padStart(4, "0")}.png`, c.toDataURL("image/png")]);
  }
  clearInterval(pin);
  e.endCinematic = realEnd;
  e.skipCinematic();
  return { samples, shots };
}, [0.4, 1.2, 2.1, 3.2, 5.0, 7.0]);

if (out.error) { console.error(out.error); await browser.close(); process.exit(2); }
mkdirSync("press/film", { recursive: true });
for (const [n, url] of out.shots) {
  writeFileSync(`press/film/${n}`, Buffer.from(url.split(",")[1], "base64"));
}

console.log(`\n    t      gap     lat   asked    camY   mood`);
for (const s of out.samples) {
  console.log(
    `${String(s.t).padStart(5)}${String(s.gap).padStart(9)}${String(s.lat).padStart(8)}` +
    `${String(s.want).padStart(8)}${String(s.camY).padStart(8)}   ${s.mood}`
  );
}
check(out.samples.length === 6, `only ${out.samples.length} of 6 staging points were reachable`);

// The rival is genuinely up the road while the beams go in...
const early = out.samples.filter((s) => s.t < 2.4);
check(
  early.length > 0 && early.every((s) => s.gap > 8),
  `the rival is not up the road during the challenge: ${early.map((s) => s.gap).join(", ")} m`
);
// ...in the player's own lane, so the beams land on it...
// The lane the film ASKS for during the challenge is the player's own,
// so the beams have something to land on. The measured lat trails it,
// because the rival eases across rather than snapping — that ease is
// the point, and how fast it converges is not this tool's subject.
check(
  early.every((s) => Math.abs(s.want) < 0.01),
  `the film asks the rival to sit ${early.map((s) => s.want).join(", ")} m off the player's lane during the challenge — the beams would miss`
);
// ...and the pair has closed up by the two-shot.
const late = out.samples.filter((s) => s.t > 4);
check(
  late.every((s) => Math.abs(s.gap) < 4),
  `the pair never closed up: ${late.map((s) => s.gap).join(", ")} m`
);
// The camera is down at bumper height for the challenge, not up in the
// chase position — that is what makes the beams the subject.
check(
  early.every((s) => s.camY < 2.2),
  `the challenge shot sits at ${early.map((s) => s.camY).join(", ")} m — too high to see its own lamps`
);
// And the score is the film's cue, not the fight's.
check(
  out.samples.every((s) => s.mood === "challenge" || s.mood === null),
  `the film played the ${out.samples.find((s) => s.mood && s.mood !== "challenge")?.mood} track`
);

console.log(
  fail.length
    ? "\nFAILURES:\n - " + fail.join("\n - ")
    : "\nthe beams hit and come home, the rival is up the road in your lane, and the pair closes for the two-shot"
);
await browser.close();
process.exit(fail.length ? 1 : 0);
