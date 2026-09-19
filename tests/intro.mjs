// The menu is a race through a corner, and the loop has no seam.
//
//   npm run dev
//   node tests/intro.mjs
//
// The menu used to be a turntable, then two cars cruising abreast on a
// straight. What it shows now is the game — two cars fighting for one
// long sweeper on the corniche at 137, yours held sideways through it,
// the other tucked up the inside, lamps coming over the roof — and it
// is a LOOP, not a clip: the cars stand still and the world goes round
// them, every prop recycled once it is behind the camera. Nothing fades
// in, nothing is created, and every period in the scene divides the
// eight seconds it takes to come back around.
//
// So this asks the scene, because it cannot ask the picture — WebGL has
// thrown the drawing buffer away by the time a script can read it:
//
//   rolling    the world actually moves, at the speed it claims to
//   speed      and the lamps span the road the loop covers in that time
//   together   lamps, lane markings and tyres all move by the same distance
//   corner     the road bends: a lamp far up the road stands well off the
//              line of one beside the pair, and everything on it is turned
//              to follow it
//   fight      two cars in their own lanes, and the LEAD CHANGES HANDS —
//              more than once a loop, by less than a car length
//   drift      the hero holds an angle against the road, fronts turned
//              the other way, and there is smoke coming off it
//   different  the machine alongside is the next legend's, not a copy
//   seam       the last frame of the loop and the first are one frame
//              apart, not a jump — the check that catches a period that
//              does not divide the loop
//   recycled   a lamp only ever jumps forward, and only behind the camera
//   corniche   water on the inside of the bend, the city skyline across
//              it, palms down the promenade, traffic the other way
//   driver     somebody is driving each car, hands on the rim
//   music      the menu scores itself once the player has touched it —
//              a browser will not start audio before a gesture — with the
//              battle cue, at the volume the settings say
//   still      prefers-reduced-motion gets one frame
//   showroom   the turntable is still there for the capture tool
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

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
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
  headless: true,
});
const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const open = async (extra = {}) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(90000);
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
  await page.evaluate((kv) => {
    localStorage.clear();
    localStorage.setItem("gulf-road-nights-onboarded", "2");
    localStorage.setItem("gulf-road-nights-coach", "3");
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  }, extra);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__grnAttract, null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  return page;
};

const page = await open();

// --- It rolls, and everything in it rolls at the same speed. --------
//
// Not measured against the clock. This suite runs on a software
// rasteriser at a frame or two a second, and the loop clamps its own dt
// so a stalled tab does not teleport the road — so wall time here would
// measure the test box. What has to be true is frame-rate independent:
// the lamps, the lane markings and the tyres all move by the SAME
// distance, and the distance the loop covers in the time it says it
// takes is the speed it claims. Lamps are read by their distance ALONG
// the road (`userData.s`), which the scene keeps on every prop, because
// on a bend a z coordinate is not a distance along anything.
const state = () =>
  page.evaluate(() => {
    const a = window.__grnAttract;
    a.scene.updateMatrixWorld(true);
    const lamps = [];
    let road = 0;
    a.scene.traverse((o) => {
      if (o.name === "lamp") lamps.push({ s: o.userData.s, x: o.position.x, z: o.position.z, yaw: o.rotation.y });
      if (o.name === "road") road = o.material.map.offset.y;
    });
    const car = a.cars[0];
    const w = car.userData.wheels[0];
    let maxY = 0;
    w.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      maxY = Math.max(maxY, Math.abs(o.position.y + b.max.y), Math.abs(o.position.y + b.min.y));
    });
    return {
      travelled: a.travelled,
      loop: a.loopSeconds,
      speed: a.speedMs,
      R: a.bendRadius,
      lamps,
      road,
      spin: w.rotation.x,
      wheelR: maxY * car.scale.y,
      tris: a.triangles,
    };
  });

const s0 = await state();
await page.waitForTimeout(1500);
const s1 = await state();
const SPAN = s0.loop * s0.speed;
const wrap = (d, m) => ((d % m) + m) % m;
const rolled = wrap(s1.travelled - s0.travelled, SPAN);
console.log(
  `rolling   ${check(
    s0.loop > 0 && rolled > 0.5,
    s0.loop <= 0
      ? "the menu built a turntable — the intro is not rolling at all"
      : "the world did not move — the intro is a still with a road painted on it"
  )}  ${rolled.toFixed(1)} m of road, loop ${s0.loop.toFixed(2)} s, ${s1.tris} triangles`
);

// Lamp spacing, straight off the scene: the loop covers the whole span
// of them in loopSeconds, which is what fixes the speed.
const ss = [...new Set(s0.lamps.map((l) => +l.s.toFixed(2)))].sort((a, b) => a - b);
const spacing = ss.length > 2 ? ss[2] - ss[0] : 0;
const speed = SPAN / s0.loop;
console.log(
  `speed     ${check(
    speed > 30 && Math.abs(spacing * (s0.lamps.length / 2) - SPAN) < 1,
    speed <= 30
      ? `${(speed * 3.6).toFixed(0)} km/h is a cruise, not a race`
      : `${s0.lamps.length} lamps ${spacing.toFixed(1)} m apart do not span the ${SPAN} m ` +
        `the loop covers in ${s0.loop} s`
  )}  ${(speed * 3.6).toFixed(0)} km/h — ${s0.lamps.length} lamps, ${spacing.toFixed(0)} m apart`
);

// Everything moves together, or the scene is sliding against itself.
const lampMoved = wrap(s0.lamps[0].s - s1.lamps[0].s, SPAN);
const roadMoved = wrap((s1.road - s0.road) * 15, 15); // 15 m per dash tile
const treadMoved = (s1.spin - s0.spin) * s0.wheelR;
// Distance around the 15 m tile, not along it: a difference a hair below
// zero wraps to 14.999 and reads as a tile out.
const tileGap = Math.min(wrap(roadMoved - rolled, 15), 15 - wrap(roadMoved - rolled, 15));
console.log(
  `together  ${check(
    Math.abs(lampMoved - rolled) < 0.5 &&
      tileGap < 0.5 &&
      Math.abs(treadMoved - rolled) < rolled * 0.12 + 0.2,
    Math.abs(lampMoved - rolled) >= 0.5
      ? `the lamps moved ${lampMoved.toFixed(2)} m while the road moved ${rolled.toFixed(2)}`
      : tileGap >= 0.5
        ? `the lane markings moved ${roadMoved.toFixed(2)} m while the road moved ${rolled.toFixed(2)}`
        : `the tyres laid down ${treadMoved.toFixed(2)} m of tread over ${rolled.toFixed(2)} m of ` +
          `road — they are spinning or dragging`
  )}  road ${rolled.toFixed(2)} m, lamps ${lampMoved.toFixed(2)} m, ` +
    `markings ${roadMoved.toFixed(2)} m, tread ${treadMoved.toFixed(2)} m on a ` +
    `${s0.wheelR.toFixed(2)} m tyre`
);

// --- The road bends. ------------------------------------------------
//
// A lamp far up the road stands well off the line of one beside the
// pair, and its mast is turned to follow the road. On a straight both
// would be zero; on the radius the scene claims, 150 m up the road is
// 4.6 degrees short of 36 off the line.
{
  const near = s0.lamps.reduce((a, l) => (Math.abs(l.s) < Math.abs(a.s) ? l : a));
  const farL = s0.lamps.reduce((a, l) => (Math.abs(l.s - 150) < Math.abs(a.s - 150) ? l : a));
  const sameSide = Math.sign(near.x) === Math.sign(farL.x);
  const off = Math.abs(farL.x - near.x);
  const expected = s0.R > 0 ? s0.R * (1 - Math.cos(150 / s0.R)) : 0;
  const turned = Math.abs(farL.yaw - near.yaw);
  console.log(
    `corner    ${check(
      s0.R > 0 && sameSide && off > 20 && Math.abs(off - expected) < 6 && turned > 0.4,
      s0.R <= 0
        ? "the scene reports no bend — the menu road is straight"
        : off <= 20
          ? `a lamp 150 m up the road is only ${off.toFixed(1)} m off the line — that is not a corner`
          : turned <= 0.4
            ? `the far lamp is not turned to follow the road (${turned.toFixed(2)} rad)`
            : `the far lamp sits ${off.toFixed(1)} m off the line, ${expected.toFixed(1)} expected on a ${s0.R} m radius`
    )}  radius ${s0.R} m, ${off.toFixed(1)} m off the line at 150 m, mast turned ${(turned * 57.3).toFixed(0)}°`
  );
}

// --- Two cars, and a fight. -----------------------------------------
//
// Parked through a whole loop, so the pair is read at every phase: the
// lead has to change hands — a race, not a procession — and never by
// more than a car length; the lateral gap has to stay a lane, because
// two cars that share a lane share a bumper.
const fight = await page.evaluate((steps) => {
  const a = window.__grnAttract;
  const out = [];
  for (let i = 0; i <= steps; i++) {
    a.park(i / steps);
    a.scene.updateMatrixWorld(true);
    const cars = (a.cars ?? []).map((c) => {
      const h = c.parent;
      let paint = null;
      c.traverse((o) => {
        if (paint || !o.isMesh) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m && m.name === "paint" && m.color) paint = m.color.getHexString();
      });
      return { s: h.userData.s ?? 0, x: h.position.x, z: h.position.z, yaw: h.rotation.y, paint };
    });
    out.push(cars);
  }
  a.park(null);
  return out;
}, 32);
const two = fight.every((f) => f.length === 2);
let leadChanges = 0, maxLead = 0, minLat = 99, maxLat = 0;
if (two) {
  // Counted around the loop, not along it: a swap that lands on the
  // wrap is still a swap, and a loop that starts level has one there.
  const signs = [];
  for (const f of fight) {
    const lead = f[0].s - f[1].s;
    maxLead = Math.max(maxLead, Math.abs(lead));
    const sg = Math.sign(lead);
    if (sg !== 0) signs.push(sg);
    const lat = Math.hypot(f[0].x - f[1].x, f[0].z - f[1].z);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  for (let i = 0; i < signs.length; i++) if (signs[i] !== signs[(i + 1) % signs.length]) leadChanges++;
}
console.log(
  `fight     ${check(
    two && leadChanges >= 2 && maxLead > 2 && maxLead < 5 && minLat > 2.4 && maxLat < 6,
    !two
      ? `${fight[0].length} car(s) on the menu — the intro is meant to be two`
      : leadChanges < 2
        ? `the lead changed hands ${leadChanges} time(s) in a loop — a procession, not a race`
        : maxLead <= 2 || maxLead >= 5
          ? `the lead reaches ${maxLead.toFixed(1)} m — ${maxLead <= 2 ? "nobody ever gets ahead" : "that is a pass, not a fight"}`
          : `the cars are ${minLat.toFixed(1)}-${maxLat.toFixed(1)} m apart, which is not a lane`
  )}  lead swaps ${leadChanges}x a loop, up to ${maxLead.toFixed(1)} m; ${minLat.toFixed(1)}-${maxLat.toFixed(1)} m apart`
);
const pair = fight[0];
console.log(
  `different ${check(
    two && pair[0].paint && pair[1].paint && pair[0].paint !== pair[1].paint,
    pair[0]?.paint && pair[0].paint === pair[1]?.paint
      ? `both cars are painted #${pair[0].paint} — the machine alongside is a copy of yours`
      : "could not read the paint off both cars"
  )}  #${pair[0]?.paint} beside #${pair[1]?.paint}`
);

// --- The hero is sideways. ------------------------------------------
//
// A drift is an angle held against the road with the fronts turned the
// other way, and it makes smoke. All three are asked for: the yaw the
// scene reports, the front wheels' own rotation against it, and live
// particles after the loop has been running.
const drift = await page.evaluate(async () => {
  const a = window.__grnAttract;
  a.park(0.3);
  a.scene.updateMatrixWorld(true);
  const car = a.cars[0];
  const wheels = car.userData.wheels ?? [];
  const front = wheels.slice(0, car.userData.wheelPlan?.front ?? 2).map((w) => +w.rotation.y.toFixed(3));
  const yaw = a.driftAngle;
  a.park(null);
  await new Promise((r) => setTimeout(r, 1500));
  return { yaw: +yaw.toFixed(3), front, smoke: a.smoke };
});
const counter = drift.front.length >= 1 && drift.front.every((f) => Math.abs(f) > 0.1 && Math.sign(f) === -Math.sign(drift.yaw));
console.log(
  `drift     ${check(
    Math.abs(drift.yaw) > 0.25 && counter && drift.smoke > 5,
    Math.abs(drift.yaw) <= 0.25
      ? `the hero is held at ${(drift.yaw * 57.3).toFixed(1)}° — that is a line, not a drift`
      : !counter
        ? `the front wheels (${drift.front.join("/")} rad) are not countersteered against a ${drift.yaw} rad yaw`
        : `only ${drift.smoke} smoke particles alive — the tyres are not lit`
  )}  ${(Math.abs(drift.yaw) * 57.3).toFixed(0)}° against the road, fronts at ${drift.front.map((f) => (f * 57.3).toFixed(0) + "°").join("/")}, ${drift.smoke} puffs`
);

// --- The seam that is not there. -------------------------------------
//
// Park the loop either side of the wrap and compare. If every period in
// the scene divides the loop this is one frame of movement; if one of
// them does not, the picture jumps here and only here, which is the
// hardest kind of bug to see and the easiest kind to measure.
const sample = async (phase) =>
  page.evaluate((p) => {
    const a = window.__grnAttract;
    a.park(p);
    a.scene.updateMatrixWorld(true);
    const lamps = [];
    let road = null;
    a.scene.traverse((o) => {
      if (o.name === "lamp") lamps.push(+o.userData.s.toFixed(4));
      if (o.name === "road") road = +o.material.map.offset.y.toFixed(5);
    });
    return {
      lamps,
      road,
      cars: a.cars.map((c) => ({
        x: +c.parent.position.x.toFixed(4),
        y: +c.parent.position.y.toFixed(4),
        z: +c.parent.position.z.toFixed(4),
        roll: +c.parent.rotation.z.toFixed(5),
        yaw: +c.parent.rotation.y.toFixed(5),
      })),
      cam: {
        x: +a.camera.position.x.toFixed(4),
        y: +a.camera.position.y.toFixed(4),
        z: +a.camera.position.z.toFixed(4),
      },
    };
  }, phase);

const DT = 0.01 * s0.loop; // the gap either side of the wrap, in seconds
const inside = await sample(0.985);
const before = await sample(0.995);
const after = await sample(0.005);
const moved = [];
for (let i = 0; i < before.lamps.length; i++) {
  let d = Math.abs(after.lamps[i] - before.lamps[i]);
  if (d > SPAN / 2) d = Math.abs(d - SPAN);
  moved.push(d);
}
const lampJump = Math.max(...moved);
// The cars and the camera MOVE now — the fight carries a car a couple of
// metres fore and aft over a loop — so "did not jump" cannot be "did not
// move": the step across the wrap is compared with the step just inside
// it. Continuous motion takes the same size step either side of the
// join; a period that does not divide the loop takes a different one.
const carStep = (a, b) => Math.max(
  ...a.cars.map((c, i) =>
    Math.max(
      Math.abs(b.cars[i].x - c.x),
      Math.abs(b.cars[i].y - c.y),
      Math.abs(b.cars[i].z - c.z),
      Math.abs(b.cars[i].roll - c.roll),
      Math.abs(b.cars[i].yaw - c.yaw)
    )
  )
);
const camStep = (a, b) => Math.max(
  Math.abs(b.cam.x - a.cam.x),
  Math.abs(b.cam.y - a.cam.y),
  Math.abs(b.cam.z - a.cam.z)
);
const carJump = carStep(before, after);
const carInside = carStep(inside, before);
const camJump = camStep(before, after);
const camInside = camStep(inside, before);
let roadJump = Math.abs(after.road - before.road);
if (roadJump > 0.5) roadJump = Math.abs(roadJump - 1);
roadJump *= 15;
// 2% of the loop at road speed is a few metres of road.
const frameM = s0.speed * DT;
console.log(
  `seam      ${check(
    lampJump < frameM * 2 + 0.05 &&
      carJump < carInside * 1.5 + 0.02 &&
      camJump < camInside * 1.5 + 0.02 &&
      roadJump < frameM * 2 + 0.05,
    lampJump >= frameM * 2 + 0.05
      ? `a lamp is ${lampJump.toFixed(2)} m out across the wrap — the road jumps once a loop`
      : carJump >= carInside * 1.5 + 0.02
        ? `a car steps ${carJump.toFixed(3)} across the wrap against ${carInside.toFixed(3)} just inside it — its fight or its weave does not divide the loop`
        : camJump >= camInside * 1.5 + 0.02
          ? `the camera steps ${camJump.toFixed(3)} m across the wrap against ${camInside.toFixed(3)} inside it`
          : `the lane markings jump ${roadJump.toFixed(2)} m across the wrap`
  )}  lamps ${lampJump.toFixed(3)} m, cars ${carJump.toFixed(4)} (${carInside.toFixed(4)} inside), ` +
    `camera ${camJump.toFixed(4)} m (${camInside.toFixed(4)}), markings ${roadJump.toFixed(3)} m ` +
    `(one frame at this speed is ${frameM.toFixed(2)} m)`
);

// --- And a lamp only ever recycles out of sight. ---------------------
const recycle = await page.evaluate((steps) => {
  const a = window.__grnAttract;
  const seen = [];
  for (let i = 0; i <= steps; i++) {
    a.park(i / steps);
    const ss = [];
    a.scene.traverse((o) => {
      if (o.name === "lamp") ss.push(o.userData.s);
    });
    seen.push(ss);
  }
  a.park(null);
  return { seen, camZ: a.camera.position.z };
}, 240);
let forwardJumps = 0;
let visibleJump = 0;
for (let i = 1; i < recycle.seen.length; i++) {
  for (let k = 0; k < recycle.seen[i].length; k++) {
    const d = recycle.seen[i][k] - recycle.seen[i - 1][k];
    if (d > 1) {
      forwardJumps++;
      // The jump must happen behind the camera. In front of it, a lamp
      // visibly teleports up the road. Near the pair the arc is straight
      // enough that a distance along the road is a z.
      if (recycle.seen[i - 1][k] > recycle.camZ) visibleJump++;
    }
  }
}
console.log(
  `recycled  ${check(
    forwardJumps > 0 && visibleJump === 0,
    forwardJumps === 0
      ? "no lamp ever recycled over a whole loop — the road runs out instead of repeating"
      : `${visibleJump} lamp(s) jumped forward while still in front of the camera`
  )}  ${forwardJumps} recycles over one loop, none of them in shot`
);

// --- It is the corniche, not a road in a void. -----------------------
const place = await page.evaluate(() => {
  const a = window.__grnAttract;
  a.park(0);
  a.scene.updateMatrixWorld(true);
  const names = {};
  let skyline = null;
  let sea = null;
  a.scene.traverse((o) => {
    if (o.name) names[o.name] = (names[o.name] ?? 0) + 1;
    if (o.name === "skyline") {
      skyline = {
        z: +o.position.z.toFixed(1),
        y: +o.position.y.toFixed(2),
        fog: o.material.fog,
        w: o.geometry.parameters.width,
        far: +a.camera.far.toFixed(0),
        wraps: o.material.map.wrapS === 1000,
      };
    }
    if (o.name === "sea") {
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      sea = { y: +o.position.y.toFixed(2), minX: +b.min.x.toFixed(1), maxX: +b.max.x.toFixed(1), w: +(b.max.x - b.min.x).toFixed(0) };
    }
  });
  const onS = (phase) => {
    a.park(phase);
    const ss = [];
    a.scene.traverse((o) => { if (o.name === "oncoming") ss.push(o.userData.s); });
    return ss;
  };
  const z0 = onS(0);
  const z1 = onS(0.02);
  a.park(null);
  return { names, skyline, sea, z0, z1 };
});
console.log(
  `sea       ${check(!!place.sea && place.sea.maxX < 0 && place.sea.y < 0 && place.sea.w > 300,
    "no water on the seaward side of the menu road")}  ` +
    (place.sea ? `${place.sea.w} m of water from x ${place.sea.maxX} out to ${place.sea.minX}, ${place.sea.y} m down` : "none")
);
console.log(
  `skyline   ${check(
    !!place.skyline && place.skyline.fog === false && place.skyline.z < place.skyline.far && place.skyline.wraps,
    !place.skyline
      ? "no city across the water"
      : place.skyline.fog !== false
        ? "the skyline is inside the fog, which will erase it"
        : !place.skyline.wraps
          ? "the skyline does not wrap, so it cannot turn past through the corner"
          : `the skyline sits at ${place.skyline.z} m, past the camera's ${place.skyline.far} m far plane`
  )}  ${place.skyline ? `${place.skyline.w} m wide at ${place.skyline.z} m, fog off, wrapping` : "none"}`
);
console.log(
  `palms     ${check((place.names.palm ?? 0) >= 6,
    `${place.names.palm ?? 0} palms down the promenade`)}  ${place.names.palm ?? 0}`
);
const closing = place.z0.map((z, i) => z - place.z1[i]).filter((d) => Math.abs(d) < SPAN / 2);
console.log(
  `traffic   ${check(
    (place.names.oncoming ?? 0) >= 2 && closing.length > 0 && closing.every((d) => d > 0),
    (place.names.oncoming ?? 0) < 2
      ? "no oncoming traffic — the menu road is closed"
      : "the oncoming traffic is drifting away rather than closing"
  )}  ${place.names.oncoming ?? 0} closing at ` +
    `${closing.length ? (closing[0] / (0.02 * s0.loop)).toFixed(0) : "?"} m/s`
);

// --- And somebody is driving. ----------------------------------------
const hands = await page.evaluate(() => {
  const a = window.__grnAttract;
  a.park(0.25);
  a.scene.updateMatrixWorld(true);
  const out = [];
  for (const car of a.cars) {
    const rig = car.userData.driver;
    if (!rig) { out.push(null); continue; }
    const c = new (Object.getPrototypeOf(rig.wheel.position).constructor)();
    rig.wheel.getWorldPosition(c);
    const grips = rig.arms.map((arm) => {
      const h = new (Object.getPrototypeOf(rig.wheel.position).constructor)();
      arm.hand.getWorldPosition(h);
      return +Math.hypot(h.x - c.x, h.y - c.y, h.z - c.z).toFixed(3);
    });
    const s = car.getWorldScale(new (Object.getPrototypeOf(rig.wheel.position).constructor)());
    out.push({ grips, radius: +(rig.wheelRadius * s.x).toFixed(3) });
  }
  a.park(null);
  return out;
});
const posed = hands.filter(Boolean);
const onRim = posed.every(
  (h) => h.grips.length >= 2 && h.grips.every((g) => Math.abs(g - h.radius) < 0.06)
);
console.log(
  `driver    ${check(
    posed.length === hands.length && posed.length > 0 && onRim,
    posed.length !== hands.length
      ? "a car on the menu has no driver rig in it"
      : `a hand is off the rim: ${JSON.stringify(posed[0])}`
  )}  ${posed.length} driver(s), hands at ` +
    `${posed.map((h) => h.grips.join("/")).join("  ")} against a ${posed[0]?.radius} m rim`
);

// --- The menu scores itself, once touched. ---------------------------
//
// Nothing plays before the first gesture — a browser will not let it —
// and after one the battle cue is on, at the level the settings ask for.
const silent = await page.evaluate(() => !!window.__grnMenuMusic);
await page.mouse.click(1200, 700);
// The score's module is loaded on that first gesture — on a dev server
// that is a compile — so this waits for it rather than for a clock.
let music = null;
for (let i = 0; i < 40 && !music; i++) {
  await page.waitForTimeout(250);
  music = await page.evaluate(() => {
    const m = window.__grnMenuMusic;
    return m ? { mood: m.mood, level: m.level, enabled: m.enabled } : null;
  });
}
console.log(
  `music     ${check(
    !silent && !!music && music.mood === "battle" && music.level > 0.05,
    silent
      ? "the menu started music before anybody touched it"
      : !music
        ? "a click on the menu started no music"
        : music.mood !== "battle"
          ? `the menu is scored with the "${music.mood}" cue, not the battle`
          : `the menu music is at level ${music.level}`
  )}  ${music ? `${music.mood} cue at ${music.level} after the first click` : "none"}`
);

await page.close();

// --- Reduced motion draws once and stops. ----------------------------
{
  const still = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
  });
  still.setDefaultTimeout(90000);
  await still.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
  await still.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("gulf-road-nights-onboarded", "2");
    localStorage.setItem("gulf-road-nights-coach", "3");
  });
  await still.reload({ waitUntil: "networkidle" });
  await still.waitForFunction(() => !!window.__grnAttract, null, { timeout: 90000 });
  const frozen = await still.evaluate(async () => {
    const a = window.__grnAttract;
    const f0 = a.frames;
    await new Promise((r) => setTimeout(r, 900));
    return { f0, f1: a.frames, tris: a.triangles };
  });
  console.log(
    `still     ${check(
      frozen.f1 === frozen.f0 && frozen.tris > 5000,
      frozen.f1 !== frozen.f0
        ? `the intro drew ${frozen.f1 - frozen.f0} more frames with reduced motion asked for`
        : `only ${frozen.tris} triangles in the one frame it did draw`
    )}  one frame, ${frozen.tris} triangles, and then nothing`
  );
  await still.close();
}

// --- The turntable is still there for the capture tool. --------------
{
  const shop = await open({ "gulf-road-nights-attract": "turntable" });
  const t = await shop.evaluate(async () => {
    const a = window.__grnAttract;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const a0 = a.angle;
    await wait(900);
    const swept = Math.abs(a.angle - a0);
    a.park(0.72);
    await wait(300);
    const p0 = a.angle;
    await wait(400);
    return { loop: a.loopSeconds, cars: a.cars.length, swept, parked: Math.abs(a.angle - p0) };
  });
  console.log(
    `showroom  ${check(
      t.loop === 0 && t.cars === 1 && t.swept > 0.001 && t.parked < 1e-6,
      t.loop !== 0
        ? "asking for the turntable still built the rolling loop"
        : t.cars !== 1
          ? `${t.cars} cars on the turntable — a showroom card wants one`
          : t.swept <= 0.001
            ? "the turntable does not turn"
            : "park() no longer holds the turntable still, so the cards are caught at fifteen different angles"
    )}  one car, sweeps ${t.swept.toFixed(3)} rad, dead still when parked`
  );
  await shop.close();
}

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
