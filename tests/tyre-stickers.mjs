// The tyre sticker package.
//
//   npm run test:tyre-stickers      (no browser, no dev server)
//
// Sidewall lettering is cosmetic, which makes it the easiest kind of part
// to get quietly wrong: nothing about the car's behaviour changes, so a
// bug shows up only as an absence nobody notices. The things worth
// asserting are the ones that would leave a player having paid for
// something they cannot see, or having lost something they did not mean
// to sell.

import * as THREE from "three";
import { PARTS, EXCLUSIVE_CATS, computeEffects } from "../src/game/mods.ts";
import { readFileSync } from "node:fs";
import "./lib/dom-stub.mjs";
import { createCar, tyreBandFor, WHEEL_R_K, WHEEL_W_K } from "../src/game/cars.ts";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };

const sidewalls = PARTS.filter((p) => p.cat === "sidewall");

// --- 1. The package is in the catalogue and priced ---------------------
{
  check(sidewalls.length >= 3, `only ${sidewalls.length} lettering options`);
  for (const p of sidewalls) {
    check(p.price > 0, `${p.id} is free`);
    check(/[؀-ۿ]/.test(p.ar), `${p.id} has no Arabic name`);
    check(p.desc.length > 10, `${p.id} has no description`);
    // Cosmetic parts must say so. A player reading "Raised White Letters"
    // beside a Sport Tires entry that buys real grip is entitled to know
    // which kind of part this is before spending on it.
    check(/[Cc]osmetic|Changes nothing/.test(p.desc),
      `${p.id} does not say it is cosmetic — it sits in a shop full of parts that are not`);
  }
  console.log(`${sidewalls.length} lettering options, ${sidewalls.map((p) => p.price).join("/")} KD, all declared cosmetic`);
}

// --- 2. Lettering is its own slot, not the tyre compound ---------------
// The failure this prevents: a player buys slicks, then buys lettering,
// and the shop quietly takes the slicks off because both were "tires".
{
  check(EXCLUSIVE_CATS.has("sidewall"), "lettering must be an exclusive slot — you wear one at a time");
  check(EXCLUSIVE_CATS.has("tires"), "sanity: the compound slot still exists");
  for (const p of sidewalls) check(p.cat !== "tires", `${p.id} must not share the compound's slot`);
  const compounds = PARTS.filter((p) => p.cat === "tires");
  check(compounds.length > 0, "sanity: there are still tyre compounds to buy");
  console.log(`${compounds.length} compounds and ${sidewalls.length} letterings, in two slots that do not evict each other`);
}

// --- 3. Buying it changes nothing about how the car drives -------------
// The claim the description makes, checked rather than trusted.
{
  const base = { cars: ["wain-special"], car: "wain-special", kd: 0, builds: {} };
  const build = (owned) => ({
    ...base,
    builds: { "wain-special": { owned, equipped: Object.fromEntries(owned.map((id) => {
      const p = PARTS.find((q) => q.id === id);
      return [p.cat, id];
    })) } },
  });
  const plain = computeEffects(build([]));
  const lettered = computeEffects(build(["sidewall-rwl"]));
  const DRIVING = ["gripAccel", "brakeForce", "powerMult", "accelMult", "topSpeedKmh",
    "tractionMult", "understeerMult", "rollMax", "crashResist", "downforce"];
  for (const k of DRIVING) {
    check(plain[k] === lettered[k],
      `lettering changed ${k}: ${plain[k]} -> ${lettered[k]} — it is meant to be cosmetic`);
  }
  check(lettered.tyreSticker === "rwl", `the sticker must reach the car, got ${lettered.tyreSticker}`);
  check(plain.tyreSticker === undefined, "a bare tyre must carry no lettering");
  console.log(`${DRIVING.length} driving figures identical with and without lettering; the sticker still reaches the car`);
}

// --- 4. Every option maps to something the wheel can draw --------------
{
  const cars = readFileSync("src/game/cars.ts", "utf8");
  for (const p of sidewalls) {
    const id = p.id.replace("sidewall-", "");
    check(new RegExp(`\\b${id}:\\s*\\{`).test(cars),
      `${p.id} has no entry in TYRE_STICKERS — it would sell a sticker the wheel cannot draw`);
  }
  // ...and nothing in the table is unreachable from the shop.
  const declared = [...cars.matchAll(/^  (\w+): \{ ink:/gm)].map((m) => m[1]);
  for (const d of declared) {
    check(sidewalls.some((p) => p.id === `sidewall-${d}`),
      `TYRE_STICKERS.${d} is drawn by nothing in the catalogue`);
  }
  console.log(`${declared.length} letterings in the table, ${sidewalls.length} on sale, and the two sets match`);
}

// --- 5. It builds, on every car, and goes on the face you can see -----
// Checked by BUILDING the cars, not by reading the source: the band once
// asked the tyre section for a point it does not have (18..21 of 0..20)
// and every car fitted with lettering threw on build, while a check of
// the source text stayed green. And a band mirrored for the left wheels
// read backwards there.
{
  const STYLES = ["sedan", "zx", "gtr", "rx7", "hatch", "pony", "pickup", "super", "suv"];
  const ray = new THREE.Raycaster();
  const dbl = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  let wheels = 0, worstGap = 0, minGap = Infinity;
  for (const style of STYLES) {
    for (const trike of [false, true]) {
      if (trike && style !== "gtr") continue; // the Black Demon: a delta trike on the gtr body
      for (const sticker of [undefined, "rwl", "retro", "moulded"]) {
        let car;
        try {
          car = createCar({ style, body: 0x9c1c2c, accent: 0x222222, kit: "street", tyreSticker: sticker, trike });
        } catch (e) {
          check(false, `${style}${trike ? " trike" : ""} with ${sticker ?? "no"} lettering does not build: ${e.message}`);
          continue;
        }
        car.updateMatrixWorld(true);
        for (const w of car.userData.wheels ?? []) {
          const bands = w.children.filter((o) => o.userData.wheelPart === "tire-sticker");
          const tyre = w.children.find((o) => o.userData.wheelPart === "tire");
          if (!sticker) { check(bands.length === 0, `${style}: a bare tyre carries lettering`); continue; }
          check(bands.length === 1, `${style} ${sticker}: ${bands.length} bands on one wheel`);
          if (bands.length !== 1) continue;
          wheels++;
          const band = bands[0], side = band.userData.wheelSide, out = side < 0 ? -1 : 1;
          const g = band.geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
          // Faces outboard, on the outboard side, never scaled to a mirror.
          let nx = 0, px = 0;
          for (let k = 0; k < pos.count; k++) { nx += nor.getX(k); px += pos.getX(k); }
          check(Math.sign(nx) === out && Math.sign(px) === out, `${style} ${sticker}: band not on and facing the outboard face (side ${side})`);
          check(band.scale.x > 0, `${style} ${sticker}: band mirrored by scale, which reads backwards`);
          // Sits on the rubber: a ray back along each vertex normal meets the tyre a few mm away.
          const tm = new THREE.Mesh(tyre.geometry, dbl);
          tm.updateMatrixWorld(true);
          for (let k = 0; k < pos.count; k += 37) {
            const p = new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k));
            const n = new THREE.Vector3(nor.getX(k), nor.getY(k), nor.getZ(k)).normalize();
            ray.set(p.clone().addScaledVector(n, 0.05), n.clone().negate());
            const h = ray.intersectObject(tm, false)[0];
            const gap = h ? h.distance - 0.05 : Infinity;
            worstGap = Math.max(worstGap, gap); minGap = Math.min(minGap, gap);
          }
          // Reads from outside: at the top of the wheel u grows toward the
          // viewer's right (-z seen from +x, +z from -x), v grows outward.
          let du = 0, dv = 0;
          for (let k = 0; k < pos.count; k++) {
            const y = pos.getY(k), z = pos.getZ(k);
            if (y < 0.9 * Math.hypot(y, z) || Math.abs(z) > 0.05) continue;
            for (let m = k + 1; m < Math.min(pos.count, k + 400); m++) {
              const y2 = pos.getY(m), z2 = pos.getZ(m);
              if (y2 < 0.9 * Math.hypot(y2, z2) || Math.abs(z2) > 0.05) continue;
              const dU = uv.getX(m) - uv.getX(k), dV = uv.getY(m) - uv.getY(k);
              if (Math.abs(dU) > 0.5) continue; // the seam
              du += dU * Math.sign(-out * (z2 - z) || 1) * (Math.abs(z2 - z) > 1e-4 ? 1 : 0);
              dv += dV * Math.sign(Math.hypot(y2, z2) - Math.hypot(y, z) || 1) * (Math.abs(Math.hypot(y2, z2) - Math.hypot(y, z)) > 1e-4 ? 1 : 0);
            }
          }
          check(du > 0, `${style} ${sticker} side ${side}: lettering reads backwards`);
          check(dv > 0, `${style} ${sticker} side ${side}: lettering is upside down (tops toward the hub)`);
        }
      }
    }
  }
  check(wheels > 0, "no lettered wheel was built");
  check(minGap > 0.0005 && worstGap < 0.008, `the band is ${(minGap * 1000).toFixed(1)}-${(worstGap * 1000).toFixed(1)} mm off the rubber; it should sit just proud of it`);
  console.log(`${wheels} lettered wheels built on ${STYLES.length} styles (and the trike): all outboard, reading left to right, tops to the tread, ${(minGap * 1000).toFixed(1)}-${(worstGap * 1000).toFixed(1)} mm proud of the rubber`);
  // Baked into the tread texture it would repeat TREAD_BLOCKS times.
  const cars = readFileSync("src/game/cars.ts", "utf8");
  check(!/tyreSticker|TYRE_STICKERS/.test(cars.slice(cars.indexOf("function tireSurface"), cars.indexOf("const canvas = ()"))),
    "lettering must not be baked into the tread texture — it repeats 18 times around");
}

// --- 5b. ...and on the AUTHORED tyre a hero car ends up wearing --------
// models.ts swaps public/models/wheel-5/6.glb in once it loads, and that
// sidewall is not the lathed one: a band lathed from the section sat 15 to
// 25 mm off it. The band is fitted to whichever tyre it is on; check it on
// the authored ones, scaled and mirrored the way models.ts does.
{
  const loader = new GLTFLoader();
  const ray = new THREE.Raycaster();
  for (const f of ["wheel-5", "wheel-6"]) {
    const buf = readFileSync(`public/models/${f}.glb`);
    const gltf = await new Promise((res, rej) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", res, rej));
    gltf.scene.updateMatrixWorld(true);
    let tyre = null;
    gltf.scene.traverse((o) => { if (o.isMesh && o.name.toLowerCase() === "tire") { tyre = o.geometry.clone(); tyre.applyMatrix4(o.matrixWorld); } });
    check(tyre !== null, `${f}: no Tire mesh`);
    if (!tyre) continue;
    tyre.scale(WHEEL_W_K, WHEEL_R_K, WHEEL_R_K);
    const left = tyre.clone(); left.scale(-1, 1, 1);
    for (const [geo, out] of [[tyre, 1], [left, -1]]) {
      const band = tyreBandFor(geo, out);
      check(band !== null, `${f}: no band could be fitted (side ${out})`);
      if (!band) continue;
      const tm = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      tm.updateMatrixWorld(true);
      const pos = band.attributes.position, nor = band.attributes.normal;
      let lo = Infinity, hi = -Infinity, miss = 0;
      for (let k = 0; k < pos.count; k += 11) {
        const p = new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k));
        const n = new THREE.Vector3(nor.getX(k), nor.getY(k), nor.getZ(k)).normalize();
        ray.set(p.clone().addScaledVector(n, 0.05), n.clone().negate());
        const h = ray.intersectObject(tm, false)[0];
        if (!h) { miss++; continue; }
        lo = Math.min(lo, h.distance - 0.05); hi = Math.max(hi, h.distance - 0.05);
      }
      check(miss === 0 && lo > 0.0005 && hi < 0.008, `${f} side ${out}: band ${(lo * 1000).toFixed(1)}-${(hi * 1000).toFixed(1)} mm off the authored rubber, ${miss} misses`);
      let nx = 0; for (let k = 0; k < nor.count; k++) nx += nor.getX(k);
      check(Math.sign(nx) === out, `${f} side ${out}: band does not face outboard`);
      console.log(`${f} ${out > 0 ? "right" : "left "}: band ${(lo * 1000).toFixed(1)}-${(hi * 1000).toFixed(1)} mm proud of the authored rubber`);
    }
  }
}

// --- 6. Black rubber ---------------------------------------------------
// A tyre came out mid-grey in every studio render: a sidewall roughness
// of 0.6 and an environment share of 2.4 threw back every light in the
// scene. Rubber reflects less than paint; these are the numbers that say
// so, without going so far the other way that the sidewall loses its shape.
{
  const car = createCar({ style: "sedan", body: 0x9c1c2c, accent: 0x222222, kit: "street" });
  let mat = null;
  car.traverse((o) => { if (o.isMesh && o.userData.wheelPart === "tire") mat = o.material; });
  check(mat !== null, "no tyre material");
  if (mat) {
    check(mat.envMapIntensity <= 1.5, `tyre envMapIntensity ${mat.envMapIntensity}: rubber should take a faint share of the sky (it was 2.4)`);
    check((mat.specularIntensity ?? 1) <= 0.8, `tyre specular ${mat.specularIntensity}: rubber reflects less than paint`);
    check(mat.roughness === 1 && !!mat.roughnessMap, "the roughness map should carry the range");
    console.log(`tyre: envMapIntensity ${mat.envMapIntensity}, specular ${mat.specularIntensity}, roughness from its map`);
  }
  const src = readFileSync("src/game/cars.ts", "utf8");
  const body = src.slice(src.indexOf("function tireSurface"), src.indexOf("const map = new THREE.CanvasTexture(colC);"));
  const r = body.match(/const r = sidewall \? ([\d.]+) \+/);
  // 0.6 read grey under studio light; 0.8 a flat black disc. Satin between.
  check(r && parseFloat(r[1]) >= 0.68 && parseFloat(r[1]) <= 0.76, `sidewall roughness floor ${r?.[1]}: the satin is 0.68-0.76`);
}

// --- 7. Normal maps that survive the export --------------------------
// Both tyre normal maps are canvases (flipY on) with no tangent attribute.
// three reads green along +dv; GLTFExporter flips the image rows and writes
// normalTexture.scale from normalScale.x only, so a map authored for
// three's frame comes out of the GLB with its green reversed against the
// glTF convention (+Y = image up) — the Blender and Max renders had the
// lettering sunk where the game had it raised. So both maps are authored
// in the glTF convention (green from -dy, canvas rows running down) and
// the materials carry a NEGATIVE normalScale.y, which is exactly what
// GLTFLoader does for a derivative tangent frame (it flips normalScale.y).
// The game and the export then agree.
{
  const src = readFileSync("src/game/cars.ts", "utf8");
  for (const fn of ["function tireSurface", "function tyreStickerTexture"]) {
    const start = src.indexOf(fn);
    const body = src.slice(start, src.indexOf("\n}\n", start));
    const g = [...body.matchAll(/data\[i \+ 1\] = Math\.round\(\(\((-?)dy \/ len\)/g)].map((m) => m[1]);
    check(g.length === 1 && g[0] === "-", `${fn}: green must be -dy (glTF convention), found ${JSON.stringify(g)}`);
  }
  const car = createCar({ style: "sedan", body: 0x9c1c2c, accent: 0x222222, kit: "street", tyreSticker: "moulded" });
  const mats = { tire: null, sticker: null };
  car.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.wheelPart === "tire") mats.tire = o.material;
    if (o.material?.name === "tire-sticker-moulded") mats.sticker = o.material;
  });
  for (const [k, m] of Object.entries(mats)) {
    check(m !== null, `no ${k} material`);
    if (m) check(m.normalScale.y < 0 && m.normalScale.x > 0, `${k} normalScale ${m.normalScale.x},${m.normalScale.y}: y must be negative for a glTF-convention map`);
  }
  if (mats.sticker) {
    // Moulded lettering is rubber: a touch glossier than the sidewall it
    // stands on so the raised faces catch a highlight, its ink near the
    // rubber's own tone so the relief, not a pale paint, is what reads.
    check(mats.sticker.roughness <= 0.55 && (mats.sticker.specularIntensity ?? 1) >= 0.85,
      `moulded lettering roughness ${mats.sticker.roughness} / specular ${mats.sticker.specularIntensity}: the relief has to catch the light`);
    check(mats.sticker.normalScale.x >= 2.5, `moulded normalScale ${mats.sticker.normalScale.x}: the emboss is what makes unpainted letters visible`);
  }
  console.log(`normal maps: glTF-convention green on both, normalScale.y negative on tyre and lettering`);
}

console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : "\nall green");
process.exit(fail.length ? 1 : 0);
