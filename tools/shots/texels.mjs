// Where the picture is pixelated, and by how much.
//
//   npm run dev
//   node tools/shots/texels.mjs
//
// tools/shots/edges.mjs measures the SILHOUETTES — the boundary between
// a building and the sky. That is the aliasing MSAA fixes, and it is
// fixed. This measures the other half of "pixeling", which no amount of
// antialiasing touches: the INSIDES of surfaces.
//
// A texture is pixelated when it is magnified — when fewer of its texels
// land on the screen than there are screen pixels to show them, so one
// texel is stretched across several pixels and you can see the squares.
// That is a ratio, and the ratio is computable exactly from the Jacobian
// of the screen-to-texel map: for each triangle, how many texels of each
// texture axis a single screen pixel steps across.
//
// Above 1 there are texels to spare and the mip chain handles the rest.
// At 1 it is a pixel-for-pixel match, which is as sharp as a texture can
// ever be. Below 1 it is being enlarged, and how far below says how big
// the squares are: at 0.5 each texel is two pixels across, at 0.25 it is
// four.
//
// PER AXIS, NOT PER AREA, and that distinction is most of the difference
// between a report worth reading and one that is mostly false alarms.
// The area ratio conflates a texture's two directions, and plenty of
// textures are deliberately tiny in one of them — the headlight beam
// gradient is 8 by 128, eight pixels across because every column of it
// is identical. By area it looked twelve times magnified and was
// reported as a fault at every station in the game. An axis a texture
// does not vary along cannot pixelate, so the axes are measured
// separately and each texture is asked, by sampling it, which of its
// axes carry a picture at all.
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO.
//
// It does not read the framebuffer. A blurry region in a screenshot
// could be a magnified texture, or depth of field, or bloom, or motion
// blur, or a genuinely soft material — and none of those is a fault. The
// geometry knows the answer without guessing.
//
// It does not test for occlusion. A facade behind another building is
// counted as if it were on screen. That overstates the area of things
// hidden behind other things, and it is the right trade: the alternative
// is a depth prepass and a readback per surface, and the ranking barely
// moves — what is in front is also what is biggest.
//
// SCREEN AREA IS THE WEIGHT, and that is the whole reason the output is
// short enough to act on. Every scene has some tiny badly-scaled quad in
// it. A number plate two hundred metres away is magnified and nobody has
// ever noticed. The question is not "what is the worst ratio" but "what
// is the worst ratio on something big enough to look at", so surfaces
// are ranked by the fraction of the frame they cover and anything under
// a tenth of a percent is not reported at all.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

/** Below this many texels per pixel the texture is being enlarged. */
const MAGNIFIED = 1.0;

/** ...and below THIS it is visibly blocky, which is a different claim.
 *
 *  1.0 is the ideal — one texel per pixel is as sharp as a texture can
 *  ever be — but it is not the fault line, because every texture in
 *  every game is enlarged at its own closest approach and none of them
 *  is a bug. These are magnified with LinearFilter, so between 1.0 and
 *  0.5 what the eye gets is an interpolated ramp: softer than it could
 *  be, and not a square in sight. Squares need the ramp to span enough
 *  pixels to be read as a gradient rather than as detail, which is about
 *  one texel per two pixels.
 *
 *  So the report says "enlarged" at 1.0, because that is worth knowing,
 *  and fails at 0.5, because that is what "pixelated" means. */
const PIXELATED = 0.5;
/** Report nothing that covers less of the frame than this. */
const MIN_FRAC = 0.001;

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
// Progress from inside the page reaches the terminal only if it is
// forwarded. Without this the survey's own "station ..." lines went to
// the browser's console and the tool printed nothing for ten minutes,
// which is indistinguishable from a hang.
page.on("console", (m) => {
  const t = m.text();
  if (t.startsWith("station ")) console.error(`  ${t} ...`);
});
await page.goto("http://localhost:3000/race", { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });
await page.waitForTimeout(2500);

// Several stations along the road, because the answer is a property of
// where you are standing. A tool that measured one spot would report
// whatever happens to be in front of the car at s=4200 and call it the
// state of the game.
const STATIONS = [
  { name: "seafront", s: 4200, lat: -3 },
  { name: "towers", s: 900, lat: 0 },
  { name: "underpass", s: 7400, lat: 2 },
  { name: "forecourt", s: 2300, lat: -6 },
];

const out = await page.evaluate(async (stations) => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.applyQualityTier("high");

  const cam = e.camera;
  const buf = e.renderer.getDrawingBufferSize(new (cam.position.constructor)());
  const W = buf.x, H = buf.y;

  /** Everything drawn, with its world matrix up to date. */
  const stand = (st) => {
    const away = e.track.wrap(st.s + e.track.length / 2);
    for (let i = 0; i < 140; i++) {
      e.player.s = st.s;
      e.player.lat = st.lat;
      e.player.speed = 22;
      for (const t of e.traffic) t.s = away;
      if (e.rival) e.rival.s = away;
      e.update(1 / 60);
    }
    // One real render so anything built lazily on first sight exists,
    // and so the camera matrices are the ones the picture was drawn with.
    e.exposurePass.dt = 1 / 30;
    for (let i = 0; i < 20; i++) e.composer.render();
    cam.updateMatrixWorld(true);
    e.scene.updateMatrixWorld(true);
  };

  /** Is this object drawn at all, ancestors included? */
  const shown = (o) => {
    for (let n = o; n; n = n.parent) if (!n.visible) return false;
    return true;
  };

  /**
   * Does this texture actually carry detail along each axis?
   *
   * An axis a texture is constant along cannot pixelate: stretching a
   * column of identical pixels across the screen produces no squares,
   * because there is no boundary between one texel and the next to see.
   * The headlight beam gradient is exactly this — 8 wide by 128 tall,
   * every column identical — and by area alone it read as twelve times
   * magnified at every station in the game.
   *
   * Measured rather than assumed: the mean absolute difference between
   * neighbouring columns, and between neighbouring rows.
   */
  const detailCache = new Map();
  const detailOf = (map, img) => {
    const key = map.uuid;
    if (detailCache.has(key)) return detailCache.get(key);
    let d = { u: true, v: true };
    try {
      const n = 64;
      const cv = document.createElement("canvas");
      cv.width = Math.min(n, img.width || n);
      cv.height = Math.min(n, img.height || n);
      const cx = cv.getContext("2d", { willReadFrequently: true });
      cx.drawImage(img, 0, 0, cv.width, cv.height);
      const px = cx.getImageData(0, 0, cv.width, cv.height).data;
      const lum = (x, y) => {
        const i = (y * cv.width + x) * 4;
        return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      };
      let du = 0, dv = 0;
      for (let y = 0; y < cv.height; y++)
        for (let x = 1; x < cv.width; x++) du += Math.abs(lum(x, y) - lum(x - 1, y));
      for (let y = 1; y < cv.height; y++)
        for (let x = 0; x < cv.width; x++) dv += Math.abs(lum(x, y) - lum(x, y - 1));
      du /= Math.max(1, (cv.width - 1) * cv.height);
      dv /= Math.max(1, cv.width * (cv.height - 1));
      // A level and a half out of 255. Below that the axis is flat to
      // any eye and to any amount of magnification.
      d = { u: du > 1.5, v: dv > 1.5, du: +du.toFixed(2), dv: +dv.toFixed(2) };
    } catch { /* a texture that will not draw to a 2D context */ }
    detailCache.set(key, d);
    return d;
  };

  const survey = () => {
    // View-projection, built from the camera's own matrices rather than
    // a THREE import — this runs in the page, where the library is not
    // a global.
    const vp = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
    const found = new Map();

    e.scene.traverse((o) => {
      if (!o.isMesh || !shown(o)) return;
      const g = o.geometry;
      const pos = g?.attributes?.position;
      const uv = g?.attributes?.uv;
      if (!pos || !uv) return;

      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const mat = mats[0];
      const map = mat?.map;
      const img = map?.image;
      const tw = img?.width || img?.videoWidth || 0;
      const th = img?.height || img?.videoHeight || 0;
      if (!tw || !th) return;                       // no texture: cannot pixelate
      // repeat scales UV, so a wall tiling its texture eight times has
      // eight times the texels across the same UV span.
      const rx = (map.repeat?.x ?? 1) * tw;
      const ry = (map.repeat?.y ?? 1) * th;

      const idx = g.index;
      const triCount = idx ? idx.count / 3 : pos.count / 3;
      if (triCount < 1) return;
      // Big meshes are sampled rather than walked. The answer is a ratio
      // and ratios do not need every triangle; 240 spread evenly across
      // a mesh lands the estimate well inside the precision anyone can
      // act on, and walking a merged city block instead would take
      // minutes per station.
      const stride = Math.max(1, Math.floor(triCount / 240));

      const m = o.matrixWorld.elements;
      const v = vp.elements;
      const sx = [0, 0, 0], sy = [0, 0, 0];
      const uvx = [0, 0, 0], uvy = [0, 0, 0];

      let screenSum = 0, texelSum = 0, uSum = 0, vSum = 0;
      for (let t = 0; t < triCount; t += stride) {
        let ok = true;
        for (let k = 0; k < 3; k++) {
          const a = idx ? idx.getX(t * 3 + k) : t * 3 + k;
          const px = pos.getX(a), py = pos.getY(a), pz = pos.getZ(a);
          // world = matrixWorld * local
          const wx = m[0] * px + m[4] * py + m[8] * pz + m[12];
          const wy = m[1] * px + m[5] * py + m[9] * pz + m[13];
          const wz = m[2] * px + m[6] * py + m[10] * pz + m[14];
          // clip = viewProjection * world
          const cx = v[0] * wx + v[4] * wy + v[8] * wz + v[12];
          const cy = v[1] * wx + v[5] * wy + v[9] * wz + v[13];
          const cw = v[3] * wx + v[7] * wy + v[11] * wz + v[15];
          if (cw <= 1e-6) { ok = false; break; }    // behind the eye
          sx[k] = (cx / cw) * 0.5 * W;
          sy[k] = (cy / cw) * 0.5 * H;
          uvx[k] = uv.getX(a) * rx;
          uvy[k] = uv.getY(a) * ry;
        }
        if (!ok) continue;
        // Wholly off screen in one direction: not part of this picture.
        const ndcX = [sx[0] / (W / 2), sx[1] / (W / 2), sx[2] / (W / 2)];
        const ndcY = [sy[0] / (H / 2), sy[1] / (H / 2), sy[2] / (H / 2)];
        if (Math.min(...ndcX) > 1 || Math.max(...ndcX) < -1) continue;
        if (Math.min(...ndcY) > 1 || Math.max(...ndcY) < -1) continue;

        let sa = Math.abs(
          (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0])
        ) / 2;
        if (sa < 4) continue;                       // too small to see squares in
        // Only the part of it that is on screen.
        //
        // Without this a wall that runs off both sides of the frame
        // counted its whole area, and the report said a surface covered
        // 122% of the picture — a number that cannot be true and
        // therefore cannot be acted on. Scaling by how much of the
        // triangle's bounding box is inside the viewport is an
        // approximation, but it is a bounded one, and it puts the
        // ranking on a footing where the percentages mean what they say.
        {
          const bw = Math.max(...sx) - Math.min(...sx);
          const bh = Math.max(...sy) - Math.min(...sy);
          const inX = Math.max(0, Math.min(Math.max(...sx), W / 2) - Math.max(Math.min(...sx), -W / 2));
          const inY = Math.max(0, Math.min(Math.max(...sy), H / 2) - Math.max(Math.min(...sy), -H / 2));
          if (inX <= 0 || inY <= 0) continue;
          const onScreen = (bw > 0 ? inX / bw : 1) * (bh > 0 ? inY / bh : 1);
          sa *= Math.min(1, onScreen);
          if (sa < 4) continue;
        }
        const ta = Math.abs(
          (uvx[1] - uvx[0]) * (uvy[2] - uvy[0]) - (uvx[2] - uvx[0]) * (uvy[1] - uvy[0])
        ) / 2;
        screenSum += sa;
        texelSum += ta;

        // ...and the same thing PER AXIS, which turns out to be the
        // whole difference between a report worth reading and one that
        // is mostly false alarms.
        //
        // The area ratio conflates a texture's two axes, and plenty of
        // textures are deliberately tiny in one of them. The headlight
        // beam gradient is 8x128: eight pixels across, because every
        // column of it is identical and the shape lives entirely in the
        // other axis. By area it looked twelve times magnified and was
        // reported as a fault at every station; along the axis that
        // carries the picture it is nowhere near.
        //
        // The Jacobian of the screen-to-texel map gives both numbers
        // exactly. With screen edges e1, e2 and texel edges g1, g2,
        // J = [g1 g2] . inv([e1 e2]), and the length of each ROW of J is
        // how many texels of that axis a screen pixel steps across.
        {
          const e1x = sx[1] - sx[0], e1y = sy[1] - sy[0];
          const e2x = sx[2] - sx[0], e2y = sy[2] - sy[0];
          const det = e1x * e2y - e2x * e1y;
          if (Math.abs(det) > 1e-9) {
            const g1x = uvx[1] - uvx[0], g1y = uvy[1] - uvy[0];
            const g2x = uvx[2] - uvx[0], g2y = uvy[2] - uvy[0];
            const j00 = (g1x * e2y - g2x * e1y) / det;
            const j01 = (-g1x * e2x + g2x * e1x) / det;
            const j10 = (g1y * e2y - g2y * e1y) / det;
            const j11 = (-g1y * e2x + g2y * e1x) / det;
            uSum += Math.hypot(j00, j01) * sa;
            vSum += Math.hypot(j10, j11) * sa;
          }
        }
      }
      if (screenSum <= 0) return;
      // Scaled back up by the stride, since only every Nth triangle was
      // counted and the fraction of the frame has to mean what it says.
      const screenPx = screenSum * stride;

      // What to call it.
      //
      // The first run reported six faults and named five of them
      // "unnamed", which is a measurement nobody can act on: knowing
      // that a 512x160 texture is stretched across most of the frame is
      // useless if you cannot find out what it is on. Most geometry in
      // this world is built anonymously and parented under something
      // that does have a name, so the search walks outward — the mesh,
      // then its material, then up the tree — and takes the first name
      // it finds.
      const label = (() => {
        if (o.name) return o.name;
        if (mat?.name) return `mat:${mat.name}`;
        if (map.name) return `tex:${map.name}`;
        for (let n = o.parent, up = 0; n && up < 6; n = n.parent, up++) {
          if (n.name) return `${n.name}/`;
        }
        return "unnamed";
      })();

      const key = `${label}|${tw}x${th}`;
      const prev = found.get(key) || { name: label,
        tex: `${tw}x${th}`, screenPx: 0, texels: 0, uWeighted: 0, vWeighted: 0,
        meshes: 0, map, obj: o };
      prev.screenPx += screenPx;
      prev.texels += texelSum * stride;
      prev.uWeighted += uSum * stride;
      prev.vWeighted += vSum * stride;
      prev.meshes++;
      found.set(key, prev);
    });

    return [...found.values()].map((f) => {
      // Where in the world it is, and a picture of the texture itself.
      //
      // The naming search came back "unnamed" for every fault on the
      // first two runs, because most of this world is built anonymously
      // and neither the meshes nor their materials nor their parents
      // carry a name. A fault you cannot locate is not actionable, so
      // rather than guess harder the tool now hands over the two things
      // that always identify a surface: the metres it occupies, and the
      // image that is on it.
      const box = f.obj.geometry.boundingBox ||
        (f.obj.geometry.computeBoundingBox(), f.obj.geometry.boundingBox);
      const c = box.getCenter(new (f.obj.position.constructor)());
      const s = box.getSize(new (f.obj.position.constructor)());
      f.obj.localToWorld(c);
      let thumb = null;
      const img = f.map.image;
      try {
        if (img && (img.width || img.videoWidth)) {
          const cv = document.createElement("canvas");
          cv.width = Math.min(256, img.width);
          cv.height = Math.min(256, img.height);
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          thumb = cv.toDataURL("image/png");
        }
      } catch { /* a texture that will not draw to a 2D context */ }
      const detail = detailOf(f.map, img);
      // Along each axis, texels per screen pixel — and only the axes the
      // texture actually varies along are eligible to be a fault.
      const u = f.uWeighted / f.screenPx;
      const vv = f.vWeighted / f.screenPx;
      const live = [];
      if (detail.u) live.push(u);
      if (detail.v) live.push(vv);
      return {
        name: f.name, tex: f.tex, meshes: f.meshes,
        u: +u.toFixed(2), v: +vv.toFixed(2),
        flat: !detail.u ? "u" : !detail.v ? "v" : null,
        // The worst axis that carries a picture. A texture is only as
        // sharp as its blurriest meaningful direction.
        worst: live.length ? Math.min(...live) : Infinity,
        ratio: f.texels / f.screenPx,
        // Texels per pixel over the whole surface, not the mean of the
        // per-triangle ratios: a ratio averaged over triangles weights a
        // sliver the same as a wall.
        frac: f.screenPx / (W * H),
        at: [Math.round(c.x), Math.round(c.y), Math.round(c.z)],
        sizeM: [+s.x.toFixed(1), +s.y.toFixed(1), +s.z.toFixed(1)],
        thumb,
      };
    });
  };

  const byStation = [];
  for (const st of stations) {
    // Progress out through the console, because standing the car at four
    // places and surveying the whole scene graph at each takes minutes
    // headless, and a tool that prints nothing until the end is
    // indistinguishable from a hung one.
    console.log(`station ${st.name}`);
    stand(st);
    const rows = survey()
      .filter((r) => r.frac >= 0.001)
      .sort((a, b) => a.worst - b.worst)
      .slice(0, 8);
    byStation.push({ station: st.name, rows });
  }

  e.setPaused(false);
  return { W, H, byStation };
}, STATIONS);

const fail = [];
console.log(`buffer       ${out.W}x${out.H}`);
console.log(`u,v          texels per screen pixel along each axis; under 1.0 is enlarged`);
console.log(`flat         an axis the texture does not vary along, which cannot pixelate`);
// Said plainly rather than left to be misread. The "area" column is the
// summed screen area of the triangles wearing this texture, over the
// area of the frame. Overlapping surfaces both count and a triangle
// straddling the edge is clipped only by its bounding box, so the figure
// can exceed 100% — it is a weight for ranking, not a coverage fraction,
// and a version of this that printed "121% of frame" was reporting a
// number that cannot be true.
console.log(`area         summed triangle area over frame area — a weight, not a coverage\n`);

const worst = [];
/** Enlarged but not blocky — reported, not failed. */
const soft = [];
const seen = new Set();
for (const st of out.byStation) {
  console.log(`${st.station}`);
  if (!st.rows.length) { console.log("  nothing textured big enough to judge"); continue; }
  for (const r of st.rows.slice(0, 6)) {
    const flag = r.worst < MAGNIFIED ? "  <-- enlarged" : "";
    console.log(
      `  u ${r.u.toFixed(2).padStart(7)}  v ${r.v.toFixed(2).padStart(7)}  ` +
      `${(r.frac * 100).toFixed(2).padStart(6)}%  ${r.tex.padEnd(9)}` +
      `${r.flat ? ` flat:${r.flat}` : "       "}  ${r.sizeM.join("x")} m at ${r.at.join(",")}${flag}`
    );
    if (r.worst < PIXELATED && r.frac >= MIN_FRAC) {
      const id = `${r.tex}-${r.sizeM.join("x")}`;
      worst.push({ ...r, station: st.station, id, repeat: seen.has(id) });
      seen.add(id);
    } else if (r.worst < MAGNIFIED && r.frac >= MIN_FRAC && !soft.some((x) => x.tex === r.tex)) {
      soft.push(r);
    }
  }
  console.log("");
}

if (worst.length) {
  mkdirSync("press/texels", { recursive: true });
  for (const w of worst) {
    if (!w.thumb || w.repeat) continue;
    writeFileSync(`press/texels/${w.id}.png`, Buffer.from(w.thumb.split(",")[1], "base64"));
  }
  console.log(`wrote the offending textures to press/texels/\n`);
  // How coarse the squares actually are: a ratio of 0.25 means one texel
  // spans two pixels each way.
  for (const w of worst) {
    if (w.repeat) continue;
    const span = 1 / w.worst;
    fail.push(
      `${w.station}: a ${w.sizeM.join("x")} m surface at ${w.at.join(",")} wearing a ` +
      `${w.tex} texture shows one texel every ${span.toFixed(1)} px, ` +
      `weight ${(w.frac * 100).toFixed(2)}% of the frame`
    );
  }
}

// What the pass actually asserts, rather than a tidier sentence than the
// evidence supports. Saying "every surface has at least one texel per
// pixel" while the sign sits at 0.68 would be a green light that is not
// true, and a check that overstates its own result is worse than one
// that fails.
if (!fail.length && soft.length) {
  console.log("enlarged at their closest approach, but interpolated rather than blocky:");
  for (const r of soft) {
    console.log(
      `  ${r.tex.padEnd(9)} down to ${r.worst.toFixed(2)} texels per pixel ` +
      `(one texel every ${(1 / r.worst).toFixed(1)} px) on a ${r.sizeM.join("x")} m surface`
    );
  }
  console.log("");
}
console.log(
  fail.length
    ? `FAILURES:\n - ${fail.join("\n - ")}`
    : soft.length
      ? "nothing is blocky: every surface big enough to see holds at least one texel per two pixels"
      : "every surface big enough to see has at least one texel per pixel"
);
await browser.close();
process.exit(fail.length ? 1 : 0);
