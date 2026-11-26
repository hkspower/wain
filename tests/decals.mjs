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

// --- And it keeps off the flare ----------------------------------------
//
// flankRun measures the arch at the height of the beltline stripe, which
// is the highest line on the flank and the one the arch reaches least.
// The flag hangs 0.2 m down from there, where the arch reaches further
// back, and it was placed 40 mm short of the stripe's run: the hoist
// corner stood in the front flare by up to 187 mm (the SUV in the attack
// kit), by 9 to 49 mm on the sedan, the gtr and the hatch, and merely
// touched it on most of the rest. Read the way the eye reads it: the flag's front edge against the
// least z any part of the front flare reaches in the flag's own band of
// height, in the world, every body in every kit.
const flareGap = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const out = [];
  const v = new THREE.Vector3();
  for (const kit of ["street", "sport", "attack"]) {
    for (const style of ["sedan", "zx", "gtr", "rx7", "hatch", "pony", "pickup", "super", "suv"]) {
      const g = window.__grnBuildCar({
        body: 0xffffff, style, kit, raceKit: kit === "attack", stickers: true, name: "Test",
      });
      g.updateMatrixWorld(true);
      let flag = null;
      const flares = [];
      g.traverse((o) => {
        if (!o.isMesh) return;
        if (o.userData.decal === "flag" && o.position.x > 0) flag = o;
        if (o.userData.archFlare && o.position.x > 0 && o.position.z > 0) flares.push(o);
      });
      if (!flag) { out.push({ kit, style, found: false }); continue; }
      const fb = new THREE.Box3().setFromObject(flag);
      let minZ = Infinity;
      for (const f of flares) {
        const pa = f.geometry.getAttribute("position");
        for (let k = 0; k < pa.count; k++) {
          v.fromBufferAttribute(pa, k).applyMatrix4(f.matrixWorld);
          if (v.y >= fb.min.y && v.y <= fb.max.y && v.x > 0.5) minZ = Math.min(minZ, v.z);
        }
      }
      out.push({ kit, style, found: true, gap: minZ - fb.max.z, hasFlare: Number.isFinite(minZ) });
      g.traverse((o) => o.geometry && o.geometry.dispose?.());
    }
  }
  return out;
});
let tight = 0;
for (const c of flareGap) {
  if (!c.found) { check(false, `the ${c.style} (${c.kit}) carries no flag`); tight++; continue; }
  if (!c.hasFlare) { check(false, `the ${c.style} (${c.kit}) has no front flare to measure against`); tight++; continue; }
  if (c.gap < 0.015) {
    tight++;
    console.log(`  ${c.kit.padEnd(6)} ${c.style.padEnd(7)} FAIL  the flag is ${(c.gap * 1000).toFixed(0)} mm from the flare`);
  }
}
console.log(
  `off flare ${check(
    tight === 0,
    `${tight} of ${flareGap.length} flag(s) are within 15 mm of the front flare, or over it`
  )}  ${flareGap.length} body/kit pairs, least gap ${(Math.min(...flareGap.filter((c) => c.found).map((c) => c.gap)) * 1000).toFixed(0)} mm`
);

// --- The wordmark is whole, on every car -------------------------------
//
// nameDecalTexture drew the Latin name at a fixed 108 px with 12 px
// tracking on a 1024 px canvas. 'BAREED 30 ANNIVERSARY' is about 1230 px
// at that, so the flank read 'AREED 30 ANNIVERSAI'. Nothing measured the
// ink against the canvas, so it sat there. Read off the decal's own
// canvas, on every car the showroom lists: no ink on the two edge
// columns, and the ink's bounding box at least 40 px inside them.
const words = await page.evaluate(() => {
  const out = [];
  // The width each name would have at the fleet's 108 px with 12 px
  // tracking, the way cars.ts measures it. Anything over 940 is shrunk to
  // fit; everything else is drawn exactly as it always was.
  const stack = getComputedStyle(document.body).getPropertyValue("--font-display-stack").trim() || "sans-serif";
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = `800 108px ${stack}`;
  probe.letterSpacing = "0px";
  for (const car of window.__grnCars) {
    if (!car.name) continue;
    const natural = probe.measureText(car.name.toUpperCase()).width + 12 * car.name.length;
    const g = window.__grnBuildCar({
      body: car.color, style: car.style, stickers: true, name: car.name, nameAr: car.ar,
    });
    let img = null;
    g.traverse((o) => {
      const i = o.isMesh && o.material?.map?.image;
      // The flank wordmark is the only 4:1 canvas on the car, 1024 wide.
      if (i && i.width === 1024 && i.height === 256) img = i;
    });
    if (!img) { out.push({ id: car.id, name: car.name, found: false }); continue; }
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, x1 = -1, edge = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (d[(y * c.width + x) * 4 + 3] < 8) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (x === 0 || x === c.width - 1) edge++;
      }
    }
    out.push({ id: car.id, name: car.name, found: true, x0, x1, w: c.width, edge, natural });
    g.traverse((o) => o.geometry && o.geometry.dispose?.());
  }
  return out;
});
let clipped = 0;
const shrunk = words.filter((w) => w.natural > 940);
console.log(
  `  shrunk to fit: ${shrunk.length ? shrunk.map((w) => `${w.id} (${w.natural.toFixed(0)} px at the fleet size)`).join(", ") : "none"}; ` +
    `the other ${words.length - shrunk.length} are drawn at the fleet's 108 px, widest ` +
    `${Math.max(...words.filter((w) => w.natural <= 940).map((w) => w.natural)).toFixed(0)} px`
);
for (const w of words) {
  if (!w.found) { check(false, `${w.id} (${w.name}) wears no flank wordmark`); clipped++; continue; }
  const left = w.x0;
  const right = w.w - 1 - w.x1;
  const bad = w.edge > 0 || left < 40 || right < 40;
  if (bad) clipped++;
  console.log(
    `  ${w.id.padEnd(16)} ${bad ? "FAIL" : "ok  "}  ink ${w.x0}..${w.x1} of ${w.w}` +
      `  (${left} px left, ${right} px right${w.edge ? `, ${w.edge} px on the edge` : ""})`
  );
}
console.log(
  `whole     ${check(
    clipped === 0 && words.length > 0,
    `${clipped} flank wordmark(s) run to the canvas edge`
  )}  ${words.length} names, each at least 40 px inside the canvas`
);

// --- The hood falcon reads on any paint --------------------------------
//
// The falcon and its two lines of type are near-white, which is right on
// the accent bar they were laid out for and nothing on bare paint. The
// Arabic line is 0.56 m wide on a 0.46 m bar, so its end letters landed
// on the paint beside it: white on pale yellow is 1.4:1. On the one car
// with twin stripes there is no bar at all, and the whole falcon was
// white on a white bonnet, straddling both stripes.
//
//   edged     every light pixel has a dark one between it and the clear
//             part of the texture, so each letter and each wing carries
//             its own edge whatever it lies on. Measured on the texture:
//             no light pixel may touch a transparent one.
//   yellow    that edge, laid over the yellow Efreet RX Kai's paint, is
//             at least 4:1 against the ink
//   twin      on the Bareed the falcon is dark (at least 4.5:1 against
//             its white paint), has no lines of type, and all of it lies
//             in the gap between the stripes
const hoods = await page.evaluate(() => {
  const luma = (r, g, b) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const hex = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const out = {};
  for (const id of ["efreet-rx-kai", "anniversary-30"]) {
    const car = window.__grnCars.find((c) => c.id === id);
    if (!car) { out[id] = null; continue; }
    const g = window.__grnBuildCar({
      body: car.color, style: car.style, accent: car.accent, stripes: car.stripes, stickers: true,
    });
    g.updateMatrixWorld(true);
    let hood = null;
    const stripes = [];
    g.traverse((o) => {
      if (o.userData.decal === "hood-falcon") hood = o;
      if (o.isMesh && o.material?.name === "accent-stripe") stripes.push(o);
    });
    if (!hood) { out[id] = { found: false }; continue; }
    const img = hood.material.map.image;
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const W = c.width, H = c.height;
    const at = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
    let light = 0, bare = 0, x0 = W, x1 = -1, ink = null;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const [r, gg, b, a] = at(x, y);
        if (a < 128) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        const isLight = r > 190 && gg > 190 && b > 190;
        if (!isLight) continue;
        light++;
        if (!ink) ink = [r, gg, b];
        // A light pixel with a clear one right beside it has no edge.
        if (at(x - 1, y)[3] < 40 || at(x + 1, y)[3] < 40 || at(x, y - 1)[3] < 40 || at(x, y + 1)[3] < 40) bare++;
      }
    }
    // Ink colour for the twin variant: the commonest opaque pixel.
    const tally = new Map();
    for (let i = 0; i < d.length; i += 4 * 17) {
      if (d[i + 3] < 250) continue;
      const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    const common = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0].split(",").map(Number) ?? null;
    // The plane, in the car's own frame.
    const inv = g.matrixWorld.clone().invert();
    const plane = hood.geometry.parameters.width;
    const inkLeft = (x0 / W - 0.5) * plane, inkRight = (x1 / W - 0.5) * plane;
    let gap = Infinity;
    for (const s of stripes) {
      const b = new window.__grnThree.Box3().setFromObject(s).applyMatrix4(inv);
      gap = Math.min(gap, Math.abs(b.min.x), Math.abs(b.max.x));
    }
    const body = hex(car.color);
    // The edge as it lands on this car's paint: alpha 0.65 on the wings,
    // 0.9 on the type, the weaker of the two.
    const ringOnPaint = body.map((v, k) => 0.65 * [10, 12, 16][k] + 0.35 * v);
    out[id] = {
      found: true, light, bare,
      inkRatio: ink ? (luma(...ink) + 0.05) / (luma(...ringOnPaint) + 0.05) : 0,
      common,
      commonVsPaint: common ? (Math.max(luma(...common), luma(...body)) + 0.05) / (Math.min(luma(...common), luma(...body)) + 0.05) : 0,
      span: plane, reach: Math.max(Math.abs(inkLeft), Math.abs(inkRight)), gap: Number.isFinite(gap) ? gap : null,
    };
    g.traverse((o) => o.geometry && o.geometry.dispose?.());
  }
  return out;
});
{
  const y = hoods["efreet-rx-kai"];
  if (!y?.found) check(false, "efreet-rx-kai wears no hood falcon");
  else {
    const frac = y.bare / Math.max(1, y.light);
    console.log(
      `edged     ${check(
        frac < 0.01,
        `${(frac * 100).toFixed(2)}% of the falcon's light pixels touch a clear one — no dark edge there`
      )}  ${y.light} light pixels, ${y.bare} with no edge`
    );
    console.log(
      `yellow    ${check(
        y.inkRatio >= 4,
        `ink against its own edge on yellow paint is ${y.inkRatio.toFixed(1)}:1, want 4:1`
      )}  ${y.inkRatio.toFixed(1)}:1 against the edge laid on the Kai's paint`
    );
  }
  const t = hoods["anniversary-30"];
  if (!t?.found) check(false, "anniversary-30 wears no hood falcon");
  else {
    console.log(
      `twin ink  ${check(
        t.commonVsPaint >= 4.5,
        `falcon ink ${t.common?.join(",")} against white paint is ${t.commonVsPaint.toFixed(1)}:1, want 4.5:1`
      )}  ink ${t.common?.join(",")} is ${t.commonVsPaint.toFixed(1)}:1 against the white paint`
    );
    console.log(
      `twin gap  ${check(
        t.gap !== null && t.reach <= 0.125 && t.reach < t.gap,
        `falcon ink reaches |x| ${t.reach.toFixed(3)} against stripes at ${t.gap?.toFixed(3)} — it crosses one`
      )}  ink to |x| ${t.reach.toFixed(3)}, stripes start at ${t.gap?.toFixed(3)}, plane ${t.span.toFixed(2)} m`
    );
  }
}

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe flag is a flag.");
