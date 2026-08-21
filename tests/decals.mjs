// The flag on the flank.
//
//   npm run dev
//   node tests/decals.mjs
//
// The Kuwait flag was 96 by 48 pixels on a plane 240 mm long — 400
// texels to the metre, which is a quarter of what the crew emblem gets
// and less than a fifth of what a road sign in this game gets. The one
// edge in the flag that is not horizontal is the hoist trapezoid's, and
// at that size it is a nine-pixel staircase that the mipmap softens into
// a smear before it reaches the screen. It read as three coloured
// stripes with a dark blob on one end.
//
// A flag is also a real thing with a construction, and the old one had
// it slightly wrong: the trapezoid's base was 29% of the length where
// the 1961 decree says a quarter. Close enough to look right, which is
// exactly why nothing ever caught it.
//
//   sharp     enough texels per metre that magnifying it does not blur
//   built     the 1961 construction, measured off the canvas: three
//             equal bands, and a hoist trapezoid whose base is a QUARTER
//             of the length
//   colours   the flag's own green, white and red, not approximations
//   big       a flag rather than a sticker
//   clear     and it lands on paint, not through the beltline stripe or
//             the door roundel, on every silhouette in the fleet
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
await page.waitForFunction(() => !!window.__grnBuildCar, null, { timeout: 180000 });
await page.waitForTimeout(1500);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// --- The flag itself, read off its own canvas --------------------------
const flag = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const g = window.__grnBuildCar({ body: 0xffffff, style: "sedan", stickers: true });
  g.updateMatrixWorld(true);
  // The flag is the only 2:1 decal on the car.
  let mesh = null;
  g.traverse((o) => {
    const img = o.material?.map?.image;
    if (!o.isMesh || !img || !img.width) return;
    if (Math.abs(img.width / img.height - 2) < 0.01 && img.width >= 48) mesh = o;
  });
  if (!mesh) return null;
  const img = mesh.material.map.image;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const at = (x, y) => {
    const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const W = img.width;
  const H = img.height;
  // Band colours, sampled well clear of the hoist and the keyline.
  const bands = [at(W * 0.7, H * 0.17), at(W * 0.7, H * 0.5), at(W * 0.7, H * 0.83)];
  // Where the black hoist ends, scanned along the flag's own centreline —
  // which is where the trapezoid is at its widest.
  let base = 0;
  for (let x = 0; x < W; x++) {
    const [r, gg, b] = at(x, H / 2);
    if (r + gg + b > 120) { base = x; break; }
  }
  // And the band boundaries, scanned down the far end.
  // Clustered, because an anti-aliased edge changes colour twice: once
  // into the blend and once out of it, and counting both reports four
  // boundaries on a flag that has two.
  const raw = [];
  let prev = at(W * 0.9, 0).join();
  for (let y = 1; y < H; y++) {
    const now = at(W * 0.9, y).join();
    if (now !== prev) raw.push(y);
    prev = now;
  }
  const rows = [];
  for (const y of raw) {
    if (!rows.length || y - rows[rows.length - 1] > H * 0.02) rows.push(y);
  }
  const plane = mesh.geometry.parameters;
  const bb = new THREE.Box3().setFromObject(mesh);
  g.traverse((o) => o.geometry && o.geometry.dispose?.());
  return {
    W, H, bands, base,
    // Two boundaries expected: green/white and white/red. The keyline
    // adds one at each extreme, so take the two nearest the thirds.
    boundaries: rows.filter((y) => y > H * 0.1 && y < H * 0.9),
    plane: [plane.width, plane.height],
    world: [+(bb.max.x - bb.min.x).toFixed(3), +(bb.max.y - bb.min.y).toFixed(3)],
  };
});

if (!flag) {
  check(false, "no 2:1 decal on a sticker-pack car — the flag is not being built");
} else {
  const perMetre = flag.W / flag.plane[0];
  console.log(
    `flag      ${flag.W}x${flag.H} texels on a ${flag.plane[0]} x ${flag.plane[1]} m plane`
  );
  console.log(
    `sharp     ${check(
      perMetre >= 1800,
      `${perMetre.toFixed(0)} texels per metre — it will blur the moment anything looks at it closely`
    )}  ${perMetre.toFixed(0)} texels per metre`
  );
  console.log(
    `big       ${check(
      flag.plane[0] >= 0.3,
      `${(flag.plane[0] * 1000).toFixed(0)} mm long — that is a sticker, not a flag`
    )}  ${(flag.plane[0] * 1000).toFixed(0)} mm long on the fender`
  );
  // The 1961 construction. The trapezoid's base is a quarter of the
  // length; the bands are equal thirds.
  const baseFrac = flag.base / flag.W;
  console.log(
    `built     ${check(
      Math.abs(baseFrac - 0.25) < 0.015,
      `the hoist trapezoid takes ${(baseFrac * 100).toFixed(1)}% of the length, not a quarter`
    )}  hoist base ${(baseFrac * 100).toFixed(1)}% of the length`
  );
  const thirds = flag.boundaries.map((y) => y / flag.H);
  const bandsOk =
    thirds.length === 2 &&
    Math.abs(thirds[0] - 1 / 3) < 0.02 &&
    Math.abs(thirds[1] - 2 / 3) < 0.02;
  console.log(
    `bands     ${check(
      bandsOk,
      `band boundaries at ${thirds.map((t) => (t * 100).toFixed(0) + "%").join(", ")} — not equal thirds`
    )}  ${thirds.map((t) => (t * 100).toFixed(1) + "%").join(" and ")} down the flag`
  );
  const want = [
    [0, 122, 61],
    [244, 244, 244],
    [206, 17, 38],
  ];
  const off = flag.bands.map((b, i) =>
    Math.max(...b.map((v, k) => Math.abs(v - want[i][k])))
  );
  console.log(
    `colours   ${check(
      off.every((d) => d <= 6),
      `bands read ${flag.bands.map((b) => b.join(",")).join(" / ")} against ` +
        `${want.map((b) => b.join(",")).join(" / ")}`
    )}  green, white and red, within ${Math.max(...off)} of the flag's own`
  );
}

// --- And it lands on clean paint, on every body ------------------------
//
// The flag is measured DOWN from the beltline stripe rather than off the
// body crease for exactly this reason: at the new size, hung off the
// crease, it ran through the stripe on all five silhouettes.
const clash = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const out = [];
  for (const style of ["sedan", "zx", "gtr", "rx7", "hatch"]) {
    const g = window.__grnBuildCar({ body: 0xffffff, style, stickers: true, name: "Test" });
    g.updateMatrixWorld(true);
    // Every decal on the right-hand flank, as a box in the car's own space.
    const boxes = [];
    for (const o of g.children) {
      const img = o.material?.map?.image;
      if (!o.isMesh || !img || !img.width || !o.material.transparent) continue;
      if (o.position.x <= 0) continue; // one side is enough; they mirror
      o.updateMatrix();
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrix);
      boxes.push({
        tag: `${img.width}x${img.height}`,
        flag: Math.abs(img.width / img.height - 2) < 0.01 && img.width >= 48,
        y0: b.min.y, y1: b.max.y, z0: b.min.z, z1: b.max.z,
      });
    }
    const f = boxes.find((b) => b.flag);
    if (!f) { out.push({ style, found: false }); continue; }
    // Anything else on this flank that shares both a height band and a
    // stretch of the car with it is lying on top of it.
    // A real gap, not merely "not intersecting". Two decals whose edges
    // meet exactly read as one long sticker, and that is how the flag
    // and the wordmark first came out of this: touching at 0.78 m with
    // nothing between them.
    const GAP = 0.015;
    const over = boxes.filter(
      (b) =>
        b !== f &&
        b.y0 < f.y1 + GAP && b.y1 > f.y0 - GAP &&
        b.z0 < f.z1 + GAP && b.z1 > f.z0 - GAP
    );
    out.push({
      style,
      found: true,
      overlaps: over.length,
      what: over.map((b) => b.tag).join(", "),
      y: `${f.y0.toFixed(2)}..${f.y1.toFixed(2)}`,
      z: `${f.z0.toFixed(2)}..${f.z1.toFixed(2)}`,
    });
    g.traverse((o) => o.geometry && o.geometry.dispose?.());
  }
  return out;
});
let clashes = 0;
for (const c of clash) {
  if (!c.found) { check(false, `the ${c.style} carries no flag`); continue; }
  if (c.overlaps) clashes++;
  console.log(
    `  ${c.style.padEnd(7)} ${c.overlaps ? "FAIL" : "ok  "}  flag at y ${c.y}, z ${c.z}` +
      (c.overlaps ? `  under ${c.what}` : "")
  );
}
console.log(
  `clear     ${check(
    clashes === 0,
    `${clashes} silhouette(s) put another decal through the flag`
  )}  five bodies, nothing lying on it`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe flag is a flag.");
