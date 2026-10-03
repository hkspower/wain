// The black end of the 4K stills, read off the files.
//
//   node tools/shots/stillblacks.mjs                    # press/ik/4k, bars enforced
//   node tools/shots/stillblacks.mjs --report           # print, never fail
//   node tools/shots/stillblacks.mjs some/dir --report
//   npm run check:stillblacks
//   npm run check:stillblacks:rules                     # the instrument, on frames with known answers
//
// No browser and no dev server: node and sharp over the PNGs that
// tools/shots/ik4k.mjs already wrote (the .jpg copy if the lossless frame
// is not on this machine; the PNGs are kept out of git). About a second
// a frame.
//
// WHY THIS EXISTS BESIDE blacks.mjs AND dark.mjs
//
// Both of those drive the game and measure LUMA: how much of the frame
// sits at or near zero, and whether a dark tile holds detail a lift would
// reveal. Neither can see a cast. A night still whose darkest pixels are
// 34,24,19 and whose zenith is 13,39,115 passes every luma bar this repo
// has — and reads, to anybody looking at it, as a milky floor under a
// royal-blue sky. That is what the stills were: graded through ACES,
// whose toe (RRTAndODTFit's -0.000090537 offset) zeroes a dark pixel's
// weakest channel first and multiplies whatever cast it had two to four
// times, with nothing after OutputPass taking it back out; and pinned a
// stop over the meter's night floor with half the shadow lift still on
// top. So this asks the colour questions as well as the depth ones, of
// the pictures people actually see.
//
// WHAT IT MEASURES, per still, on Rec.709 luma of the 8-bit DISPLAYED
// pixel into a 256-bin histogram (percentiles from the histogram, no
// sort, so 8.3 Mpx is about a second):
//
//   p0.1 p1 p5 p50   luma percentiles
//   <=2 <=8          share of the frame at or below 2/255 and 8/255
//   dark2            mean RGB of the darkest 2% by luma — every bin under
//                    the 2% cut plus a pro-rata share of the cut bin, so
//                    it is exactly 2% of the frame however the bins fall —
//                    with its chroma (max - min) and R - B
//   Y<64             the shadow set: its share of the frame, its mean
//                    per-pixel chroma, and the share of it that is blue
//                    (B > 1.5 R) or warm (R > 1.3 B)
//   zenith           the top 5% of rows across the centre 60% of columns:
//                    mean RGB and B - R. On the night stills that is the
//                    sky (traffic's top rows are only about 10-16° up, in
//                    the horizon-to-zenith gradient, hence its own bar)
//
// THE BARS (night stills; the day still, driver, is held to the crush
// guard only). A first draft, from a node model of the shipped chain —
// exposure, three r184's ACES, sRGB, GradeShader at the shipped player
// defaults (brightness 1.12, contrast 1.18, saturation 1.08) — with the
// night sky, the black neutraliser, the stills' lift and the neutral
// night IBL in it:
//
//   p1 <= 18 (traffic <= 32)          the floor is a floor, not grey
//   <=2/255 <= 0.5% and p0.1 >= 3     ...and it has not been crushed to get there
//   Y<64 mean chroma <= 28            the shadows are not tinted
//   zenith B - R <= 18 (traffic <= 26) the night sky is not royal blue
//   dark2 |R - B| <= 12 (traffic <= 20) the darkest 2% are neither brown nor navy
//   driver: <=2/255 <= 1%
//
// Rules for the bars: after the first render with the look changes in,
// each bar is tightened to the measurement plus a margin and never
// loosened past the BEFORE below. The run writes blacks.json next to the
// stills, so the history is in git beside the pictures it describes.
// Exit 1 on any bar unless --report.
//
// BEFORE: the 3840x2160 PNGs rendered for f1a525c4 (ik4k at EV+1 through
// setManualExposure, so uLiftScale 0.5; the night sky, IBL, fog and grade
// as they were then). Every night still fails, on purpose:
//
//   metric               lock       sweep      brake      drift      traffic    driver
//   p0.1 / p1            10 / 26    6 / 22     12 / 20    14 / 27    41 / 49    3 / 16
//   p5 / p50             39 / 70    38 / 89    31 / 68    39 / 87    63 / 114   26 / 124
//   <=2 / <=8            0.00/0.06% 0.02/0.22% 0.01/0.03% 0.00/0.02% 0.00/0.00% 0.09/0.48%
//   Y<64 share           39.9%      33.5%      41.1%      22.2%      5.3%       22.3%
//   Y<64 chroma          65.5       76.2       51.6       43.7       58.9       41.1
//   Y<64 blue / warm     64 / 11%   77 / 13%   38 / 36%   29 / 45%   55 / 45%   29 / 44%
//   zenith RGB           22,45,114  33,53,111  42,48,91   45,55,101  68,73,130  (cabin)
//   zenith B-R           91.7       78.8       49.0       55.4       61.8       -
//   dark2 RGB            33,23,19   22,21,10   33,16,16   37,23,22   65,47,26   28,9,14
//   dark2 chroma / R-B   14.0/14.0  12.3/12.3  17.7/17.0  15.4/15.4  39.2/39.2  18.4/13.9
//
// That is the 1280 JPEG downscale the look changes were designed against
// (p1 27/22/20/27/49/16, Y<64 chroma 64/76/51/44/59/41, zenith B-R
// 91/79/49/56/62, dark2 R-B 15/10/18/15/39) to within a level and a half
// everywhere but sweep's dark2 R-B, 12.3 against 10 — a downscale
// averages the darkest pixels with their neighbours, which is why the
// full frame is the one to hold a bar against. Read the stills this way:
// the floor is grey (p1 20 to 27 against a bar of 18), the sky is royal
// blue (B-R up to 92), the shadows carry a blue cast in lock and sweep
// and a brown one in brake and drift (Y<64 blue share 64-77% against
// warm 36-45%), and nothing is crushed. The problem is colour and lift,
// not depth.

import sharp from "sharp";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NIGHT = ["lock", "sweep", "brake", "drift", "traffic"];
const DAY = ["driver"];

/**
 * Every number above, from one decoded frame. `px` is packed 8-bit RGB
 * (three bytes a pixel, alpha already removed), `w` x `h`.
 */
export function measure(px, w, h) {
  const n = w * h;
  const hist = new Float64Array(256);
  // Per-bin channel sums, so the darkest 2% can be averaged in colour
  // from the histogram without a sort.
  const sr = new Float64Array(256), sg = new Float64Array(256), sb = new Float64Array(256);
  let n64 = 0, chroma64 = 0, blue64 = 0, warm64 = 0;
  for (let i = 0, p = 0; i < n; i++, p += 3) {
    const r = px[p], g = px[p + 1], b = px[p + 2];
    const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    hist[y]++; sr[y] += r; sg[y] += g; sb[y] += b;
    if (y < 64) {
      n64++;
      chroma64 += Math.max(r, g, b) - Math.min(r, g, b);
      if (b > 1.5 * r) blue64++;
      if (r > 1.3 * b) warm64++;
    }
  }
  const pct = (q) => {
    const want = q * n;
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= want) return v; }
    return 255;
  };
  const under = (t) => { let s = 0; for (let v = 0; v <= t; v++) s += hist[v]; return s / n; };
  // The darkest 2%, pro rata through the cut bin.
  const cut = 0.02 * n;
  let acc = 0, dr = 0, dg = 0, db = 0;
  for (let v = 0; v < 256 && acc < cut; v++) {
    if (!hist[v]) continue;
    const take = Math.min(hist[v], cut - acc) / hist[v];
    dr += sr[v] * take; dg += sg[v] * take; db += sb[v] * take;
    acc += hist[v] * take;
  }
  const dark2 = [dr / acc, dg / acc, db / acc];
  // The zenith patch.
  const zh = Math.max(1, Math.floor(h * 0.05));
  const x0 = Math.floor(w * 0.2), x1 = Math.max(x0 + 1, Math.ceil(w * 0.8));
  let zr = 0, zg = 0, zb = 0, zn = 0;
  for (let y = 0; y < zh; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * w + x) * 3;
      zr += px[p]; zg += px[p + 1]; zb += px[p + 2]; zn++;
    }
  }
  const zen = [zr / zn, zg / zn, zb / zn];
  return {
    p01: pct(0.001), p1: pct(0.01), p5: pct(0.05), p50: pct(0.5),
    le2: under(2), le8: under(8),
    dark2, dark2Chroma: Math.max(...dark2) - Math.min(...dark2), dark2RB: dark2[0] - dark2[2],
    y64: n64 / n, y64Chroma: n64 ? chroma64 / n64 : 0,
    y64Blue: n64 ? blue64 / n64 : 0, y64Warm: n64 ? warm64 / n64 : 0,
    zenith: zen, zenithBR: zen[2] - zen[0],
  };
}

/** The bars a still is held to, as [what, passed, measured, limit]. */
export function bars(name, m) {
  if (DAY.includes(name)) {
    return [["<=2/255 share", m.le2 <= 0.01, pc(m.le2), "<= 1%"]];
  }
  const t = name === "traffic";
  return [
    ["p1", m.p1 <= (t ? 32 : 18), m.p1, `<= ${t ? 32 : 18}`],
    ["<=2/255 share", m.le2 <= 0.005, pc(m.le2), "<= 0.5%"],
    ["p0.1", m.p01 >= 3, m.p01, ">= 3"],
    ["Y<64 chroma", m.y64Chroma <= 28, m.y64Chroma.toFixed(1), "<= 28"],
    ["zenith B-R", m.zenithBR <= (t ? 26 : 18), m.zenithBR.toFixed(1), `<= ${t ? 26 : 18}`],
    ["dark2 |R-B|", Math.abs(m.dark2RB) <= (t ? 20 : 12), m.dark2RB.toFixed(1), `<= ${t ? 20 : 12}`],
  ];
}

const pc = (v) => `${(v * 100).toFixed(2)}%`;
const rgb = (c) => c.map((v) => Math.round(v)).join(",");

async function decode(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`${file}: ${info.channels} channels after removeAlpha`);
  return { px: data, w: info.width, h: info.height };
}

// ---- the instrument, against frames with known answers ----------------
//
// Every number this prints is a claim about a picture, and the two that
// are easy to get wrong are the two that are not plain counts: the
// pro-rata cut through the 2% bin, and which rows and columns are the
// zenith. So both are checked on synthetic frames whose answers are
// written down before the tool sees them.
async function selfTest() {
  const fail = [];
  const check = (c, m) => { if (!c) fail.push(m); };
  const frame = (w, h, at) => {
    const px = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = at(x, y, y * w + x);
      px.set(c, (y * w + x) * 3);
    }
    return { px, w, h };
  };
  // 1. A flat grey: every percentile is the grey, nothing is dark,
  //    nothing has colour.
  {
    const f = frame(40, 20, () => [12, 12, 12]);
    const m = measure(f.px, f.w, f.h);
    check(m.p01 === 12 && m.p1 === 12 && m.p50 === 12, `flat 12: percentiles ${m.p01}/${m.p1}/${m.p50}, not 12`);
    check(m.le2 === 0 && m.le8 === 0, "flat 12: reported pixels at or below 8");
    check(m.dark2Chroma === 0 && m.zenithBR === 0 && m.y64Chroma === 0, "flat grey: reported colour");
    check(m.y64 === 1, "flat 12: not all of it is under 64");
  }
  // 2. The 2% cut lands inside a bin. 1000 px: 10 at (2,1,0) (luma 1),
  //    20 at (10,10,10), the rest at 100. The darkest 2% is 20 px: all
  //    ten of the first and HALF of the second, so its mean is
  //    (6, 5.5, 5) — not (10,10,10)-weighted, not the first bin alone.
  {
    const f = frame(100, 10, (x, y, i) => (i < 10 ? [2, 1, 0] : i < 30 ? [10, 10, 10] : [100, 100, 100]));
    const m = measure(f.px, f.w, f.h);
    const ok = Math.abs(m.dark2[0] - 6) < 1e-9 && Math.abs(m.dark2[1] - 5.5) < 1e-9 && Math.abs(m.dark2[2] - 5) < 1e-9;
    check(ok, `pro-rata dark2 came out ${m.dark2.map((v) => v.toFixed(3))}, not 6,5.5,5`);
    check(Math.abs(m.dark2RB - 1) < 1e-9 && Math.abs(m.dark2Chroma - 1) < 1e-9, "dark2 R-B / chroma wrong");
    check(m.p1 === 1 && m.p5 === 100 && m.p01 === 1, `percentiles ${m.p01}/${m.p1}/${m.p5}, not 1/1/100`);
    check(Math.abs(m.le2 - 0.01) < 1e-12 && Math.abs(m.le8 - 0.01) < 1e-12, `<=2 ${m.le2}, <=8 ${m.le8}, not 1%`);
  }
  // 3. The zenith is the top 5% of rows, centre 60% of columns, and
  //    nothing else. 200 x 100: rows 0-4, columns 40-159 are navy; the
  //    columns either side of them and the row under them are red.
  {
    const f = frame(200, 100, (x, y) =>
      y < 5 && x >= 40 && x < 160 ? [10, 20, 90] : y <= 5 ? [200, 0, 0] : [50, 50, 50]);
    const m = measure(f.px, f.w, f.h);
    check(rgb(m.zenith) === "10,20,90" && m.zenithBR === 80, `zenith read ${rgb(m.zenith)}, B-R ${m.zenithBR} — it is sampling outside its patch`);
  }
  // 4. The shadow set's colour shares. Half the dark pixels blue (B 2x
  //    R), a quarter warm (R 2x B), a quarter grey; the bright half of
  //    the frame is not in the set. (Brightness here is luma, so a pure
  //    255,0,0 is luma 54 and IS in the shadow set — a tail lamp's red
  //    is not bright to the eye — which is why the bright half is grey.)
  {
    const f = frame(4, 2, (x, y) => (y ? [200, 200, 200] : [[10, 10, 20], [10, 10, 20], [20, 10, 10], [10, 10, 10]][x]));
    const m = measure(f.px, f.w, f.h);
    check(m.y64 === 0.5 && m.y64Blue === 0.5 && m.y64Warm === 0.25,
      `Y<64 share ${m.y64}, blue ${m.y64Blue}, warm ${m.y64Warm} — not 0.5 / 0.5 / 0.25`);
    check(Math.abs(m.y64Chroma - 7.5) < 1e-9, `Y<64 chroma ${m.y64Chroma}, not 7.5`);
  }
  // 5. The bars fire, and only on what they are about.
  {
    const crushed = frame(100, 10, (x, y, i) => (i < 10 ? [0, 0, 0] : [30, 30, 30]));
    const m = measure(crushed.px, crushed.w, crushed.h);
    const b = bars("lock", m);
    const failed = b.filter(([, ok]) => !ok).map(([k]) => k);
    check(failed.join() === "<=2/255 share,p0.1", `a 1% crush failed ${failed.join(", ") || "nothing"}, not exactly the crush guard`);
    const day = bars("driver", m);
    check(day.length === 1 && day[0][1], "the day still is held to more than the crush guard, or 1% failed it");
  }
  console.log(fail.length ? `instrument FAILS:\n  ${fail.join("\n  ")}` : "the instrument reads frames with known answers correctly");
  return fail.length === 0;
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  process.exit((await selfTest()) ? 0 : 1);
}
// Checked every run, not only when asked: a wrong instrument fails
// everything quietly.
if (!(await selfTest())) process.exit(2);

const REPORT = args.includes("--report");
const DIR = args.find((a) => !a.startsWith("--")) ?? "press/ik/4k";
const t0 = Date.now();
const rows = [];
for (const name of [...NIGHT, ...DAY]) {
  const png = join(DIR, `${name}.png`), jpg = join(DIR, `${name}.jpg`);
  const file = existsSync(png) ? png : existsSync(jpg) ? jpg : null;
  if (!file) { console.log(`${name}: no frame in ${DIR}`); continue; }
  const f = await decode(file);
  const m = measure(f.px, f.w, f.h);
  rows.push({ name, file, size: `${f.w}x${f.h}`, m, bars: bars(name, m) });
}
if (!rows.length) { console.error(`no stills in ${DIR}`); process.exit(2); }

const col = (s, w = 15) => String(s).padStart(w);
const line = (label, f) => console.log(label.padEnd(20) + rows.map((r) => col(f(r.m, r.name))).join(""));
console.log(`${DIR}  (${rows.map((r) => `${r.name} ${r.file.endsWith(".png") ? "png" : "JPEG"} ${r.size}`).join(", ")})`);
console.log("".padEnd(20) + rows.map((r) => col(r.name)).join(""));
line("p0.1 / p1", (m) => `${m.p01} / ${m.p1}`);
line("p5 / p50", (m) => `${m.p5} / ${m.p50}`);
line("<=2 / <=8", (m) => `${(m.le2 * 100).toFixed(2)} / ${(m.le8 * 100).toFixed(2)}%`);
line("Y<64 share", (m) => pc(m.y64));
line("Y<64 chroma", (m) => m.y64Chroma.toFixed(1));
line("Y<64 blue / warm", (m) => `${(m.y64Blue * 100).toFixed(0)} / ${(m.y64Warm * 100).toFixed(0)}%`);
line("zenith RGB", (m) => rgb(m.zenith));
line("zenith B-R", (m, n) => (DAY.includes(n) ? "-" : m.zenithBR.toFixed(1)));
line("dark2 RGB", (m) => rgb(m.dark2));
line("dark2 chroma / R-B", (m) => `${m.dark2Chroma.toFixed(1)} / ${m.dark2RB.toFixed(1)}`);

const failures = [];
console.log("");
for (const r of rows) {
  const bad = r.bars.filter(([, ok]) => !ok);
  for (const [k, , v, lim] of bad) failures.push(`${r.name}: ${k} ${v}, bar ${lim}`);
  console.log(`${r.name.padEnd(8)} ${bad.length ? "FAIL" : "ok  "}  ` +
    r.bars.map(([k, ok, v, lim]) => `${k} ${v} (${lim})${ok ? "" : " x"}`).join("  "));
}

const round = (v, d = 2) => +v.toFixed(d);
writeFileSync(join(DIR, "blacks.json"), JSON.stringify({
  tool: "tools/shots/stillblacks.mjs",
  measured: new Date().toISOString(),
  stills: Object.fromEntries(rows.map(({ name, file, size, m, bars: b }) => [name, {
    file: file.split("/").pop(), size,
    p01: m.p01, p1: m.p1, p5: m.p5, p50: m.p50,
    le2: round(m.le2, 5), le8: round(m.le8, 5),
    dark2: m.dark2.map((v) => round(v, 1)), dark2Chroma: round(m.dark2Chroma, 1), dark2RB: round(m.dark2RB, 1),
    y64: round(m.y64, 4), y64Chroma: round(m.y64Chroma, 1), y64Blue: round(m.y64Blue, 3), y64Warm: round(m.y64Warm, 3),
    zenith: m.zenith.map((v) => round(v, 1)), zenithBR: round(m.zenithBR, 1),
    failed: b.filter(([, ok]) => !ok).map(([k]) => k),
  }])),
}, null, 1) + "\n");
console.log(`\nwrote ${join(DIR, "blacks.json")} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (failures.length) {
  console.log(`\n${failures.length} bar(s) not met${REPORT ? " (--report: not failing)" : ""}:`);
  for (const f of failures) console.log(`  ${f}`);
  if (!REPORT) process.exit(1);
} else {
  console.log("\nthe blacks are black, and neutral.");
}
