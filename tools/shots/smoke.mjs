// What a drift's tyre smoke actually does to the picture.
//
//   npm run dev
//   node tools/shots/smoke.mjs          (npm run check:smoke)
//
// The smoke's look is a handful of numbers in engine.ts — how thick a
// puff is (SMOKE_TAU), how much of the sky it answers to (SMOKE_SKY), how
// hard a street lantern, the tail lamps and the headlights light it —
// and every one of them was worked out from the light rig, not measured.
// This is the instrument they are measured against, the way sparks.mjs
// is the one for sparks. Run it on the build before a change as well as
// after: the numbers are only worth anything against a baseline.
//
// It scripts one drift, the same drift every time (Math.random is seeded
// for the length of it), on an open stretch clear of traffic, with the
// exposure pinned, and renders the frame twice from the same state — once
// with the smoke and sand drawn, once with them hidden. The difference is
// the smoke and nothing else. Done at 2:30 and at 12:30.
//
//   plume    how much of the frame the smoke changes at all (|Δ| > 2 of
//            255 in luma), the mean change over those pixels, signed and
//            not, how many of them are pinned at 250+, and how many got
//            DARKER. Smoke over a lamp pool should veil it — a plume
//            that only ever brightens is glowing, not scattering.
//   tail     the colour the smoke adds in a 60 px disc round the car's
//            tail lamps: R/G of the light it adds there (the positive
//            part of on - off, summed per channel), braking and idle.
//            Grey smoke adds grey, 1.0; smoke lit by the lamps adds red.
//            Measured on the same instant, a thousandth of a second apart
//            with the pedal changed, so the plume is the same plume.
//   wash     at 55 m/s, drifting, over 30 frames: the share of the lower
//            40% of the frame the smoke changes by more than 8, and the
//            largest jump in that share from one frame to the next. The
//            first is the lens washing out when the camera is in the
//            plume; the second is puffs popping in and out.
//
// Writes press/smoke/night.png and press/smoke/noon.png — the smoke-on
// frames the numbers were read off.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
         "--force-color-profile=srgb"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
  // Pinned, as sparks.mjs and paint.mjs pin it: the world boots at the
  // real hour in Kuwait and glides toward whatever hour is asked for.
  localStorage.setItem("gulf-road-nights-settings", JSON.stringify({ sky: "night" }));
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });
await page.waitForTimeout(3500);

const SPEED = Number(process.env.SPEED ?? 30); // m/s through the drift
const DRIFT_S = Number(process.env.DRIFT_S ?? 1.2); // seconds of drift before the frame

const r = await page.evaluate(async ([SPEED, DRIFT_S]) => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  e.setPaused(true);
  e.applyQualityTier("high");
  e.timeReal = false; e.timeCycling = false;
  e.setExposure(0, false);

  const m = 587;
  const away = () => {
    const far = e.track.wrap(e.player.s + e.track.length / 2);
    for (const t of e.traffic) t.s = far;
    if (e.rival) { e.rival.s = far; e.rival.speed = 0; }
  };
  const park = () => {
    away();
    e.player.s = m; e.player.lat = 0; e.player.speed = 0;
    e.heading = 0; e.steerSmooth = 0; e.driftYaw = 0; e.slipVel = 0; e.shake = 0;
  };
  const setHour = (h) => {
    e.timeHours = h;
    e.world.setTimeOfDay(h);
    e.applyDaylight();
    park();
    for (let i = 0; i < 40; i++) { e.update(1 / 60); park(); }
  };
  const clearPools = () => {
    e.smokeFx.update(9, {});
    e.dustFx.update(9, {});
    e.smokeAcc = 0; e.dustAcc = 0;
    // Which tyre the next puff comes off runs on from frame to frame, and
    // from one drift to the next: back to the first hub, so the night's
    // drift and the noon's smoke the same tyres in the same order.
    e.smokeSeq = 0;
  };
  // The same drift every time: the whole engine's randomness seeded for
  // the length of it, not just the smoke's.
  const seeded = (fn) => {
    let s = 20260928;
    const rnd = Math.random;
    Math.random = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    try { return fn(); } finally { Math.random = rnd; }
  };
  const drive = (speed, frames, each) => {
    e.player.speed = speed;
    for (let i = 0; i < frames; i++) {
      away();
      e.player.speed = Math.max(e.player.speed, speed);
      e.setTouchInput({ throttle: 0.9, brake: 0, steer: 1 });
      e.touch.drift = true;
      e.update(1 / 60);
      e.player.lat = 0;
      each?.(i);
    }
    e.touch.drift = false;
    e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });
  };

  const W = e.renderer.domElement.clientWidth;
  const H = e.renderer.domElement.clientHeight;
  const cvs = document.createElement("canvas");
  cvs.width = W; cvs.height = H;
  const ctx = cvs.getContext("2d");
  const grab = () => {
    ctx.drawImage(e.renderer.domElement, 0, 0, W, H);
    return ctx.getImageData(0, 0, W, H).data;
  };
  const luma = (d) => {
    const out = new Float32Array(W * H);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      out[p] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    }
    return out;
  };
  // The same state drawn twice: pools as they are, then hidden. Three
  // renders a state, as sparks.mjs does, so nothing carried between
  // frames is still settling when the frame is read.
  const pair = () => {
    const vis = [e.smokeFx.points.visible, e.dustFx.points.visible];
    for (let i = 0; i < 3; i++) e.composer.render();
    const on = grab();
    e.smokeFx.points.visible = false;
    e.dustFx.points.visible = false;
    for (let i = 0; i < 3; i++) e.composer.render();
    const off = grab();
    e.smokeFx.points.visible = vis[0];
    e.dustFx.points.visible = vis[1];
    return { on, off };
  };
  const plume = ({ on, off }) => {
    const A = luma(on), B = luma(off);
    let n = 0, sum = 0, abs = 0, clip = 0, darker = 0;
    for (let p = 0; p < W * H; p++) {
      const d = A[p] - B[p];
      if (Math.abs(d) <= 2) continue;
      n++; sum += d; abs += Math.abs(d);
      if (A[p] >= 250) clip++;
      if (d < 0) darker++;
    }
    return {
      px: n,
      pct: +((100 * n) / (W * H)).toFixed(2),
      mean: n ? +(sum / n).toFixed(2) : 0,
      meanAbs: n ? +(abs / n).toFixed(2) : 0,
      clipPct: n ? +((100 * clip) / n).toFixed(3) : 0,
      darkerPct: n ? +((100 * darker) / n).toFixed(1) : 0,
    };
  };
  // Where the tail lamps are on screen: the same anchor the engine lights
  // the smoke from, 5 cm behind the lens line at its height.
  const tailPx = () => {
    const d = e.carBody.userData.dims ?? {};
    const v = new THREE.Vector3(0, d.tailY ?? 0.75, (d.tail ?? -2.3) - 0.05);
    e.carBody.localToWorld(v);
    v.project(e.camera);
    return { x: (v.x + 1) * 0.5 * W, y: (1 - v.y) * 0.5 * H, front: v.z < 1 };
  };
  const tailTint = ({ on, off }, at) => {
    let r = 0, g = 0, n = 0;
    const R = 60;
    for (let y = Math.max(0, Math.floor(at.y - R)); y <= Math.min(H - 1, Math.ceil(at.y + R)); y++) {
      for (let x = Math.max(0, Math.floor(at.x - R)); x <= Math.min(W - 1, Math.ceil(at.x + R)); x++) {
        if ((x - at.x) ** 2 + (y - at.y) ** 2 > R * R) continue;
        const i = (y * W + x) * 4;
        const dr = on[i] - off[i], dg = on[i + 1] - off[i + 1];
        if (Math.abs(0.2126 * dr + 0.7152 * dg + 0.0722 * (on[i + 2] - off[i + 2])) > 2) n++;
        r += Math.max(0, dr);
        g += Math.max(0, dg);
      }
    }
    return { rg: g > 0 ? +(r / g).toFixed(2) : null, px: n };
  };

  const out = {};
  for (const [label, h] of [["night", 2.5], ["noon", 12.5]]) {
    setHour(h);
    clearPools();
    seeded(() => drive(SPEED, Math.round(DRIFT_S * 60)));
    const shot = pair();
    const res = { hour: h, smoke: e.smokeFx.alive, dust: e.dustFx.alive, ...plume(shot) };
    // The tail: the pedal changed on the same instant. A thousandth of a
    // second moves nothing; it is enough for the engine to relight the
    // lamps and the smoke's light from them.
    const at = tailPx();
    const step = (brake) => {
      e.setTouchInput({ throttle: 0, brake, steer: 0 });
      e.update(0.001);
      return tailTint(pair(), at);
    };
    res.tail = { at: { x: Math.round(at.x), y: Math.round(at.y), inFront: at.front }, braking: step(1), idle: step(0) };
    e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });
    ctx.putImageData(new ImageData(shot.on, W, H), 0, 0);
    res.png = cvs.toDataURL("image/png").split(",")[1];
    out[label] = res;
  }

  // The wash at speed, at night: a drift already under way, then 30
  // frames each drawn with and without the smoke.
  setHour(2.5);
  clearPools();
  const wash = [];
  const lower = Math.floor(H * 0.6);
  seeded(() => {
    drive(55, 45);
    drive(55, 30, () => {
      const { on, off } = pair();
      const A = luma(on), B = luma(off);
      let n = 0;
      for (let p = lower * W; p < W * H; p++) if (Math.abs(A[p] - B[p]) > 8) n++;
      wash.push((100 * n) / ((H - lower) * W));
    });
  });
  let jump = 0;
  for (let i = 1; i < wash.length; i++) jump = Math.max(jump, Math.abs(wash[i] - wash[i - 1]));
  out.wash = {
    max: +Math.max(...wash).toFixed(2),
    mean: +(wash.reduce((a, b) => a + b, 0) / wash.length).toFixed(2),
    jump: +jump.toFixed(2),
  };
  setHour(2.5);
  clearPools();
  out.W = W; out.H = H;
  // What the build is: the smoke's own uniforms, when it has them.
  const u = e.smokeFx.material.uniforms;
  out.build = u.uTau
    ? `lit smoke: uTau ${u.uTau.value.toFixed(3)}, uGrow ${u.uGrow.value}, uCapPx ${Math.round(u.uCapPx.value)}`
    : `flat smoke: opacity ${u.uOpacity.value}, uGrow ${u.uGrow.value}`;
  return out;
}, [SPEED, DRIFT_S]);

mkdirSync("press/smoke", { recursive: true });
console.log(`frame      ${r.W}x${r.H}; ${r.build}; a ${DRIFT_S} s drift at ${SPEED} m/s, exposure pinned\n`);
for (const k of ["night", "noon"]) {
  const s = r[k];
  writeFileSync(`press/smoke/${k}.png`, Buffer.from(s.png, "base64"));
  console.log(`${k.padEnd(6)} ${String(s.hour).padStart(4)} h  ${s.smoke} puffs, ${s.dust} grains`);
  console.log(`  plume    ${s.px} px (${s.pct}% of the frame), mean Δ ${s.mean} (|Δ| ${s.meanAbs}), ${s.clipPct}% of it at 250+, ${s.darkerPct}% of it darker`);
  const t = s.tail;
  console.log(`  tail     disc at ${t.at.x},${t.at.y}${t.at.inFront ? "" : " (behind the camera)"}: R/G added ${t.braking.rg ?? "-"} braking (${t.braking.px} px of plume), ${t.idle.rg ?? "-"} idle (${t.idle.px} px)`);
}
console.log(`\nwash       55 m/s, lower 40% of the frame changed by > 8: max ${r.wash.max}%, mean ${r.wash.mean}%, largest frame-to-frame jump ${r.wash.jump}%`);
console.log(`\npress/smoke/night.png  press/smoke/noon.png`);
await browser.close();
