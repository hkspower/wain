// The night's blacks: neutral, and at the luminance everything else was
// measured against.
//
//   npm run test:blacks      (no browser, no dev server)
//
// The image's black end was fixed in seven places at once — the grade's
// black neutraliser, the vibrance gate and the unsharp clamp (grade.ts);
// the stills' lift (engine.ts); the night sky, fog, fill, hemisphere and
// Milky Way (world.ts); the night IBL (env.ts) — and every one of those
// changes was a HUE change made at EQUAL LUMINANCE, on purpose, so that
// none of the luma-calibrated guards in this repo (levels.mjs, dark.mjs,
// blacks.mjs, check:paint, tests/grade.mjs's ladder) had to move. That
// promise is easy to break by retuning a colour by eye, and nothing that
// runs in a browser would say which of the seven broke it. This reads the
// numbers out of the source and holds each to the luminance it replaced
// and to the hue it was changed for.
//
// What a browser has to measure is elsewhere: tests/grade.mjs runs the
// real shader on known patches ("blacks are neutral"), blacks.mjs A/Bs
// the neutraliser in game, and tools/shots/stillblacks.mjs reads the
// colour of the 4K stills' darks.
import { readFileSync } from "node:fs";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c; };
let mark = 0;
const verdict = () => { const n = fail.length - mark; mark = fail.length; return n ? `FAIL (${n})` : "ok"; };
const Y = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const BR = (c) => c[2] / c[0];
const s2l = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const l2s = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const hexLin = (h) => [1, 3, 5].map((i) => s2l(parseInt(h.slice(i, i + 2), 16)));
const F = (n, d = 4) => Number(n).toFixed(d);
const triple = (s) => s.split(",").map(Number);

// Comment lines out, so a number quoted in a comment (and the comments
// beside these keyframes quote the old ones) is never read as code.
const code = (file) =>
  readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
const grade = readFileSync("src/game/grade.ts", "utf8");
const world = code("src/game/world.ts");
const env = code("src/game/env.ts");
const engine = code("src/game/engine.ts");
/** The first [a, b, c] (optionally inside nightLight(...)) after `anchor`. */
const firstAfter = (src, anchor) => {
  const at = src.indexOf(anchor);
  if (at < 0) return null;
  const m = /\[\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\]/.exec(src.slice(at));
  return m ? [+m[1], +m[2], +m[3]] : null;
};
const sat = +(/const NIGHT_LIGHT_SAT = ([\d.]+);/.exec(world)?.[1] ?? NaN);
// world.ts's nightLight: a mix toward the colour's own luma, which keeps
// its luminance and halves its saturation.
const nightLight = (c) => { const y = Y(c); return c.map((v) => y + (v - y) * sat); };

// --- 1. The grade: the stage is where it has to be -----------------------
{
  const frag = /export const GradeShader[\s\S]*?fragmentShader: `([\s\S]*?)`,\n};/.exec(grade)?.[1] ?? "";
  const def = (k) => +(new RegExp(`${k}: \\{ value: ([\\d.]+) \\}`).exec(grade)?.[1] ?? NaN);
  check(frag.length > 1000, "could not find GradeShader's fragment shader in grade.ts");
  check(def("uBlackNeutral") > 0 && def("uBlackNeutral") <= 0.8,
    `uBlackNeutral ships at ${def("uBlackNeutral")} — 0 is off, and above 0.8 a dim tail lamp greys out`);
  check(def("uNeutralTo") > 0 && def("uNeutralTo") <= 0.15, `uNeutralTo is ${def("uNeutralTo")}: the stage is for blacks, not midtones`);
  check(/uniform float uBlackNeutral;/.test(frag) && /uniform float uNeutralTo;/.test(frag), "the neutraliser's uniforms are not declared in the shader");
  // AFTER vibrance, which boosts near-neutral darks up to 1.8x and would
  // hand a cast removed upstream straight back; BEFORE the dither, which
  // is the last thing that may touch the pixel.
  const vib = frag.indexOf("c.rgb = max(mix(vec3(lv), c.rgb, boost), 0.0);");
  const neu = frag.search(/c\.rgb = mix\(vec3\(lN\), c\.rgb, 1\.0 - uBlackNeutral \*/);
  const dith = frag.indexOf("uDither / 255.0");
  check(vib > 0 && neu > vib && dith > neu,
    `the black neutraliser is not between vibrance and the dither (vibrance @${vib}, neutraliser @${neu}, dither @${dith})`);
  // The gate keeps vibrance out of the deepest darks and in the night's
  // midtones: its top edge at or under a night frame's median (20/255).
  const gate = /boost = 1\.0 \+ uVibrance \* room \* room \* smoothstep\(([\d.]+), ([\d.]+), lv\)/.exec(frag);
  check(!!gate, "vibrance is not gated in the darks");
  if (gate) check(+gate[1] >= 0.01 && +gate[2] <= 20 / 255 + 0.002,
    `vibrance gate smoothstep(${gate[1]}, ${gate[2]}): it must start above black and be fully open by a night frame's median, 0.078`);
  check(/c\.rgb \+= max\(\(c\.rgb - blur\) \* 0\.4, -0\.5 \* c\.rgb\);/.test(frag),
    "the unsharp mask's undershoot is not clamped: a dark pixel beside a lamp goes through zero and comes back as the floor's colour");
  console.log(`grade      neutraliser ${def("uBlackNeutral")} to luma ${def("uNeutralTo")}, after vibrance (gated ${gate ? `${gate[1]}..${gate[2]}` : "-"}), before the dither; undershoot clamped  ${verdict()}`);
}

// --- 2. The stills keep a quarter of the lift at EV+1 --------------------
{
  const m = /setManualExposure\(e: number\): void \{[\s\S]*?uLiftScale\.value = ([^;]+);/.exec(engine);
  check(!!m, "could not find setManualExposure's lift scale");
  if (m) {
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const scale = new Function("e", "THREE", `return ${m[1]};`);
    const T = { MathUtils: { clamp } };
    const at = (ev) => scale(0.55 * 2 ** ev, T);
    check(Math.abs(at(1) - 0.25) < 0.01, `at the stills' EV+1 the lift scale is ${F(at(1), 3)}, not a quarter`);
    check(at(0) === 1 && at(-1) === 1, "at or under the meter's floor the lift must stay whole");
    console.log(`stills     lift scale at EV 0 / +1 / +2: ${[0, 1, 2].map((v) => F(at(v), 3)).join(" / ")}  ${verdict()}`);
  }
}

// --- 3. Frame 0 is the same night as frame 1 ------------------------------
//
// setTimeOfDay overwrites the sky's and the fog's constructor colours on
// its first call; a constructor value that disagrees is a one-frame
// different night (the fog's said 0x02030b for as long as the night
// keyframe said navy).
{
  const top = firstAfter(world, "(u.uTop.value as THREE.Color).copy(");
  const hor = firstAfter(world, "(u.uHorizon.value as THREE.Color).copy(");
  const ctorTop = /uTop: \{ value: new THREE\.Color\(([^)]+)\) \}/.exec(world)?.[1];
  const ctorHor = /uHorizon: \{ value: new THREE\.Color\(([^)]+)\) \}/.exec(world)?.[1];
  check(top && ctorTop && triple(ctorTop).every((v, i) => v === top[i]), `the sky's uTop starts at ${ctorTop}, the night keyframe is ${top}`);
  check(hor && ctorHor && triple(ctorHor).every((v, i) => v === hor[i]), `the sky's uHorizon starts at ${ctorHor}, the night keyframe is ${hor}`);
  const fog = firstAfter(world, "fog.color.copy(");
  const fogHex = /new THREE\.FogExp2\(0x([0-9a-fA-F]{6})/.exec(world)?.[1];
  const ctorFog = fogHex ? hexLin(`#${fogHex}`) : null;
  const off = fog && ctorFog ? Math.max(...fog.map((v, i) => Math.abs(l2s(v) - l2s(ctorFog[i])))) : Infinity;
  check(off <= 1, `the fog starts at 0x${fogHex}, ${F(off, 1)} levels from the night keyframe ${fog}`);
  console.log(`frame 0    uTop ${ctorTop}, uHorizon ${ctorHor}, fog 0x${fogHex} — the night keyframes  ${verdict()}`);
}

// --- 4. The night sky and fog are dark and nearly neutral -----------------
//
// The zenith was B/R 6.5 in linear light and the stills read it as
// 22,45,114. The tone mapper's toe stretches whatever cast goes in, so
// even linear B/R 3.0 to 3.4 modelled back out as a blue sky; 2.4 is the
// shipped value. The fog is the floor the far field fades to, and it was
// navy (B/R 5.4).
{
  const top = firstAfter(world, "(u.uTop.value as THREE.Color).copy(");
  const hor = firstAfter(world, "(u.uHorizon.value as THREE.Color).copy(");
  const fog = firstAfter(world, "fog.color.copy(");
  check(BR(top) <= 3, `the night zenith is linear B/R ${F(BR(top), 2)} — royal blue again`);
  check(Y(top) < 0.0309, `the night zenith is Y ${F(Y(top))}, no deeper than the raise it replaced (0.0309)`);
  check(BR(hor) <= 2, `the night horizon is B/R ${F(BR(hor), 2)} — mauve under the glow again`);
  // The horizon holds the skyline band and the paint probe's flank
  // reflections: within 10% of the 0.0669 they were measured against.
  check(Math.abs(Y(hor) / 0.0669 - 1) <= 0.1, `the night horizon is Y ${F(Y(hor))} against 0.0669 — the skyline and the paint's flanks were measured there`);
  check(BR(fog) <= 2 && Y(fog) <= 0.0134, `the night fog is Y ${F(Y(fog))} at B/R ${F(BR(fog), 2)}: it must stay a dark, near-neutral floor`);
  // The Milky Way sits ON the zenith: its strength is relative to it, and
  // held there when the zenith moved (x0.41 with a 2.7x darker sky).
  const milky = triple(/const MILKY_COLOR = "vec3\(([^)]+)\)"/.exec(world)?.[1] ?? "NaN,NaN,NaN");
  const rel = Y(milky) / Y(top);
  check(rel >= 0.5 && rel <= 0.85, `the Milky Way is ${F(rel, 2)}x the zenith in linear light — it was 0.62x; it should move with the sky`);
  console.log(`night sky  zenith Y ${F(Y(top))} B/R ${F(BR(top), 2)}; horizon Y ${F(Y(hor))} B/R ${F(BR(hor), 2)}; ` +
    `fog Y ${F(Y(fog))} B/R ${F(BR(fog), 2)}; Milky Way ${F(rel, 2)}x the zenith  ${verdict()}`);
}

// --- 5. Night lights changed hue at the luminance they had ----------------
//
// Each of these replaced a colour that every night measurement in the
// repo had been taken under. The bars are on luminance — within 1-2% of
// the value replaced — and on the hue each was changed for.
{
  const key = nightLight(firstAfter(world, "moonLight.color.copy("));
  const fill = nightLight(firstAfter(world, "fillLight.color.copy("));
  const sky = nightLight(firstAfter(world, "hemiRef.color.copy("));
  const ground = firstAfter(world, "hemiRef.groundColor.copy(");
  const lum = (name, c, was, tol) =>
    check(Math.abs(Y(c) / was - 1) <= tol, `${name} is Y ${F(Y(c))} against the ${F(was)} the night was measured under (${(tol * 100).toFixed(0)}% allowed)`);
  lum("the night fill", fill, 0.5419, 0.01);
  lum("the night hemisphere sky", sky, 0.2173, 0.01);
  lum("the night hemisphere ground", ground, 0.0564, 0.02);
  // At night the key is itself cool, so the fill matches it rather than
  // out-blueing it; the hemisphere sky follows; the ground is near grey.
  check(Math.abs(BR(fill) - BR(key)) <= 0.05, `the night fill is B/R ${F(BR(fill), 2)} against the moon's ${F(BR(key), 2)} — it is painting the shadows blue again`);
  check(BR(sky) <= BR(key) + 0.1, `the night hemisphere sky is B/R ${F(BR(sky), 2)}, bluer than the moon's ${F(BR(key), 2)}`);
  check(BR(ground) >= 0.8 && BR(ground) <= 1.1, `the night hemisphere ground is B/R ${F(BR(ground), 2)} — brown undersides again`);
  console.log(`night rig  key B/R ${F(BR(key), 2)}; fill Y ${F(Y(fill))} B/R ${F(BR(fill), 2)}; sky Y ${F(Y(sky))} B/R ${F(BR(sky), 2)}; ` +
    `ground Y ${F(Y(ground))} B/R ${F(BR(ground), 2)}  ${verdict()}`);

  // The IBL's horizon band is the paint's clearcoat streak, and
  // check:paint was calibrated on its luminance; the stop under it is the
  // undertrays' light. Both went from sodium/brown to LED-neutral.
  const night = env.slice(0, env.indexOf("export function dayEnvironment"));
  const stops = [...night.matchAll(/addColorStop\(([\d.]+), "(#[0-9a-fA-F]{6})"\)/g)].map((m) => [+m[1], m[2]]);
  const at = (t) => stops.find(([s]) => s === t)?.[1];
  const band = at(0.5) ? hexLin(at(0.5)) : null, under = at(0.56) ? hexLin(at(0.56)) : null;
  check(band && Math.abs(Y(band) / 0.4938 - 1) <= 0.01, `the IBL band ${at(0.5)} is Y ${band && F(Y(band))} against 0.4938 — a brighter or dimmer clearcoat streak`);
  check(band && BR(band) >= 0.7 && BR(band) <= 1.1, `the IBL band ${at(0.5)} is B/R ${band && F(BR(band), 2)} — not the LED white the lamps are`);
  check(under && Math.abs(Y(under) / 0.0264 - 1) <= 0.02, `the IBL ground stop ${at(0.56)} is Y ${under && F(Y(under))} against 0.0264`);
  check(under && BR(under) >= 0.7 && BR(under) <= 1.1, `the IBL ground stop ${at(0.56)} is B/R ${under && F(BR(under), 2)} — brown undertrays again`);
  console.log(`night IBL  band ${at(0.5)} Y ${band && F(Y(band))} B/R ${band && F(BR(band), 2)}; ` +
    `ground ${at(0.56)} Y ${under && F(Y(under))} B/R ${under && F(BR(under), 2)}  ${verdict()}`);
}

console.log(fail.length ? `\nFAILURES:\n - ${fail.join("\n - ")}` : "\nthe night's blacks are neutral, at the luminance they were measured at");
process.exit(fail.length ? 1 : 0);
