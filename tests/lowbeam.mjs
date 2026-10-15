// The dipped beam, on the aiming screen and on the road.
//
//   npm run dev
//   npm run test:lowbeam
//
// A headlamp is approved by shining it at a white wall 25 m away and
// reading the light on it (ECE R112/R48): where the cut-off line sits,
// how sharp it is, where it steps up on the kerb side, where the hot
// zone is, and how little gets over the line toward oncoming drivers.
// This does exactly that, with the game's own lamps — their live world
// transforms, cookie, intensity, cone and fall-off — copied into a clean
// scene with nothing else in it, rendered to a float target so the
// numbers are light, not tone-mapped pixels.
//
// Then the same lamps on a white road, from above: how far the beam
// reaches on each side and how the light is shared between the bumper
// and forty metres out, which is the whole difference between a dipped
// beam and a torch.
//
// And the parts that have to keep working around it: the cookie itself
// (lowbeam.ts, read in node), main beam taking the cut-off away on BOTH
// lamps, a bulb's projector line being sharper than a reflector's, a
// single-lamp car running on one lamp and a smoked lens dimming the
// light through it.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { LOW_BEAM, cookieValue, cutoffAt, bakeCookie, lampTargetY, patchHeadlampRetro } from "../src/game/lowbeam.ts";
import lightsFragmentBegin from "three/src/renderers/shaders/ShaderChunk/lights_fragment_begin.glsl.js";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok  " : "FAIL"; };
const f = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : String(x));

// --- 1. The cookie, in node -------------------------------------------
{
  // Flat on the oncoming side: the line is at pitch 0 from -30 to 0 deg.
  const half = (bulb, yaw) => {
    // the pitch where the beam crosses half its value just under the line
    let lo = -2, hi = 2;
    const ref = cookieValue(bulb, "low", yaw, -0.4);
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (cookieValue(bulb, "low", yaw, m) > ref / 2) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  };
  const flat = [-25, -15, -8, -3, -1].map((y) => half("halogen", y));
  console.log(`cookie    ${check(flat.every((p) => Math.abs(p) < 0.12), `the oncoming cut-off is not flat at the aim: ${flat.map((p) => f(p)).join(", ")} deg`)}` +
    `  oncoming cut-off at ${flat.map((p) => f(p)).join(" / ")} deg (yaw -25..-1)`);
  const step = [2, 8, 20].map((y) => half("halogen", y));
  console.log(`          ${check(step[0] > 0.3 && step[1] > 0.8 && step[2] > 0.8 && step[2] < 1.2,
    `the kerb-side step is wrong: ${step.map((p) => f(p)).join(", ")}`)}  kerb side steps up to ${step.map((p) => f(p)).join(" / ")} deg (yaw 2 / 8 / 20)`);
  const slope = (Math.atan((cutoffAt(3) - cutoffAt(1)) / 2) * 180) / Math.PI;
  console.log(`          ${check(Math.abs(slope - 15) < 0.5, `the step rises at ${f(slope)} deg`)}  the step rises at ${f(slope, 1)} deg`);
  // Over the line toward oncoming traffic: B50L, 0.57 deg up and 3.43
  // left of the lamp's horizontal — that is 1.26 deg above our cut-off.
  const b50l = cookieValue("halogen", "low", -3.43, 0.57 + LOW_BEAM.aimDrop * 57.3);
  console.log(`          ${check(b50l < 0.02, `B50L carries ${f(b50l, 3)} of the hot zone`)}  B50L ${f(b50l, 3)} of the hot zone`);
  // The hot zone: right of centre and just under the line.
  let best = { v: 0, y: 0, p: 0 };
  for (let y = -30; y <= 30; y += 0.25) for (let p = -6; p <= 1.5; p += 0.05) {
    const v = cookieValue("halogen", "low", y, p);
    if (v > best.v) best = { v, y, p };
  }
  console.log(`          ${check(best.y > 0 && best.y < 6 && best.p < 0 && best.p > -1.2, `the hot zone is at yaw ${best.y}, pitch ${f(best.p)}`)}` +
    `  hot zone at ${f(best.y, 1)} deg right, ${f(-best.p)} deg under the line`);
  // A projector's line is sharper than a reflector's.
  const width = (bulb) => {
    const ref = cookieValue(bulb, "low", -5, -0.5);
    let p90 = 0, p10 = 0;
    for (let p = -1; p <= 1; p += 0.002) {
      const v = cookieValue(bulb, "low", -5, p) / ref;
      if (v > 0.9) p90 = p;
      if (v > 0.1) p10 = p;
    }
    return p10 - p90;
  };
  const wh = width("halogen"), wl = width("led");
  console.log(`          ${check(wl < wh && wh < 0.45 && wl < 0.25, `cut-off widths halogen ${f(wh)} led ${f(wl)} deg`)}` +
    `  line 90->10 % over ${f(wh)} deg (halogen reflector), ${f(wl)} deg (LED projector)`);
  // Main beam has no line.
  const over = cookieValue("halogen", "main", -5, 1.5) / cookieValue("halogen", "main", -5, -0.5);
  console.log(`          ${check(over > 0.5, `main beam still cuts off: ${f(over)} above vs below`)}  main beam above the old line: ${f(over)} of below`);
  // The asphalt's back-scatter of the lamps rides on three's own light
  // loop; a three that has reshaped it must fail here, not go dim.
  const patched = patchHeadlampRetro(lightsFragmentBegin);
  console.log(`          ${check(patched !== null && patched.split("grnRetro").length === 5,
    "the asphalt's headlamp back-scatter no longer patches three's lights_fragment_begin")}  road back-scatter patch applies to three's spot loop` +
    ` (x${LOW_BEAM.retro.gain} Lambert on the lamp's line, cos^${LOW_BEAM.retro.power})`);
  const raw = bakeCookie("halogen", "low");
  console.log(`          ${check(raw.length === LOW_BEAM.cookie.w * LOW_BEAM.cookie.h * 4, "cookie bake has the wrong size")}  baked ${LOW_BEAM.cookie.w} x ${LOW_BEAM.cookie.h}` +
    `, aim ${f(LOW_BEAM.aimDrop * 100, 1)} % (target at ${f(lampTargetY(0.66))} m for a 0.66 m lamp at ${LOW_BEAM.aimAt} m)`);
}

// --- 2. The game's own lamps -------------------------------------------
const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("No Chromium found. Set CHROME_PATH."); process.exit(2); }
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
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
await page.waitForTimeout(3000);

// Park the car at night on a straight, settle it, and install the
// measuring kit: copies of the live lamps in an empty scene, a board and
// a road plane, and a float target to read them from.
await page.evaluate(() => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  e.setPaused(true);
  e.timeReal = false; e.timeCycling = false; e.timeHours = 2.5;
  e.world.setTimeOfDay(2.5);
  e.applyDaylight();
  window.__lbSettle = (extra) => {
    for (let i = 0; i < 30; i++) {
      const away = e.track.wrap(2400 + e.track.length / 2);
      for (const t of e.traffic) t.s = away;
      if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
      e.player.s = 2400; e.player.lat = 0; e.player.speed = 0;
      e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });
      extra?.();
      e.update(1 / 60);
    }
    e.scene.updateMatrixWorld(true);
  };
  window.__lbSettle();

  const R = e.renderer;
  const rt = new THREE.WebGLRenderTarget(1200, 600, { type: THREE.FloatType, depthBuffer: true });
  const rtRoad = new THREE.WebGLRenderTarget(240, 900, { type: THREE.FloatType, depthBuffer: true });
  const white = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });

  /** The live lamps, as world-space copies. `which` 0 = headlight, 1 = R, 2 = both. */
  const lampsNow = (which) => {
    const out = [];
    for (const [i, src] of [[0, e.headlight], [1, e.headlightR]]) {
      if (which !== 2 && which !== i) continue;
      const l = new THREE.SpotLight(src.color, src.intensity, src.distance, src.angle, src.penumbra, src.decay);
      l.map = src.map;
      l.shadow.camera.near = 0.3;
      src.getWorldPosition(l.position);
      src.target.getWorldPosition(l.target.position);
      out.push(l);
    }
    return out;
  };
  const read = (target, w, h) => {
    const buf = new Float32Array(w * h * 4);
    R.readRenderTargetPixels(target, 0, 0, w, h, buf);
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) lum[i] = 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
    return lum;
  };
  const renderInto = (scene, cam, target) => {
    const prevT = R.getRenderTarget(), prevAuto = R.autoClear, prevSE = R.shadowMap.enabled;
    R.setRenderTarget(target);
    R.autoClear = true;
    R.setClearColor(0x000000, 1);
    R.shadowMap.enabled = false;
    R.render(scene, cam);
    R.setRenderTarget(prevT);
    R.autoClear = prevAuto;
    R.shadowMap.enabled = prevSE;
  };

  /**
   * The aiming screen for one lamp: a white board 25 m down the lamp's
   * horizontal heading, centred on it, 60 m x 6 m. Returns the board as
   * rows of light, row 0 at the bottom, with the metres per pixel.
   */
  window.__lbScreen = (which) => {
    const lamps = lampsNow(which);
    const src = lamps[0];
    const fwd = src.target.position.clone().sub(src.position); fwd.y = 0; fwd.normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const scene = new THREE.Scene();
    for (const l of lamps) scene.add(l, l.target);
    const D = 25, BW = 60, BH = 6;
    const centre = src.position.clone().addScaledVector(fwd, D);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), white);
    board.position.copy(centre);
    board.lookAt(src.position.clone().setY(centre.y));
    scene.add(board);
    const cam = new THREE.OrthographicCamera(-BW / 2, BW / 2, BH / 2, -BH / 2, 0.1, 100);
    cam.position.copy(centre).addScaledVector(fwd, -10);
    cam.up.copy(up);
    cam.lookAt(centre);
    scene.updateMatrixWorld(true);
    renderInto(scene, cam, rt);
    const lum = read(rt, rt.width, rt.height);
    return { w: rt.width, h: rt.height, mx: BW / rt.width, my: BH / rt.height, lum: Array.from(lum), lampY: src.position.y };
  };

  /**
   * The road from above: a white plane at road height under both lamps,
   * 90 m ahead of the lamps by 24 m across. Column 0 is the driver's
   * left; row 0 is at the lamps.
   */
  window.__lbRoad = () => {
    const lamps = lampsNow(2);
    const mid = lamps[0].position.clone().add(lamps[lamps.length - 1].position).multiplyScalar(0.5);
    const fwd = lamps[0].target.position.clone().sub(lamps[0].position); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const roadY = e.playerMesh.getWorldPosition(new THREE.Vector3()).y;
    const scene = new THREE.Scene();
    for (const l of lamps) scene.add(l, l.target);
    const L = 90, Wd = 24;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(Wd, L), white);
    const c = mid.clone().addScaledVector(fwd, L / 2); c.y = roadY;
    plane.position.copy(c);
    plane.lookAt(c.clone().add(new THREE.Vector3(0, 1, 0))); // facing the sky
    scene.add(plane);
    const cam = new THREE.OrthographicCamera(-Wd / 2, Wd / 2, L / 2, -L / 2, 0.1, 100);
    cam.position.copy(c).add(new THREE.Vector3(0, 30, 0));
    cam.up.copy(fwd);
    cam.lookAt(c);
    scene.updateMatrixWorld(true);
    renderInto(scene, cam, rtRoad);
    const lum = read(rtRoad, rtRoad.width, rtRoad.height);
    return { w: rtRoad.width, h: rtRoad.height, L, Wd, lum: Array.from(lum), lampHeight: mid.y - roadY };
  };
});

const screen = (which) => page.evaluate((w) => window.__lbScreen(w), which);
const road = () => page.evaluate(() => window.__lbRoad());

/** Analyse one lamp's screen: cut-off heights, hot zone, B50L, width. */
const analyse = (s) => {
  const at = (x, y) => s.lum[y * s.w + x];
  const cx = s.w / 2, cy = s.h / 2; // the lamp's own axis height and line
  const colOf = (deg) => Math.round(cx + Math.tan((deg * Math.PI) / 180) * 25 / s.mx);
  const rowOf = (m) => Math.round(cy + m / s.my);
  let max = 0, mxX = 0, mxY = 0;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (at(x, y) > max) { max = at(x, y); mxX = x; mxY = y; }
  // Cut-off in a column: the highest row still at half the column's
  // brightest value (searching down from the top, a column at a time).
  const cutoff = (deg) => {
    const x = colOf(deg);
    let cm = 0;
    for (let y = 0; y < s.h; y++) cm = Math.max(cm, at(x, y));
    for (let y = s.h - 1; y >= 0; y--) if (at(x, y) >= cm / 2) return (y - cy) * s.my;
    return NaN;
  };
  const span = (deg) => {
    const x = colOf(deg);
    let cm = 0;
    for (let y = 0; y < s.h; y++) cm = Math.max(cm, at(x, y));
    let y90 = NaN, y10 = NaN;
    for (let y = s.h - 1; y >= 0; y--) {
      if (Number.isNaN(y10) && at(x, y) >= cm * 0.1) y10 = y;
      if (Number.isNaN(y90) && at(x, y) >= cm * 0.9) { y90 = y; break; }
    }
    return ((y10 - y90) * s.my / 25) * (180 / Math.PI);
  };
  const toDeg = (m) => (Math.atan(m / 25) * 180) / Math.PI;
  // B50L: 0.57 deg up, 3.43 deg left, against the lamp's horizontal.
  const b50l = at(colOf(-3.43), rowOf(Math.tan((0.57 * Math.PI) / 180) * 25)) / max;
  // Width at 10 % of the peak, along the hot zone's row.
  let left = 0, right = 0;
  for (let x = mxX; x >= 0; x--) if (at(x, mxY) >= max * 0.1) left = x;
  for (let x = mxX; x < s.w; x++) if (at(x, mxY) >= max * 0.1) right = x;
  return {
    max, hotRight: toDeg((mxX - cx) * s.mx), hotDown: toDeg((mxY - cy) * s.my),
    cutL: [-20, -10, -4].map(cutoff), cutR: [8, 15, 25].map(cutoff), spanL: span(-6),
    b50l, wideL: toDeg((left - cx) * s.mx), wideR: toDeg((right - cx) * s.mx),
  };
};

const want = -LOW_BEAM.aimDrop * 25; // the line's height at 25 m against the lamp
for (const which of [0, 1]) {
  const s = await screen(which);
  const a = analyse(s);
  const name = which === 0 ? "nearside lamp" : "offside lamp";
  console.log(`\nscreen    ${name}, 25 m, ${s.w}x${s.h} at ${f(s.mx * 100, 1)} x ${f(s.my * 100, 1)} cm`);
  console.log(`line      ${check(a.cutL.every((y) => Math.abs(y - want) < 0.05),
    `${name}: the oncoming cut-off sits at ${a.cutL.map((y) => f(y)).join(", ")} m against ${f(want)} m`)}` +
    `  oncoming side at ${a.cutL.map((y) => f(y)).join(" / ")} m (aim ${f(want)} m, 1.2 %)`);
  const rise = a.cutR.map((y) => y - want);
  console.log(`step      ${check(rise.every((r) => r > 0.3 && r < 0.6),
    `${name}: the kerb side sits ${rise.map((r) => f(r)).join(", ")} m above the line`)}` +
    `  kerb side ${rise.map((r) => f(r)).join(" / ")} m above it (1 deg = 0.44 m)`);
  console.log(`sharp     ${check(a.spanL < 0.5, `${name}: the line takes ${f(a.spanL)} deg to go from 90 % to 10 %`)}` +
    `  90 -> 10 % in ${f(a.spanL)} deg`);
  console.log(`hot       ${check(a.hotRight > -1 && a.hotRight < 8 && a.hotDown < -0.4 && a.hotDown > -2.5,
    `${name}: the hot zone is ${f(a.hotRight)} deg right, ${f(a.hotDown)} deg down`)}` +
    `  hot zone ${f(a.hotRight)} deg right, ${f(-a.hotDown)} deg down`);
  console.log(`glare     ${check(a.b50l < 0.02, `${name}: B50L carries ${f(a.b50l, 3)} of the peak`)}` +
    `  B50L at ${f(a.b50l * 100, 1)} % of the peak`);
  console.log(`spread    ${check(a.wideL < -22 && a.wideR > 22, `${name}: 10 % of the peak spans ${f(a.wideL)} to ${f(a.wideR)} deg`)}` +
    `  10 % of the peak from ${f(a.wideL, 0)} to ${f(a.wideR, 0)} deg`);
}

// --- 3. On the road ---------------------------------------------------
{
  const r = await road();
  const at = (xm, dm) => {
    const x = Math.round((xm + r.Wd / 2) / r.Wd * r.w);
    const y = Math.round((dm / r.L) * r.h);
    return r.lum[Math.max(0, Math.min(r.h - 1, y)) * r.w + Math.max(0, Math.min(r.w - 1, x))];
  };
  // The camera's up is the car's forward, so row 0 of the read (the
  // bottom) is the end at the lamps and the image's right is the
  // driver's right. dm is metres ahead of the lamps.
  const E = (x, d) => at(x, d);
  const ref = E(0, 10);
  const reach = (x) => { let last = 0; for (let d = 5; d <= 89; d += 0.5) if (E(x, d) >= ref * 0.05) last = d; return last; };
  const kerb = reach(3.5), onc = reach(-3.5), axis = reach(0);
  console.log(`\nroad      lamps ${f(r.lampHeight)} m up; light on the road against 10 m ahead:`);
  console.log("          " + [5, 10, 20, 30, 40, 50, 60].map((d) => `${d} m ${f(E(0, d) / ref)}`).join("  "));
  console.log(`reach     ${check(kerb >= 45, `the kerb side reaches ${kerb} m`)}  5 % of the 10 m light reaches ${kerb} m on the kerb lane, ` +
    `${axis} m ahead, ${onc} m on the oncoming lane`);
  console.log(`          ${check(onc <= kerb * 0.9 && onc >= 30, `oncoming reach ${onc} m against kerb ${kerb} m`)}  oncoming side ${f(onc / kerb)} of the kerb side's`);
  // 40 m is too close to where the line itself lands (h / 1.2 %, 45 m
  // for a 0.54 m lamp) to compare against; 30 m is the beam's own body.
  const near = E(0, 5) / E(0, 20), far = E(0, 10) / E(0, 30);
  console.log(`share     ${check(near < 4, `5 m is ${f(near)}x 20 m — a torch, not a dipped beam`)}  5 m / 20 m = ${f(near)} (the round cone was 28)`);
  console.log(`          ${check(far < 5, `10 m is ${f(far)}x 30 m`)}  10 m / 30 m = ${f(far)}`);
}

// --- 4. Main beam, bulbs and mods ------------------------------------
{
  const m = await page.evaluate(() => {
    const e = window.__grnEngine;
    e.highBeam = true; e.highBeamK = 1;
    window.__lbSettle(() => { e.highBeamK = 1; });
    return { blend: e.beamBlend, i: [e.headlight.intensity, e.headlightR.intensity], d: [e.headlight.distance, e.headlightR.distance] };
  });
  const sMain = [await screen(0), await screen(1)];
  const aboveShare = sMain.map((s) => {
    const at = (x, y) => s.lum[y * s.w + x];
    const cx = s.w / 2, cy = s.h / 2;
    const col = Math.round(cx - Math.tan((5 * Math.PI) / 180) * 25 / s.mx);
    let best = 0;
    for (let y = 0; y < s.h; y++) best = Math.max(best, at(col, y));
    return at(col, Math.round(cy + 0.25 / s.my)) / best; // 0.25 m above lamp height, oncoming side
  });
  console.log(`\nmain      ${check(m.blend === 1, `the cookie is at ${m.blend} with the stalk up`)}  cookie fully on main beam`);
  console.log(`          ${check(aboveShare.every((v) => v > 0.3), `main beam still cuts off: above-the-line share ${aboveShare.map((v) => f(v)).join(", ")}`)}` +
    `  above lamp height on the oncoming side: ${aboveShare.map((v) => f(v)).join(" / ")} of the column (both lamps)`);
  console.log(`          ${check(m.i[0] === m.i[1] && m.d[0] === m.d[1], `the lamps differ on main beam: ${JSON.stringify(m)}`)}  both lamps ${f(m.i[0], 0)} cd, ${f(m.d[0], 0)} m`);
  await page.evaluate(() => {
    const e = window.__grnEngine;
    e.highBeam = false; e.highBeamK = 0;
    window.__lbSettle(() => { e.highBeamK = 0; });
  });
  const back = await page.evaluate(() => window.__grnEngine.beamBlend);
  console.log(`          ${check(back === 0, `the cookie stayed at ${back} after main beam went off`)}  back to dipped`);

  // The bulbs: an LED's projector line is sharper, and every bulb keeps
  // its cut-off at the aim.
  const lines = {};
  for (const bulb of ["halogen", "led", "laser"]) {
    await page.evaluate((b) => { const e = window.__grnEngine; e.tune.bulb = b; e.applyBulb(); window.__lbSettle(); }, bulb);
    const a = analyse(await screen(0));
    lines[bulb] = a;
  }
  console.log(`bulbs     ${check(lines.led.spanL < lines.halogen.spanL, `LED line ${f(lines.led.spanL)} deg is not sharper than halogen's ${f(lines.halogen.spanL)}`)}` +
    `  line width halogen ${f(lines.halogen.spanL)} / LED ${f(lines.led.spanL)} / laser ${f(lines.laser.spanL)} deg`);
  console.log(`          ${check(Object.values(lines).every((a) => Math.abs(a.cutL[1] - want) < 0.05), "a bulb moved the cut-off")}` +
    `  cut-off at ${Object.entries(lines).map(([b, a]) => `${b} ${f(a.cutL[1])}`).join(", ")} m`);
  await page.evaluate(() => { const e = window.__grnEngine; e.tune.bulb = "halogen"; e.applyBulb(); window.__lbSettle(); });

  // The mods: a car with one lamp out runs on one, a smoked lens loses a
  // quarter of the light. Driven through fitLampsToCar with the car's
  // own record changed, which is what applyGarage feeds it.
  const mods = await page.evaluate(() => {
    const e = window.__grnEngine;
    const ud = e.carBody.userData;
    const keep = { lamps: ud.lampPositions, mode: ud.headlamps };
    const read = () => { window.__lbSettle(); return [e.headlight.intensity, e.headlightR.intensity]; };
    const stock = read();
    ud.headlamps = "smoked"; e.fitLampsToCar(); const smoked = read();
    ud.headlamps = keep.mode;
    ud.lampPositions = [keep.lamps.reduce((a, b) => (a.x < b.x ? a : b))];
    e.fitLampsToCar(); const single = read();
    ud.lampPositions = keep.lamps; e.fitLampsToCar();
    return { stock, smoked, single, after: read() };
  });
  console.log(`mods      ${check(Math.abs(mods.smoked[0] / mods.stock[0] - 0.75) < 0.01 && Math.abs(mods.smoked[1] / mods.stock[1] - 0.75) < 0.01,
    `a smoked lens gives ${f(mods.smoked[0] / mods.stock[0])} of the light`)}  smoked lens ${f(mods.smoked[0] / mods.stock[0])} of stock`);
  console.log(`          ${check(mods.single[1] === 0 && mods.single[0] === mods.stock[0], `one lamp out: ${mods.single.map((v) => f(v, 0)).join(" + ")} cd`)}` +
    `  one lamp out: ${mods.single.map((v) => f(v, 0)).join(" + ")} cd (stock ${mods.stock.map((v) => f(v, 0)).join(" + ")})`);
  console.log(`          ${check(mods.after[0] === mods.stock[0] && mods.after[1] === mods.stock[1], "the lamps did not come back after the mods")}  restored`);
}

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const m of fail) console.log(`  - ${m}`);
  process.exit(1);
}
console.log("\nthe dipped beam is a dipped beam.");
