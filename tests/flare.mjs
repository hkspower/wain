// The hot things, toned down — and held there.
//
//   npm run test:flare      (no browser, no dev server)
//
// Four things in the night frame were too strong: a big red halo round
// every braking tail, a white star hanging off the back of the car, star
// glints on the wheel arches, and the scrape sparks. src/game/flare.ts
// says what each one was and fixes it where it is made; this holds the
// arithmetic, which is all plain functions there, so none of it needs a
// renderer:
//
//   bloom     the bright pass weights by luminance and caps the excess:
//             red lamps bloom less, white lamps exactly as before, a
//             clearcoat glint at 500 goes in at 5, and no pixel anywhere
//             puts more into the bloom than the pass it replaced
//   flare     the headlamp halo and star fade with the angle off the
//             lamp's axis (gone from behind, unless a flash is firing:
//             each material's floor under the fade, which the film's
//             hits, the player's flash and the rival's reply lift with
//             their boost), cap their size up close, and the star is
//             smaller and quieter than it was; and the patch lands on
//             three's own sprite shader
//   sparks    the real integrator, flying thousands of seeded showers,
//             never takes one above SPARK.ceiling; each spark still draws
//             the same eleven numbers; the shower is modestly dimmer
//   stream    none of it draws from the world's shared stream
//
// What it cannot say is how any of it LOOKS: tools/shots/ik4k.mjs (the
// drift, lock and driver stills), tools/shots/sparks.mjs and
// tests/taillights.mjs are the browser half.
import * as THREE from "three";
import { readFileSync } from "node:fs";
import {
  BLOOM, brightPass, BRIGHT_PASS_FRAG,
  HEAD_FLARE, flareFacing, flareScale, patchLampFlare, lampFlareMaterial, setFlareBack, FLARE_ANCHORS,
  SPARK, sparkShower,
} from "../src/game/flare.ts";
import { ParticleSystem } from "../src/game/vfx.ts";
import { TAIL } from "../src/game/cars.ts";
import { worldDraws } from "../src/game/rand.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };
const F = (n, d = 2) => Number(n).toFixed(d);
const drawsAtStart = worldDraws();

// Linear RGB of a hex, the way three's colour management reads it.
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const mul = (a, k) => a.map((v) => v * k);
const add = (a, b) => a.map((v, i) => v + b[i]);
const top = (a) => Math.max(...a);
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// The pass this replaces (7db3da94): the max channel, excess only,
// through the same knee. Written out here so "before" is a fact of this
// file, not of a commit someone has to check out.
const before = ([r, g, b]) => {
  const m = Math.max(r, g, b), t = 1.0, kn = 0.5;
  const k = Math.min(Math.max(m - t + kn, 0), 2 * kn);
  const soft = (k * k) / (4 * kn + 1e-4);
  const w = Math.max(soft, m - t) / Math.max(m, 1e-4);
  return [r * w, g * w, b * w];
};
const after = (c) => brightPass(c[0], c[1], c[2]);

// --- 1. The bloom ------------------------------------------------------
{
  // The lamps, as emissive x intensity, with the tail glow plane's peak
  // (0.95 of its texture times its opacity) on the braking lamp.
  const glow = mul(lin(TAIL.glowColor), 0.95 * TAIL.glowBrake);
  const lamps = {
    "brake core + glow": add(mul(lin(TAIL.coreColor), TAIL.coreBrake), glow),
    "brake lens + glow": add(mul(lin(TAIL.lensColor), TAIL.lensBrake), glow),
    "head core": mul(lin(0xffffff), 4.2),
    "head lens": mul(lin(0xfff6cf), 1.7),
    "lantern 0xfff0cc": mul(lin(0xfff0cc), 2.2),
  };
  const res = {};
  console.log("bloom, max channel into the blur        stills EV 1.1        game night 0.55");
  for (const [name, c0] of Object.entries(lamps)) {
    const row = {};
    for (const e of [1.1, 0.55]) {
      const c = mul(c0, e);
      row[e] = { old: top(before(c)), now: top(after(c)) };
    }
    res[name] = row;
    const cell = (r) => `${F(r.old)} -> ${F(r.now)}${r.old > 0 ? ` (${F((r.now / r.old - 1) * 100, 0)}%)` : ""}`;
    console.log(`  ${name.padEnd(20)} ${cell(row[1.1]).padEnd(22)} ${cell(row[0.55])}`);
  }
  const bc = res["brake core + glow"][1.1];
  check(bc.now <= 0.6 * bc.old,
    `a braking tail core still puts ${F(bc.now)} into the bloom at the stills' exposure, against ${F(bc.old)} — that is the big red halo`);
  check(bc.now >= 0.25 * res["head core"][1.1].now,
    `a braking tail core puts only ${F(bc.now)} into the bloom — a red lamp should still bloom, gently`);
  const bl = res["brake lens + glow"][1.1];
  check(bl.now <= 0.5 * bl.old, `the tail lens band still blooms at ${F(bl.now)} of ${F(bl.old)}`);
  for (const e of [1.1, 0.55]) {
    const h = res["head core"][e];
    check(Math.abs(h.now - h.old) < 1e-9, `a white headlamp core moved in the bloom at EV ${e}: ${h.old} -> ${h.now}`);
  }
  const hl = res["head lens"][1.1];
  check(hl.now >= 0.9 * hl.old, `the warm-white head lens lost ${F((1 - hl.now / hl.old) * 100, 0)}% of its bloom`);

  // The glints: a clearcoat highlight on the arch flare under a street
  // lamp, white, and the metallic red basecoat's broader one.
  const glints = { "white glint 500": [500, 500, 500], "red basecoat 100": [100, 5, 5], "red basecoat 20": [20, 1, 1] };
  for (const [name, c] of Object.entries(glints)) {
    const o = top(before(c)), n = top(after(c));
    console.log(`  ${name.padEnd(20)} ${F(o)} -> ${F(n)}  (${F(o / n, 0)}x less into the blur)`);
    check(n <= BLOOM.cap + 1e-9, `${name} puts ${F(n)} into the bloom, over the cap of ${BLOOM.cap}`);
  }
  // The cap keeps the hue: it scales the pixel, it does not clip a channel.
  {
    const o = after([100, 5, 5]);
    check(Math.abs(o[1] / o[0] - 0.05) < 1e-6, "the cap clipped a channel instead of scaling the pixel");
  }
  // No lamp in the game reaches the cap at any exposure the meter or the
  // stills use (the meter tops out at 1.25).
  {
    const core = top(after(mul(lin(0xffffff), 4.2 * 1.25)));
    check(core < BLOOM.cap, `a head core at the meter's top exposure is capped (${F(core)})`);
  }
  // A pure tone-down: never more into the bloom than the pass it replaced,
  // for any colour at any brightness. Seeded, so a failure is repeatable.
  let s = 0x5eed;
  const r01 = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let worse = 0, worst = 0;
  for (let i = 0; i < 100000; i++) {
    const scale = r01() < 0.5 ? 4 : 60;
    const c = [r01() * scale, r01() * scale, r01() * scale].map((v) => (r01() < 0.3 ? v * 0.02 : v));
    const o = before(c), n = after(c);
    for (let j = 0; j < 3; j++) {
      if (n[j] > o[j] + 1e-9) { worse++; worst = Math.max(worst, n[j] - o[j]); }
    }
  }
  console.log(`  never brighter        ${check(worse === 0, `${worse} channels came out brighter than the old pass (worst +${worst})`)}  100000 seeded colours, none above the old pass`);

  // The shader is the arithmetic above, and the engine runs it.
  const frag = BRIGHT_PASS_FRAG;
  check(/uniform float bloomLumaWeight;/.test(frag) && /uniform float bloomCap;/.test(frag),
    "the bright pass lost its luma-weight or cap uniform");
  check(/vec3\(0\.2126, 0\.7152, 0\.0722\)/.test(frag), "the bright pass does not weigh by Rec. 709 luminance");
  check(/pow\(clamp\(lum \/ max\(hi, 1e-4\), 1e-6, 1\.0\), bloomLumaWeight\)/.test(frag),
    "the bright pass's measure is not max x (luminance / max) ^ lumaWeight");
  check(/o \*= min\(1\.0, bloomCap \//.test(frag), "the bright pass does not scale by the cap");
  const eng = readFileSync("src/game/engine.ts", "utf8");
  check(/hp\.fragmentShader = BRIGHT_PASS_FRAG;/.test(eng), "the engine does not run BRIGHT_PASS_FRAG");
  check(/hp\.uniforms\.bloomLumaWeight = \{ value: BLOOM\.lumaWeight \}/.test(eng) &&
    /hp\.uniforms\.bloomCap = \{ value: BLOOM\.cap \}/.test(eng), "the engine does not feed the pass BLOOM's weight and cap");
  check(!/const BLOOM = \{/.test(eng), "the engine keeps a second BLOOM of its own");
  console.log(`  wiring                the engine runs flare.ts's pass with weight ${BLOOM.lumaWeight} and cap ${BLOOM.cap}`);
}

// --- 2. The headlamp flare ---------------------------------------------
{
  // The patch lands on three's own sprite shader, every anchor once.
  const lib = THREE.ShaderLib.sprite;
  for (const [k, a] of Object.entries(FLARE_ANCHORS)) {
    const src = k.startsWith("vertex") ? lib.vertexShader : lib.fragmentShader;
    const n = src.split(a).length - 1;
    check(n === 1, `three's sprite shader has the ${k} anchor ${n} times, not once — the flare patch would not apply`);
  }
  const sh = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  const ok = patchLampFlare(sh);
  check(ok, "patchLampFlare refused three's sprite shader");
  check((sh.vertexShader.match(/vFlareFacing/g) ?? []).length === 2, "the vertex shader does not declare and write vFlareFacing");
  check(/diffuseColor\.a \*= vFlareFacing;/.test(sh.fragmentShader), "the fragment shader does not fade by vFlareFacing");
  check(/smoothstep\( 0\.1, 0\.6, dot\( flareAxis, normalize\( - mvPosition\.xyz \) \) \)/.test(sh.vertexShader),
    "the shader's facing fade is not HEAD_FLARE.facing");
  check(/uniform float flareBack;/.test(sh.vertexShader) && /vFlareFacing = mix\( flareBack, 1\.0, smoothstep\(/.test(sh.vertexShader),
    "the shader's facing fade has no flareBack floor under it — a flash cannot show from behind");
  const nearK = HEAD_FLARE.starSize / (2 * HEAD_FLARE.capFrac);
  check(sh.vertexShader.includes(`projectionMatrix[ 1 ][ 1 ] * ${nearK.toFixed(6).replace(/0+$/, "")}`),
    "the shader's size cap is not starSize / (2 capFrac)");
  // A shader without the anchors is left exactly as it was.
  const alien = { vertexShader: "void main() {}", fragmentShader: "void main() {}" };
  check(!patchLampFlare(alien) && alien.vertexShader === "void main() {}", "a shader without the anchors was changed");
  // One program for every lamp: the same onBeforeCompile, so the same key.
  const a = lampFlareMaterial(new THREE.SpriteMaterial());
  const b = lampFlareMaterial(new THREE.SpriteMaterial());
  check(a.onBeforeCompile === b.onBeforeCompile && a.customProgramCacheKey() === b.customProgramCacheKey(),
    "two lamp sprites would compile two programs");
  check(a.customProgramCacheKey() !== new THREE.SpriteMaterial().customProgramCacheKey(),
    "a lamp sprite would share the stock sprite's program and never be patched");
  // ...but a floor each. Compiled the way r184's getProgram does it: a
  // clone of the sprite uniforms per material, and onBeforeCompile called
  // as a method of that material.
  const compile = (m) => {
    const p = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms) };
    m.onBeforeCompile(p, null);
    return p;
  };
  const pa = compile(a), pb = compile(b);
  check(pa.uniforms.flareBack !== undefined && pa.uniforms.flareBack === a.userData.flareBack,
    "a lamp sprite's compiled uniforms do not hold its own flareBack");
  check(pa.uniforms.flareBack !== pb.uniforms.flareBack, "two lamp sprites share one flareBack — one flash would lift every car's");
  check(pa.uniforms.flareBack.value === 0 && pb.uniforms.flareBack.value === 0, "a lamp sprite is built with a floor under its fade");
  setFlareBack(a, 0.7);
  check(pa.uniforms.flareBack.value === 0.7 && pb.uniforms.flareBack.value === 0,
    "setFlareBack does not reach the uniform the renderer uploads, or reaches the wrong material's");
  setFlareBack(a, 3);
  check(pa.uniforms.flareBack.value === 1, "setFlareBack lets the floor past the whole flare");
  setFlareBack(a, 0);
  console.log(`flare      patch lands on three r${THREE.REVISION}'s sprite shader; one program for every lamp, a floor for each`);

  // Facing, at the angles the stills are taken from (camera relative to
  // the lamp's axis), and an oncoming car.
  const deg = (d) => Math.cos((d * Math.PI) / 180);
  const views = { "oncoming": 0, "lock still": 35, "sweep still": 38, "side-on": 90, "driver still": 115, "brake still": 157, "drift still": 150 };
  const row = Object.entries(views).map(([k, d]) => `${k} ${F(flareFacing(deg(d)))}`).join(", ");
  console.log(`           facing: ${row}`);
  check(flareFacing(deg(0)) === 1 && flareFacing(deg(35)) === 1, "an oncoming lamp or the lock still's has lost its flare");
  for (const d of [85, 90, 115, 150, 157, 180]) {
    check(flareFacing(deg(d)) === 0, `a lamp seen ${d} degrees off its axis still flares (${F(flareFacing(deg(d)), 3)})`);
  }
  let mono = true, prev = 2;
  for (let d = 0; d <= 180; d += 1) { const f = flareFacing(deg(d)); if (f > prev + 1e-12) mono = false; prev = f; }
  check(mono, "the flare comes back as the lamp turns further away");

  // ...except while a flash is firing. The film's CHALLENGE shot is the
  // case that has to work, flown on its own camera numbers, read out of
  // the engine (back 7.4 -> 5.2 m, out 2.9 -> 1.5 m, 0.82 -> 1.05 m up as
  // written), against a lamp about z 2.3, x +-0.6 — swept over the lamp
  // heights and noses the shells have. All of it sits in the fade's dead
  // zone, so only the floor can show the three hits.
  {
    const engSrc = readFileSync("src/game/engine.ts", "utf8");
    const shot = engSrc.slice(engSrc.indexOf("// THE CHALLENGE."), engSrc.indexOf("// THE ANSWER."));
    const lerpOf = (re) => { const m = shot.match(re); return m ? [Number(m[1]), Number(m[2])] : null; };
    const OUT = lerpOf(/const out = THREE\.MathUtils\.lerp\(([\d.]+), ([\d.]+), k\)/);
    const BACK = lerpOf(/const back = THREE\.MathUtils\.lerp\(([\d.]+), ([\d.]+), k\)/);
    const UP = lerpOf(/this\.v1\.y \+ THREE\.MathUtils\.lerp\(([\d.]+), ([\d.]+), k\)/);
    check(OUT && BACK && UP, "the CHALLENGE shot's camera numbers could not be read out of engine.ts");
    let lo = 180, hi = 0, worstPeak = 1;
    for (let k = 0; k <= 1 + 1e-9 && OUT && BACK && UP; k += 0.05) {
      const out = OUT[0] + (OUT[1] - OUT[0]) * k, back = BACK[0] + (BACK[1] - BACK[0]) * k, h = UP[0] + (UP[1] - UP[0]) * k;
      for (const lx of [-0.6, 0.6]) for (const ly of [0.5, 0.65, 0.8]) for (const lz of [2.0, 2.3, 2.5]) {
        const dx = out - lx, dy = h - ly, dz = -back - lz;
        const c = dz / Math.hypot(dx, dy, dz);
        const a = (Math.acos(c) * 180) / Math.PI;
        lo = Math.min(lo, a); hi = Math.max(hi, a);
        worstPeak = Math.min(worstPeak, flareFacing(c, HEAD_FLARE.flashBack * 1));
      }
    }
    const half = flareFacing(deg(lo), HEAD_FLARE.flashBack * 0.5);
    console.log(`           CHALLENGE shot: ${F(lo, 0)}-${F(hi, 0)} degrees off the lamps' axis; ` +
      `flare at rest ${F(flareFacing(deg(lo)))}, half a hit ${F(half)}, a hit's peak ${F(worstPeak)}`);
    check(Math.abs(worstPeak - 1) < 1e-12, `at a hit's peak the CHALLENGE shot sees the flare at ${F(worstPeak)}, not whole`);
    check(Math.abs(flareFacing(deg(180), HEAD_FLARE.flashBack * 0.5) - 0.5) < 1e-12, "the floor is not in proportion to the flash");
    // Never less than either half of the mix: the floor only adds.
    for (let d = 0; d <= 180; d += 5) {
      for (const bk of [0, 0.3, 1]) {
        const f = flareFacing(deg(d), bk);
        check(f >= bk - 1e-12 && f >= flareFacing(deg(d)) - 1e-12 && f <= 1 + 1e-12,
          `the floor took flare away at ${d} degrees, floor ${bk}`);
      }
    }
  }

  // Size: what share of the viewport's height the star spans.
  const p11 = (fov) => 1 / Math.tan((fov * Math.PI) / 360);
  const share = (size, d, fov) => (p11(fov) * size * flareScale(d, p11(fov))) / (2 * d);
  const oldShare = (d, fov) => (p11(fov) * 1.7) / (2 * d);
  const lock = share(HEAD_FLARE.starSize, 6.5, 30);
  console.log(`           star share of the frame: lock still ${F(oldShare(6.5, 30) * 100, 1)}% -> ${F(lock * 100, 1)}%, ` +
    `oncoming at 30 m ${F(oldShare(30, 62) * 100, 1)}% -> ${F(share(HEAD_FLARE.starSize, 30, 62) * 100, 1)}%`);
  check(Math.abs(lock - HEAD_FLARE.capFrac) < 1e-9, `the lock still's star spans ${F(lock * 100, 1)}% of the frame`);
  for (const d of [0.8, 2, 4, 6.5, 10]) {
    for (const fov of [30, 46, 62, 75]) {
      check(share(HEAD_FLARE.starSize, d, fov) <= HEAD_FLARE.capFrac + 1e-9, `the star spans more than capFrac at ${d} m, fov ${fov}`);
    }
  }
  check(flareScale(30, p11(62)) === 1 && flareScale(8, p11(62)) === 1,
    "the cap reaches an oncoming car at play distance in the game's own 62-degree view");

  // Quieter: the star, not the halo.
  check(HEAD_FLARE.starSize < 1.7 && HEAD_FLARE.nightStar < 0.9 && HEAD_FLARE.starOpacity < 0.62,
    "the star is no smaller or quieter than the 1.7 m / 0.9 / 0.62 it was");
  check(HEAD_FLARE.nightStar < HEAD_FLARE.nightHalo, "the star is as loud as the halo it decorates");
  check(HEAD_FLARE.haloSize === 0.85 && HEAD_FLARE.haloOpacity === 0.5 && HEAD_FLARE.nightHalo === 0.9,
    "the halo moved — it is what says a lamp is lit");
  const was = 0.9 * 1.7 ** 2, now = HEAD_FLARE.nightStar * HEAD_FLARE.starSize ** 2;
  console.log(`           star at night: ${F((1 - HEAD_FLARE.nightStar / 0.9) * 100, 0)}% less at a pixel, ` +
    `${F((1 - now / was) * 100, 0)}% less light; halo untouched`);

  // Wired: both sprites patched, each with its night level, read by the clock.
  const cars = readFileSync("src/game/cars.ts", "utf8");
  check((cars.match(/lampFlareMaterial\(new THREE\.SpriteMaterial\(/g) ?? []).length === 2,
    "the headlamp halo and star are not both built through lampFlareMaterial");
  check(/halo\.userData\.nightOpacity = HEAD_FLARE\.nightHalo \* flare;/.test(cars) &&
    /starMat\.userData\.nightOpacity = HEAD_FLARE\.nightStar \* flare;/.test(cars),
    "the sprites do not carry their night level, tint and all");
  check(/star\.scale\.setScalar\(HEAD_FLARE\.starSize \* size\)/.test(cars), "the star is not built at HEAD_FLARE.starSize");
  const eng = readFileSync("src/game/engine.ts", "utf8");
  check(/g\.opacity = \(\(g\.userData\.nightOpacity as number \| undefined\) \?\? 0\.9\) \* dark;/.test(eng),
    "the clock sets every flare sprite to one level again");

  // The three flashes lift the floor with their own boost, and put it
  // back. Each method's body, from its signature to the next member.
  const body = (sig) => {
    const i = eng.indexOf(sig);
    if (i < 0) return "";
    const j = eng.indexOf("\n  }\n", i);
    return eng.slice(i, j < 0 ? undefined : j);
  };
  const cine = body("private applyCineBeam(boost: number): void {");
  check(/setFlareBack\(m, HEAD_FLARE\.flashBack \* boost\)/.test(cine),
    "the film's hits do not lift the floor under the fade — the CHALLENGE shot shows no flare");
  const own = body("private applyFlashBeam(): void {");
  const ownAt = own.indexOf("setFlareBack(g, HEAD_FLARE.flashBack * boost)");
  check(ownAt >= 0, "the player's flash does not lift the floor under the fade — the chase camera sees no flash");
  check(ownAt >= 0 && ownAt < own.indexOf("if (boost <= 0 && this.highBeamK"),
    "the player's floor is set after the rest branch, so a flash that ends leaves it up");
  check(!/setFlareBack\([^)]*highBeamK/.test(own), "main beam held lifts the floor — the white star at the tail for as long as the stalk is up");
  const rival = body("private flashRival(r: Rival): void {");
  check(/setFlareBack\(m, on \? HEAD_FLARE\.flashBack : 0\)/.test(rival) && /setFlareBack\(m, 0\)/.test(rival),
    "the rival's reply does not lift the floor with each flash and put it back — from behind it is invisible");
  const writers = (eng.match(/setFlareBack\(/g) ?? []).length;
  check(writers === 4, `the engine writes a lamp's floor in ${writers} places, not the three flashes' four`);
}

// --- 3. The sparks -----------------------------------------------------
{
  let seed = 0xc0ffee;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  // The law this replaces, the same eleven draws in the same order.
  const oldShower = (rnd, side, intensity, emit) => {
    const n = Math.round(26 + 34 * intensity);
    for (let i = 0; i < n; i++) {
      rnd(); rnd(); rnd();
      const y = 0.22 + rnd() * 0.3;
      rnd(); rnd();
      const vy = 0.5 + rnd() * 3;
      rnd(); rnd(); rnd(); rnd();
      emit({ x: 0, y, z: 0, vx: 0, vy, vz: 0, life: 0.85, size: 0.1 });
    }
  };
  const map = new THREE.Texture();
  const fly = (shower, dt) => {
    const fx = new ParticleSystem(140, { map, colorA: SPARK.colorA, colorB: SPARK.colorB });
    let maxY = 0, n = 0;
    for (const side of [-1, 1]) {
      for (const sev of [0.15, 0.5, 1]) {
        for (let k = 0; k < 120; k++) {
          shower(side, sev, (s) => fx.spawn(s.x, s.y, s.z, s.vx, s.vy, s.vz, s.life, s.size));
          for (let t = 0; t < 1; t += dt) {
            fx.update(dt, SPARK.motion);
            const pos = fx.points.geometry.getAttribute("position");
            const life = fx.points.geometry.getAttribute("aLife");
            for (let i = 0; i < life.count; i++) {
              if (life.getX(i) <= 0) continue;
              n++;
              maxY = Math.max(maxY, pos.getY(i));
            }
          }
        }
      }
    }
    return { maxY, n };
  };
  const now = (side, sev, emit) => sparkShower(rnd, 0, 0, 1, 0, side, sev, emit);
  const old = (side, sev, emit) => oldShower(rnd, side, sev, emit);
  const n60 = fly(now, 1 / 60), n20 = fly(now, 1 / 20), o60 = fly(old, 1 / 60);
  // And the worst a stream could ever draw: every number at the top.
  const top1 = () => 0.999999;
  const worst = fly((side, sev, emit) => sparkShower(top1, 0, 0, 1, 0, side, sev, emit), 1 / 60);
  console.log(`sparks     highest spark: ${F(o60.maxY)} m before, ${F(n60.maxY)} m now at 60 fps, ` +
    `${F(n20.maxY)} m at 20 fps, ${F(worst.maxY)} m on the worst possible draw; ceiling ${F(SPARK.ceiling)} m`);
  for (const [k, r] of Object.entries({ "60 fps": n60, "20 fps": n20, "worst draw": worst })) {
    check(r.n > 1000, `${k}: only ${r.n} spark-frames flown`);
    check(r.maxY <= SPARK.ceiling + 1e-6, `${k}: a spark reached ${F(r.maxY, 3)} m, over the ${F(SPARK.ceiling, 3)} m ceiling`);
  }
  check(SPARK.ceiling < 0.6, `the ceiling is ${F(SPARK.ceiling)} m — sparks off a sill should stay below 0.6 m`);
  check(n60.maxY < o60.maxY - 0.15, "the sparks fly no lower than they did");
  check(SPARK.spawnY[0] > SPARK.motion.groundY, "a spark is born under the road");

  // The same eleven draws per spark, so a seeded shower is the same shower.
  let calls = 0;
  const counting = () => { calls++; return 0.5; };
  let sparks = 0;
  sparkShower(counting, 0, 0, 1, 0, 1, 1, () => sparks++);
  check(sparks === 60 && calls === 11 * 60, `a severity-1 shower drew ${calls} numbers for ${sparks} sparks, not 11 each`);

  // Dimmer, modestly: opacity x luminance at a pixel, and over the shower
  // with the mean area of a sprite.
  const Y = (hex) => lum(lin(hex));
  const meanSq = ([a, b]) => (a * a + a * b + b * b) / 3;
  const pxNow = SPARK.opacity * Y(SPARK.colorA), pxWas = 0.4 * Y(0xffdf9e);
  const shNow = pxNow * meanSq(SPARK.size), shWas = pxWas * meanSq([0.09, 0.16]);
  console.log(`           core luminance ${F(Y(0xffdf9e), 3)} -> ${F(Y(SPARK.colorA), 3)}, opacity 0.4 -> ${SPARK.opacity}: ` +
    `${F((1 - pxNow / pxWas) * 100, 0)}% less at a pixel, ${F((1 - shNow / shWas) * 100, 0)}% less from the shower`);
  check(pxNow / pxWas <= 0.85 && pxNow / pxWas >= 0.6, `a spark's pixel is ${F(pxNow / pxWas)} of what it was — not a modest cut`);
  check(shNow / shWas <= 0.8 && shNow / shWas >= 0.5, `the shower's light is ${F(shNow / shWas)} of what it was — not a modest cut`);
  check(SPARK.colorB === 0xff5a12, "the ember end moved");
  // Still not bright enough to bloom on its own: one spark at birth, at
  // the game's night meter and at the stills', is under the knee.
  for (const e of [0.55, 1.1]) {
    const c = mul(lin(SPARK.colorA), SPARK.opacity * e);
    check(top(after(c)) === 0, `one spark at EV ${e} reaches the bloom`);
  }

  const eng = readFileSync("src/game/engine.ts", "utf8");
  check(/sparkShower\(Math\.random, p\.x, p\.z, this\.v3\.x, this\.v3\.z, side, intensity,/.test(eng),
    "spawnSparks does not throw the shower through sparkShower");
  check(/colorA: SPARK\.colorA/.test(eng) && /opacity: SPARK\.opacity/.test(eng), "the spark pool is not built from SPARK");
  check(/this\.sparkFx\.update\(dt, SPARK\.motion\)/.test(eng), "the sparks are not integrated with SPARK.motion");
}

// --- 4. The world's stream ---------------------------------------------
console.log(`stream     ${check(worldDraws() === drawsAtStart, `the world stream moved by ${worldDraws() - drawsAtStart} draws`)}  ` +
  `${worldDraws() - drawsAtStart} draws from the shared world stream by any of this`);

console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : "\nall green");
process.exit(fail.length ? 1 : 0);
