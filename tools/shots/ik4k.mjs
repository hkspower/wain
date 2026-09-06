// The rig, at 4K, doing the things it does.
//
//   npm run dev
//   node tools/shots/ik4k.mjs            # zeta-300-gtr
//   CAR=kaiju-r node tools/shots/ik4k.mjs
//   TIER=high node tools/shots/ik4k.mjs  # if ultra is too slow headless
//   SHOTS=lock,brake node tools/shots/ik4k.mjs   # re-render some
//
// Six 3840x2160 stills into press/ik/4k/, each staged so the picture is
// evidence rather than decoration: full lock with the two fronts at
// their Ackermann angles, the Ras Al-Ard sweep with the shell rolled and
// every hub still on the road beside a rival doing the same, a 200 km/h
// stop with the nose down and the airbrake up, a drift with the yaw on
// the body and the wheels turning at the road's speed along the car's
// own axis, a civilian taking a set through the same bend, and the
// driver through the glass at lock. The numbers behind each frame are
// written next to it in README.md, read off the engine at the moment of
// the exposure — a still that only looks right is worth nothing here.
//
// Rendered through the game's own 4K pin (setResolution(2160)) and the
// ultra tier, which is what a 4K panel gets: 4096/16384 shadow maps,
// the 512 live paint probe, 4x MSAA. Headless SwiftShader takes a while
// per frame at this size; that is the cost of not faking it.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

const CAR = process.env.CAR ?? "zeta-300-gtr";
const TIER = process.env.TIER ?? "ultra";
const W = 3840, H = 2160;
const OUT = process.env.OUT ?? "press/ik/4k";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.setDefaultTimeout(600000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0);
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnEngine, null, { timeout: 600000 });
console.log(`booted in ${secs()} s`);

await page.evaluate(async ({ car, tier }) => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.setSky("night");
  localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
    car, cars: [car], owned: [], kd: 99999,
    equipped: { paint: "paint-red", glow: "glow-none" },
  }));
  e.applyGarage();
  e.applyQualityTier(tier);
  e.setResolution(2160);
  await new Promise((r) => setTimeout(r, 300));
}, { car: CAR, tier: TIER });

// The authored shells and wheels arrive as async fetches; a 4K still of
// the procedural stand-ins would be a still of the wrong car.
await page.waitForFunction(() => {
  const e = window.__grnEngine;
  let shells = 0, authored = 0;
  e.carBody.traverse((o) => {
    if (o.isMesh && o.userData.shell) { shells++; if (o.geometry.userData.authored) authored++; }
  });
  return shells > 0 && authored === shells;
}, null, { timeout: 120000 }).catch(() => console.log("(authored shells did not all arrive; rendering what is there)"));
console.log(`car ${CAR} on, tier ${TIER}, 4K pinned, ${secs()} s`);

/**
 * Stage a scene on the page, place the camera, render once, and read
 * the rig's state at that exact frame. `stage` runs inside the page and
 * returns { cam: [x,y,z], look: [x,y,z], note } in world space; the
 * helpers it gets are the car's own axes so it never has to know which
 * way the road runs.
 */
const ONLY = (process.env.SHOTS ?? "").split(",").filter(Boolean);
const shoot = async (name, stageSrc) => {
  if (ONLY.length && !ONLY.includes(name)) return null;
  const t = Date.now();
  const r = await page.evaluate(async ({ src, name }) => {
    const e = window.__grnEngine;
    const THREE = window.__grnThree;
    const V = THREE.Vector3;
    const body = e.carBody;
    const axes = (mesh) => {
      mesh.updateWorldMatrix(true, true);
      const m = mesh.matrixWorld;
      return {
        pos: new V().setFromMatrixPosition(m),
        // The shell is built facing +z; its +x is one side, its +y its up.
        fwd: new V().setFromMatrixColumn(m, 2).setY(0).normalize(),
        side: new V().setFromMatrixColumn(m, 0).setY(0).normalize(),
        up: new V().setFromMatrixColumn(m, 1).normalize(),
      };
    };
    const tilt = (mesh) => {
      mesh.updateWorldMatrix(true, true);
      const x = new V().setFromMatrixColumn(mesh.matrixWorld, 0).normalize();
      const z = new V().setFromMatrixColumn(mesh.matrixWorld, 2).normalize();
      return { roll: Math.asin(x.y), pitch: -Math.asin(z.y) };
    };
    const hubs = (mesh) => {
      const R = mesh.userData.wheelR;
      return mesh.userData.wheels.map((w) => {
        w.updateWorldMatrix(true, false);
        return +(new V().setFromMatrixPosition(w.matrixWorld).y - mesh.position.y - R).toFixed(4);
      });
    };
    const fronts = (mesh) => mesh.userData.wheels.slice(0, 2).map((w) => +w.rotation.y.toFixed(3));
    const stage = new Function("e", "THREE", "V", "axes", "tilt", "hubs", "fronts", `return (async () => { ${src} })();`);
    const s = await stage(e, THREE, V, axes, tilt, hubs, fronts);
    const cam = e.camera;
    cam.position.set(...s.cam);
    cam.lookAt(...s.look);
    cam.fov = s.fov ?? 34;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    e.composer.render();
    const state = {
      roll: +(e.roll * 180 / Math.PI).toFixed(2),
      pitch: +(e.pitch * 180 / Math.PI).toFixed(2),
      yaw: +(e.driftYaw * 180 / Math.PI).toFixed(1),
      fronts: fronts(body),
      hubs: hubs(body),
      wing: body.userData.wing ? +body.userData.wing.rotation.x.toFixed(3) : null,
      speedKmh: +(e.player.speed * 3.6).toFixed(0),
      latAccel: +e.latAccel.toFixed(2),
      buffer: e.renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(),
      ...s.note,
    };
    return { png: e.renderer.domElement.toDataURL("image/png"), state, name };
  }, { src: stageSrc, name });
  const png = Buffer.from(r.png.split(",")[1], "base64");
  writeFileSync(`${OUT}/${name}.png`, png);
  await sharp(png).jpeg({ quality: 94, chromaSubsampling: "4:4:4" }).toFile(`${OUT}/${name}.jpg`);
  // The measurement beside the picture, so a partial re-render still
  // leaves README.md telling the truth about every frame.
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ car: CAR, tier: TIER, ...r.state }, null, 1) + "\n");
  console.log(`${name.padEnd(8)} ${((Date.now() - t) / 1000).toFixed(0)} s  ${JSON.stringify(r.state)}`);
  return r.state;
};

const results = {};

// 1. Full lock, nearly stopped: the two fronts at their Ackermann angles.
results.lock = await shoot("lock", `
  e.player.s = 2400; e.player.lat = 0; e.player.speed = 4;
  e.heading = 0; e.driftYaw = 0;
  for (let i = 0; i < 80; i++) { e.setTouchInput({ steer: 1, throttle: 0.15, brake: 0 }); e.update(1/60); e.player.speed = 4; e.player.lat = 0; }
  const a = axes(e.carBody);
  // From ahead, on the side the wheels point to, low. The wheel group's
  // own z axis spins with the tyre, so the direction the tread points is
  // the car's forward turned through the steer angle about its up.
  const steerY = e.carBody.userData.wheels[0].rotation.y;
  const wf = a.fwd.clone().applyAxisAngle(a.up, steerY).setY(0).normalize();
  const cam = a.pos.clone().add(wf.clone().multiplyScalar(6.5)).add(a.fwd.clone().multiplyScalar(1.5));
  cam.y = a.pos.y + 0.75;
  return { cam: cam.toArray(), look: [a.pos.x, a.pos.y + 0.55, a.pos.z], fov: 30, note: { scene: "full lock at 15 km/h, front quarter" } };
`);

// 2. The sweep: shell rolled, hubs on the road, a rival leaning beside.
results.sweep = await shoot("sweep", `
  e.rivalIndex = 3; e.spawnRival();
  const r = e.rival;
  const away = e.track.wrap(3060 + e.track.length / 2);
  for (const t of e.traffic) t.s = away;
  e.roll = 0; e.rollVel = 0; e.pitch = 0; e.pitchVel = 0; e.heading = 0; e.driftYaw = 0; e.prevBeta = 0;
  // 33 m/s is what the cruise AI itself wants with the player this
  // close, so holding it there measures a rival driving, not one being
  // governed down (which would raise its brake and its airbrake).
  r.state = "cruise"; r.lat = 3.4; r.targetLat = 3.4;
  for (let i = 0; i < 90; i++) {
    e.player.s = 3040 + i * 0.55; e.player.lat = 0; e.player.speed = 33; e.prevSpeed = 33;
    r.s = e.player.s + 0.8; r.speed = 33; r.sp = 100;
    e.setTouchInput({ steer: 0, throttle: 0, brake: 0 }); e.update(1/60);
  }
  const a = axes(e.carBody);
  // The shell leans OUT of the corner; the camera stands on that side,
  // ahead and low, so both cars' near flanks show their squat.
  // Well off the headlamps' axis, or the frame is two beams and no car.
  const outside = a.side.clone().multiplyScalar(Math.sign(a.up.dot(a.side)) || 1);
  const rp = new V().setFromMatrixPosition(r.mesh.matrixWorld);
  const mid = a.pos.clone().add(rp).multiplyScalar(0.5);
  // Stays on the tarmac: past about 6 m the camera is behind the rail.
  const cam = mid.clone().add(a.fwd.clone().multiplyScalar(7)).add(outside.multiplyScalar(-5.5));
  cam.y = a.pos.y + 1.1;
  const rt = tilt(r.mesh);
  return { cam: cam.toArray(), look: [mid.x, a.pos.y + 0.55, mid.z], fov: 46,
    note: { scene: "Ras Al-Ard at 120 km/h, wheel straight", rival: r.def.carId, rivalRoll: +(rt.roll*180/Math.PI).toFixed(2), rivalHubs: hubs(r.mesh), rivalFronts: fronts(r.mesh), rivalWing: r.mesh.userData.wing ? +r.mesh.userData.wing.rotation.x.toFixed(3) : null } };
`);

// 3. A 200 km/h stop: nose down, airbrake up, lamps lit.
results.brake = await shoot("brake", `
  const r = e.rival; if (r) { r.s = e.track.wrap(e.player.s + e.track.length / 2); }
  e.player.s = 2400; e.player.lat = 0; e.heading = 0; e.driftYaw = 0;
  e.roll = 0; e.rollVel = 0; e.pitch = 0; e.pitchVel = 0;
  e.player.speed = 200 / 3.6; e.prevSpeed = e.player.speed;
  for (let i = 0; i < 6; i++) { e.setTouchInput({ steer: 0, throttle: 0, brake: 0 }); e.update(1/60); e.player.speed = 200/3.6; e.player.lat = 0; }
  for (let i = 0; i < 22; i++) { e.setTouchInput({ steer: 0, throttle: 0, brake: 1 }); e.update(1/60); e.player.lat = 0; }
  const a = axes(e.carBody);
  const cam = a.pos.clone().add(a.fwd.clone().multiplyScalar(-7.5)).add(a.side.clone().multiplyScalar(3.2));
  cam.y = a.pos.y + 1.35;
  return { cam: cam.toArray(), look: [a.pos.x, a.pos.y + 0.7, a.pos.z], fov: 34, note: { scene: "braking from 200 km/h, rear quarter" } };
`);

// 4. Sideways: the yaw on the shell, the hubs still on the road.
results.drift = await shoot("drift", `
  e.player.s = 2400; e.player.lat = 0; e.player.speed = 240 / 3.6;
  e.heading = 0; e.steerSmooth = 0; e.slipVel = 0;
  Object.assign(e.ds, window.__grnDriftModel.newDriftState());
  e.touch.drift = true;
  let frames = 0;
  while (frames < 360 && Math.abs(e.driftYaw) < 0.55) {
    e.player.speed = Math.max(20, e.player.speed);
    e.setTouchInput({ steer: 1, throttle: 1, brake: 0 });
    e.update(1/60); e.player.lat = 0; frames++;
  }
  e.touch.drift = false;
  const a = axes(e.carBody);
  // Behind and to the outside of the slide, chase height.
  const cam = a.pos.clone().add(a.fwd.clone().multiplyScalar(-6.5)).add(a.side.clone().multiplyScalar(-Math.sign(e.driftYaw) * 4));
  cam.y = a.pos.y + 1.6;
  return { cam: cam.toArray(), look: [a.pos.x, a.pos.y + 0.5, a.pos.z], fov: 34, note: { scene: "drift, " + frames + " frames in" } };
`);

// 5. A civilian through the same bend, taking a set.
results.traffic = await shoot("traffic", `
  e.touch.drift = false; e.setTouchInput({ steer: 0, throttle: 0, brake: 0 });
  e.heading = 0; e.driftYaw = 0; e.roll = 0; e.rollVel = 0; e.pitch = 0; e.pitchVel = 0;
  const t = e.traffic[0];
  const away = e.track.wrap(3060 + e.track.length / 2);
  for (const o of e.traffic) if (o !== t) o.s = away;
  if (e.rival) e.rival.s = away;
  t.lat = 0;
  for (let i = 0; i < 90; i++) {
    t.s = 3040 + i * 0.55; t.speed = 33;
    e.player.s = t.s - 9; e.player.lat = 3.4; e.player.speed = 33; e.prevSpeed = 33;
    e.update(1/60);
  }
  const a = axes(t.mesh);
  const outside = a.side.clone().multiplyScalar(Math.sign(a.up.dot(a.side)) || 1);
  const cam = a.pos.clone().add(a.fwd.clone().multiplyScalar(7)).add(outside.multiplyScalar(-4.5));
  cam.y = a.pos.y + 0.6;
  const tt = tilt(t.mesh);
  return { cam: cam.toArray(), look: [a.pos.x, a.pos.y + 0.55, a.pos.z], fov: 32,
    note: { scene: "a civilian through Ras Al-Ard at 120 km/h", trafficRoll: +(tt.roll*180/Math.PI).toFixed(2), trafficHubs: hubs(t.mesh), trafficFronts: fronts(t.mesh) } };
`);

// 6. The driver at lock, through the glass. Daylight, or the cabin is a
// black box.
results.driver = await shoot("driver", `
  e.timeHours = 12.5; e.world.setTimeOfDay(12.5); e.applyDaylight();
  e.player.s = 2400; e.player.lat = 0; e.player.speed = 6; e.heading = 0; e.driftYaw = 0;
  for (let i = 0; i < 50; i++) { e.setTouchInput({ steer: 0.85, throttle: 0.1, brake: 0 }); e.update(1/60); e.player.speed = 6; e.player.lat = 0; }
  const rig = e.carBody.userData.driver;
  rig.group.updateWorldMatrix(true, true);
  const p = new V().setFromMatrixPosition(rig.group.matrixWorld);
  const a = axes(e.carBody);
  // Square-on to the side glass at window height: at a grazing angle the
  // glass is a mirror.
  // On the sunlit side, or the cabin is a silhouette: pick the flank
  // whose outward normal faces the sun.
  const sunSide = a.side.clone().multiplyScalar(Math.sign(a.side.dot(e.world.moonLight.position)) || 1);
  const cam = p.clone().add(sunSide.multiplyScalar(3.6)).add(a.fwd.clone().multiplyScalar(0.3)); cam.y = p.y + 0.85;
  const look = p.clone().add(a.fwd.clone().multiplyScalar(0.05)); look.y = p.y + 0.25;
  return { cam: cam.toArray(), look: look.toArray(), fov: 30, note: { scene: "driver at 85% lock, through the side glass", handWheel: +rig.wheel.rotation.z.toFixed(2) } };
`);

await browser.close();

const lines = [
  "# The rig at 4K",
  "",
  `Six 3840x2160 frames of the ${CAR}, rendered by tools/shots/ik4k.mjs through the game's own 4K pin at the ${TIER} tier. `,
  "Every number is read off the engine at the frame of the exposure — the picture is evidence, the caption is the measurement.",
  "",
  "| frame | what the rig is doing | measured |",
  "|---|---|---|",
];
const fmt = (s) => {
  const parts = [];
  if (s.fronts) parts.push(`fronts ${s.fronts.join(" / ")} rad`);
  if (typeof s.roll === "number") parts.push(`roll ${s.roll}°, pitch ${s.pitch}°`);
  if (s.yaw) parts.push(`yaw ${s.yaw}°`);
  if (s.hubs) parts.push(`hubs off road ${s.hubs.map((h) => (h * 1000).toFixed(1)).join("/")} mm`);
  if (s.wing !== null && s.wing !== undefined) parts.push(`wing ${s.wing} rad`);
  if (s.rivalRoll !== undefined) parts.push(`rival ${s.rival} roll ${s.rivalRoll}°, hubs ${s.rivalHubs.map((h) => (h * 1000).toFixed(1)).join("/")} mm, fronts ${s.rivalFronts.join(" / ")}, wing ${s.rivalWing}`);
  if (s.trafficRoll !== undefined) parts.push(`civilian roll ${s.trafficRoll}°, hubs ${s.trafficHubs.map((h) => (h * 1000).toFixed(1)).join("/")} mm, fronts ${s.trafficFronts.join(" / ")}`);
  if (s.handWheel !== undefined) parts.push(`hand wheel ${s.handWheel} rad`);
  parts.push(`${s.speedKmh} km/h, ${s.latAccel} m/s² lateral, buffer ${s.buffer.join("x")}`);
  return parts.join("; ");
};
for (const name of ["lock", "sweep", "brake", "drift", "traffic", "driver"]) {
  const f = `${OUT}/${name}.json`;
  if (!existsSync(f)) continue;
  const s = JSON.parse(readFileSync(f, "utf8"));
  lines.push(`| [${name}](${name}.jpg) | ${s.scene} | ${fmt(s)} |`);
}
lines.push("", "The .png files are the lossless frames (kept out of git); the .jpg copies are what the repository tracks, and each frame's .json is the state it was read from.", "");
writeFileSync(`${OUT}/README.md`, lines.join("\n"));
console.log(`\nwrote ${Object.keys(results).length} frames to ${OUT}/ in ${secs()} s`);
