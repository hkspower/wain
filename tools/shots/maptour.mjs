// The whole map, as a film: about two minutes over and along every
// district of the lap, rendered frame by frame from the running game.
//
//   npm run dev
//   node tools/shots/maptour.mjs                    # 1920x1080, 24 fps, JPEG frames -> MP4
//   node tools/shots/maptour.mjs --only 4,15,62,115 # a contact sheet of those seconds first
//   node tools/shots/maptour.mjs --encode-only      # encode whatever frames are on disk
//   node tools/shots/maptour.mjs --jobs 2           # two browsers, alternate frames
//
// THE CUT, 120 s at the racing hour (02:30):
//
//     0-8    the whole circuit from 2.6 km up, the route traced in sodium
//            light and every district named where it lies; the title.
//     8-110  the ten districts in lap order, ~10.2 s each: a drone pass
//            along that district's road (the aerial half), then a cut to
//            driving it in the chase view with traffic in the lanes (the
//            road half), under a lower-third card — the district in Arabic
//            and Latin, its road, where it is on the lap.
//   110-120  rising back out over the whole map; the end card.
//
// Rendered the way tools/shots/trailer.mjs renders the trailer, for the
// same reason: a screen recording of a software renderer is a recording
// of the renderer. Every frame is a pure function of its timestamp — the
// hour, the camera, where the player and every traffic car stand — set
// explicitly, drawn, and read back, so it is a true 24 fps film however
// long a frame took, and a render that dies half way RESUMES: frames on
// disk are skipped. That is also what makes --jobs safe: two browsers
// can draw alternate frames because no frame depends on the one before.
//
// TWO HONEST LIBERTIES, both only in the aerial overviews: the fog is
// thinned and the far plane pushed out, because the game's own night fog
// (FogExp2 0.0009) is a driver's view and would grey a 2.6 km-high
// camera into nothing, and the 2.6 km far plane would cut the lap in
// half. The driving and drone halves are the game exactly as it draws.
//
// READBACK is the cost (see exportfilm.mjs: a full-frame drawImage on a
// software renderer is tens of seconds). This composites the card layer
// as a DOM canvas over the game's canvas and takes the frame with the
// browser's own screenshot, which reads the compositor once instead of
// round-tripping the WebGL buffer through a 2D canvas.
//
// Needs ffmpeg: $FFMPEG, one on PATH, or the ffmpeg-static package.
// Without one the frames are written and the encode command printed.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const FPS = Number(arg("fps", 24));
const WIDTH = Number(arg("width", 1920));
const HEIGHT = Math.round((WIDTH * 9) / 16);
const LEN = Number(arg("len", 120));
const TIER = arg("tier", "high");
/** The 3D's own line count (render.ts Resolution: 1080 or 720); the cards
 *  are always drawn at the output's full size. */
const RENDER = arg("render", String(HEIGHT));
const OUT = arg("out", `press/map/maptour-${HEIGHT}p.mp4`);
const FRAMEDIR = arg("frames", `press/map/frames-${HEIGHT}p`);
const JOBS = Math.max(1, Number(arg("jobs", 1)));
const JOB = Number(arg("job", -1)); // internal: which of the jobs this process is
const ENCODE_ONLY = process.argv.includes("--encode-only");
const MUSIC = "public/music/battle.mp3";

function findFfmpeg() {
  if (process.env.FFMPEG && existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  try {
    const p = execFileSync("which", ["ffmpeg"], { encoding: "utf8" }).trim();
    if (p) return p;
  } catch {}
  try {
    const p = createRequire(import.meta.url)("ffmpeg-static");
    if (p && existsSync(p)) return p;
  } catch {}
  return null;
}

const name = (i) => `${FRAMEDIR}/f${String(i).padStart(5, "0")}.jpg`;

/** The districts, read from world.ts's own AREAS table rather than
 *  restated here: name, Arabic name and where each ends (COAST_END_M
 *  resolved from track.ts, Infinity as null). */
function readAreas() {
  const world = readFileSync("src/game/world.ts", "utf8");
  const track = readFileSync("src/game/track.ts", "utf8");
  const coastEnd = Number(track.match(/export const COAST_END_M = (\d+(?:\.\d+)?);/)?.[1]);
  const block = world.match(/export const AREAS = \[([\s\S]*?)\n\];/)?.[1] ?? "";
  const rows = [...block.matchAll(/\{ name: "([^"]+)", arabic: "([^"]+)", to: ([A-Za-z_0-9.]+) \}/g)].map((m) => ({
    name: m[1], arabic: m[2], to: m[3] === "Infinity" ? null : m[3] === "COAST_END_M" ? coastEnd : Number(m[3]),
  }));
  if (rows.length < 2 || !(coastEnd > 0)) throw new Error("could not read AREAS / COAST_END_M from the game source");
  return { rows, coastEnd };
}
const AREAS = readAreas();
const TOTAL = Math.round(LEN * FPS);

// --jobs N: fork N copies of this script, each drawing every Nth frame.
if (JOBS > 1 && JOB < 0 && !ENCODE_ONLY && !arg("only", "")) {
  const kids = [];
  for (let j = 0; j < JOBS; j++) {
    const argv = process.argv.slice(1).filter((a, i, all) => a !== "--jobs" && all[i - 1] !== "--jobs");
    kids.push(new Promise((res) => {
      const c = spawn(process.execPath, [...argv, "--jobs", String(JOBS), "--job", String(j), "--no-encode"], { stdio: "inherit" });
      c.on("exit", res);
    }));
  }
  await Promise.all(kids);
  process.argv.push("--encode-only");
}

// ------------------------------------------------------------- frames
if (!process.argv.includes("--encode-only")) {
  mkdirSync(FRAMEDIR, { recursive: true });
  const have = new Set(readdirSync(FRAMEDIR).filter((f) => f.endsWith(".jpg")));
  const ONLY = arg("only", "");
  const todo = [];
  if (ONLY) for (const sec of ONLY.split(",").map(Number)) todo.push(Math.min(TOTAL - 1, Math.round(sec * FPS)));
  else for (let i = 0; i < TOTAL; i++) {
    if (JOBS > 1 && JOB >= 0 && i % JOBS !== JOB) continue;
    // A frame is on disk only once it is whole: frames are written to a
    // temporary name and renamed, so a size check is enough.
    if (!have.has(`f${String(i).padStart(5, "0")}.jpg`)) todo.push(i);
  }
  const tag = JOB >= 0 ? `[job ${JOB}/${JOBS}] ` : "";
  console.log(`${tag}maptour  ${WIDTH}x${HEIGHT} at ${FPS} fps (3D at ${RENDER} lines), ${TOTAL} frames, tier ${TIER} — ${todo.length} to draw`);

  if (todo.length) {
    const C = [
      process.env.CHROME_PATH,
      process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
      process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
      "/usr/bin/chromium",
    ].filter(Boolean);
    const exe = C.find((p) => existsSync(p));
    if (!exe) { console.error("no chromium"); process.exit(2); }
    const browser = await chromium.launch({
      executablePath: exe,
      args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb", "--hide-scrollbars"],
    });
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(900000);
    page.on("pageerror", (e) => console.log(`${tag}PAGEERROR:`, e.message));
    await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("gulf-road-nights-onboarded", "2");
      localStorage.setItem("gulf-road-nights-coach", "3");
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.click("text=START ENGINE");
    await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 900000 });
    await page.evaluate(() => window.__grnEngine?.skipCinematic?.());
    await page.waitForTimeout(3000);
    await page.evaluate(async () => {
      const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      await document.fonts.ready;
      for (const f of ["--font-display", "--font-arabic-display", "--font-arabic-poster"])
        await document.fonts.load(`700 60px ${v(f)}`, "متسابق الليل NIGHT RACER").catch(() => {});
    });

    // The director, installed once. Everything a frame needs is decided
    // from `t` alone.
    await page.evaluate(({ W, H, TIER, AREAS_IN, LEN, RENDER }) => {
      const e = window.__grnEngine;
      const THREE = window.__grnThree;
      e.setPaused(true);
      // The game's own loop, stopped. It renders a whole frame on every
      // animation tick even while paused (engine.ts start(): composer.render
      // runs whatever `paused` says), and a screenshot waits for a fresh
      // compositor frame — so every frame of the first cut was drawn TWICE,
      // once here and once by the loop, and the capture paid for both:
      // 170 s of a 172 s frame was the screenshot. From here on the film
      // draws exactly what it asks for and nothing else.
      cancelAnimationFrame(e.raf);
      e.applyQualityTier(TIER);
      if (RENDER !== String(H)) e.setResolution(Number(RENDER));
      // Pinned, as the 4K stills pin it (tools/shots/ik4k.mjs, EV +1 over
      // the meter's night floor): a paused engine's meter drifts frame to
      // frame, and with --jobs two browsers would each meter their own.
      e.setExposure(0, false);
      e.setManualExposure(0.55 * 2);
      // The page behind the game's canvas, black. The frame is taken from
      // the browser's compositor, and the WebGL canvas is composited with
      // its alpha: over the page's own pale background every pixel the
      // grade left below alpha 1 came out washed grey, and every pixel an
      // additive lamp shaft had pushed to alpha 1 came out as the true
      // dark scene — black cones on a grey film. Over black, a
      // premultiplied canvas shows exactly the colour it was given.
      document.documentElement.style.background = "#000";
      document.body.style.background = "#000";
      e.timeReal = false;
      e.timeCycling = false;
      const tr = e.track;
      const L = tr.length;
      const v = () => new THREE.Vector3();
      const P = v(), T = v(), R = v(), A = v(), B = v(), Q = v();
      const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
      const lerp = (a, b, k) => a + (b - a) * k;
      const wrap = (s) => tr.wrap(s);
      const pose = (s, lat, out) => { tr.pointAt(wrap(s), out); tr.sideAt(wrap(s), R); return out.addScaledVector(R, lat); };
      const cam = e.camera;
      const look = (x, y, z) => { cam.lookAt(x, y, z); cam.updateMatrixWorld(); };
      const lens = (fov, far) => { cam.fov = fov; cam.far = far; cam.updateProjectionMatrix(); };
      const fog = e.scene.fog;
      // What a 3 km-high camera sees that a driver never does: the sea is
      // a 3.3 x 5.8 km plane whose western edge cut a hard diagonal across
      // the overview, and the night dome (1.9 km, centred on the camera)
      // showed as a bubble of stars below the horizon. For the overviews
      // only, the sea is stretched westward with its shoreline edge (x ~
      // 770) exactly where it was, and the dome is hidden.
      let seaMesh = null;
      e.scene.traverse((o) => {
        const g = o.geometry?.parameters;
        if (o.isMesh && g && g.width === 3300 && g.height === 5800) seaMesh = o;
      });
      const seaHome = seaMesh ? { x: seaMesh.position.x, sx: seaMesh.scale.x, sy: seaMesh.scale.y } : null;
      const followers = e.world.skyFollowers.map((o) => [o, o.visible]);
      const aerialWorld = (on) => {
        if (seaMesh) {
          const k = on ? 5 : 1;
          const east = seaHome.x + 3300 / 2;
          seaMesh.scale.set(seaHome.sx * k, seaHome.sy * k, 1);
          seaMesh.position.x = on ? east - (3300 * k) / 2 : seaHome.x;
        }
        for (const [o, vis] of followers) o.visible = on ? false : vis;
      };
      const FOG_GAME = fog.density;
      const FAR_GAME = cam.far;

      // The districts, from the world's own table (passed in so this file
      // does not restate it): each runs from the previous one's end.
      const D = [];
      let from = 0;
      for (const a of AREAS_IN.rows) {
        const to = Math.min(L, a.to === null ? L : a.to);
        D.push({ name: a.name, arabic: a.arabic, from, to, mid: (from + to) / 2, len: to - from });
        from = to;
      }
      const roadAt = (s) => (s < AREAS_IN.coastEnd ? { name: "ARABIAN GULF STREET", arabic: "شارع الخليج العربي" } : { name: "SECOND RING ROAD", arabic: "الدائري الثاني" });

      // The lap as a polyline, and the map's own frame: centre and reach.
      const route = [];
      const box = new THREE.Box3();
      for (let s = 0; s <= L; s += 20) { const p = tr.pointAt(wrap(s), v()); route.push(p); box.expandByPoint(p); }
      const centre = box.getCenter(v());
      const reach = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);

      // Traffic, as a pure function of time: a handful of cars in the
      // lanes around the player, each at its own steady speed; the rest
      // parked half a lap away.
      const LANES = [-5.25, -1.75, 1.75, 5.25];
      const parkAll = (s) => {
        for (const c of e.traffic) { c.s = wrap(s + L / 2); c.speed = 0; }
        if (e.rival) { e.rival.s = wrap(s + L / 2 + 40); e.rival.speed = 0; }
      };
      const placeTraffic = (sPlayer, t, seed) => {
        const n = Math.min(6, e.traffic.length);
        for (let i = 0; i < e.traffic.length; i++) {
          const c = e.traffic[i];
          if (i >= n) { c.s = wrap(sPlayer + L / 2 + i * 15); c.speed = 0; continue; }
          const lane = LANES[(i + seed) % 4 === 2 ? 3 : (i + seed) % 4];
          const ahead = 18 + i * 31 + ((seed * 17 + i * 23) % 13);
          const sp = 22 + ((i * 7 + seed * 3) % 9); // 22-30 m/s against the player's 33
          c.s = wrap(sPlayer + ahead - (33 - sp) * t);
          c.lat = lane; c.speed = sp;
          if ("targetLat" in c) c.targetLat = lane;
        }
      };

      // ---- the card layer: a DOM canvas over the game's, composited by
      // the browser and captured with the frame.
      const out = document.createElement("canvas");
      out.width = W; out.height = H;
      Object.assign(out.style, { position: "fixed", left: "0", top: "0", width: `${W}px`, height: `${H}px`, zIndex: "2147483647", pointerEvents: "none" });
      document.body.appendChild(out);
      // Nothing of the HUD over the film: everything hidden, then the
      // game's canvas and the card layer shown again (an inline
      // !important outranks the sheet's, and visibility, unlike display,
      // can be turned back on beneath a hidden parent).
      const hud = document.createElement("style");
      hud.textContent = `body * { visibility: hidden !important; }`;
      document.head.appendChild(hud);
      e.renderer.domElement.style.setProperty("visibility", "visible", "important");
      out.style.setProperty("visibility", "visible", "important");
      const ctx = out.getContext("2d");
      const fontOf = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "sans-serif";
      const DISPLAY = fontOf("--font-display");
      const ARABIC = fontOf("--font-arabic-display") || DISPLAY;
      const ARABIC_POSTER = fontOf("--font-arabic-poster") || ARABIC;
      const text = (l, x, y, align, alpha) => {
        const px = Math.round(H * l.size);
        const face = l.poster ? ARABIC_POSTER : l.arabic ? ARABIC : DISPLAY;
        ctx.font = `${l.italic ? "italic " : ""}${l.weight ?? 700} ${px}px ${face}`;
        ctx.letterSpacing = l.track ? `${l.track}em` : "0px";
        ctx.textAlign = align;
        ctx.globalAlpha = alpha;
        if (l.glow) { ctx.shadowColor = l.glow; ctx.shadowBlur = H * 0.04; ctx.fillStyle = l.color ?? "#fff"; ctx.fillText(l.text, x, y); }
        ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = H * 0.016; ctx.shadowOffsetY = H * 0.003;
        ctx.fillStyle = l.color ?? "#fff"; ctx.fillText(l.text, x, y);
        ctx.shadowColor = "transparent"; ctx.shadowOffsetY = 0;
        if (l.rule) {
          const rw = W * l.rule * Math.min(1, alpha * 1.4), ry = y + px * 0.34;
          const rx = align === "center" ? x - rw / 2 : align === "left" ? x : x - rw;
          const g = ctx.createLinearGradient(rx, 0, rx + rw, 0);
          g.addColorStop(0, "rgba(255,196,92,0)"); g.addColorStop(0.5, "rgba(255,196,92,0.95)"); g.addColorStop(1, "rgba(255,196,92,0)");
          ctx.fillStyle = g; ctx.fillRect(rx, ry, rw, Math.max(2, H * 0.0028));
        }
        ctx.globalAlpha = 1;
      };
      /** Project a world point to the card layer; null behind the lens. */
      const toScreen = (p) => {
        Q.copy(p).project(cam);
        if (Q.z > 1 || Q.z < -1) return null;
        return [(Q.x * 0.5 + 0.5) * W, (-Q.y * 0.5 + 0.5) * H];
      };
      /** The lap traced over the overview, each district its own stretch,
       *  the one in hand brighter. */
      const drawRoute = (alpha, hi = -1, upto = L) => {
        if (alpha <= 0) return;
        ctx.save();
        ctx.lineJoin = "round"; ctx.lineCap = "round";
        D.forEach((d, k) => {
          ctx.beginPath();
          let started = false;
          for (let s = d.from; s <= Math.min(d.to, upto); s += 20) {
            const p = toScreen(tr.pointAt(wrap(s), A));
            if (!p) { started = false; continue; }
            if (!started) { ctx.moveTo(p[0], p[1]); started = true; } else ctx.lineTo(p[0], p[1]);
          }
          const on = hi === k;
          ctx.globalAlpha = alpha * (hi < 0 || on ? 1 : 0.45);
          ctx.strokeStyle = on ? "rgba(255,214,120,1)" : "rgba(255,180,70,0.95)";
          ctx.shadowColor = "rgba(255,160,40,0.9)"; ctx.shadowBlur = H * (on ? 0.02 : 0.012);
          ctx.lineWidth = H * (on ? 0.0055 : 0.0035);
          ctx.stroke();
        });
        ctx.restore();
      };
      const labelDistricts = (alpha, hi = -1) => {
        if (alpha <= 0) return;
        D.forEach((d, k) => {
          const p = toScreen(tr.pointAt(wrap(d.mid), A));
          if (!p) return;
          // Labels sit off the route, outward from the map's centre.
          Q.set(p[0] - W / 2, p[1] - H / 2, 0).normalize();
          const x = p[0] + Q.x * H * 0.05, y = p[1] + Q.y * H * 0.05;
          const a = alpha * (hi < 0 || hi === k ? 1 : 0.55);
          text({ text: d.arabic, size: 0.026, arabic: true, color: "#ffd27a" }, x, y, "center", a);
          text({ text: d.name.toUpperCase(), size: 0.0145, weight: 600, track: 0.14, color: "rgba(255,255,255,0.85)" }, x, y + H * 0.026, "center", a);
        });
      };
      const lowerThird = (d, k, alpha) => {
        const road = roadAt(d.mid);
        const x = W * 0.06;
        text({ text: `DISTRICT ${String(k + 1).padStart(2, "0")} / ${String(D.length).padStart(2, "0")}  ·  ${road.name}`, size: 0.02, weight: 600, track: 0.26, color: "#ffc45c" }, x, H * 0.70, "left", alpha);
        text({ text: d.arabic, size: 0.082, arabic: true, glow: "rgba(255,170,60,0.45)" }, x, H * 0.785, "left", alpha);
        text({ text: d.name.toUpperCase(), size: 0.036, italic: true, track: 0.08, rule: 0.16 }, x, H * 0.84, "left", alpha);
        text({ text: `${road.arabic}   ·   KM ${(d.from / 1000).toFixed(1)} – ${(d.to / 1000).toFixed(1)} OF ${(L / 1000).toFixed(1)}`, size: 0.018, weight: 600, track: 0.2, color: "rgba(255,255,255,0.72)" }, x, H * 0.885, "left", alpha);
      };

      // The overview lens: the whole lap in frame, seen from about 55
      // degrees above the horizon rather than straight down, so the towers
      // stand up and their lit windows read as a city, not a dark field.
      // The distance is FITTED, not guessed: walk the camera in or out
      // until the route's furthest point sits at 88% of the frame — the
      // first cut used the map's bounding box and ran the lap off the top
      // and bottom of the picture.
      const fitPts = route.filter((_, i) => i % 3 === 0);
      const overview = (u, rise) => {
        const az = lerp(-0.45, 0.45, u) + Math.PI;
        const el = THREE.MathUtils.degToRad(lerp(58, 50, u));
        const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
        let dist = reach;
        for (let it = 0; it < 6; it++) {
          cam.position.copy(centre).addScaledVector(dir, dist);
          lens(44, dist * 3 + reach * 2);
          look(centre.x, 0, centre.z);
          let worst = 0;
          for (const q of fitPts) {
            Q.copy(q).project(cam);
            worst = Math.max(worst, Math.abs(Q.x), Math.abs(Q.y) * 1.08); // room for the title
          }
          dist *= worst / 0.88;
        }
        dist *= rise;
        cam.position.copy(centre).addScaledVector(dir, dist);
        lens(44, dist * 3 + reach * 2);
        look(centre.x, 0, centre.z);
      };

      const SEG0 = 8, SEG1 = 110, AERIAL = 0.45; // the aerial share of each district
      window.__mapFrame = (t, dt) => {
        const hour = 2.5;
        let fade = 1;
        let fogK = 1;
        const p = e.player;
        let place = () => {};
        const overlay = [];
        if (t < SEG0) {
          // 1. The whole circuit.
          const u = t / SEG0;
          parkAll(0);
          p.s = 60; p.lat = 1.75; p.speed = 0;
          fogK = 0.12;
          place = () => overview(u, 1);
          fade = Math.min(1, t / 1.0);
          const ra = Math.min(1, Math.max(0, (t - 0.8) / 1.6));
          overlay.push(() => {
            drawRoute(ra, -1, L * ease((t - 0.8) / 3));
            labelDistricts(Math.min(1, Math.max(0, (t - 3.2) / 1.2)));
            const ta = Math.min(1, Math.max(0, (t - 1.2) / 1.0)) * Math.min(1, (SEG0 - t) / 0.8);
            text({ text: "متسابق الليل", size: 0.085, arabic: true, poster: true, color: "#ffc45c", glow: "rgba(255,160,40,0.6)" }, W / 2, H * 0.14, "center", ta);
            text({ text: `NIGHT RACER  ·  THE MAP`, size: 0.04, italic: true, track: 0.12, rule: 0.2 }, W / 2, H * 0.205, "center", ta);
            text({ text: `${(L / 1000).toFixed(1)} KM  ·  ${D.length} DISTRICTS  ·  ARABIAN GULF STREET & SECOND RING ROAD`, size: 0.017, weight: 600, track: 0.3, color: "rgba(255,255,255,0.78)" }, W / 2, H * 0.25, "center", ta);
          });
        } else if (t < SEG1) {
          // 2. District by district.
          const per = (SEG1 - SEG0) / D.length;
          const k = Math.min(D.length - 1, Math.floor((t - SEG0) / per));
          const d = D[k];
          const lt = t - SEG0 - k * per; // seconds into this district
          const aerialLen = per * AERIAL;
          // Where the shots run within the district: the middle stretch,
          // so neither half sits on a boundary.
          const span = Math.min(d.len * 0.8, 520);
          const s0 = d.mid - span / 2;
          const cardA = Math.min(1, lt / 0.7) * Math.min(1, (per - lt) / 0.6);
          if (lt < aerialLen) {
            // The drone pass: high over the road, descending and pushing
            // forward along it, looking down the district.
            const u = lt / aerialLen, kk = ease(u);
            parkAll(d.mid);
            p.s = wrap(s0 + span * 0.55 + u * span * 0.3); p.lat = 1.75; p.speed = 33;
            placeTraffic(p.s, lt, k);
            fogK = 0.55;
            place = () => {
              pose(s0 + u * span * 0.55, lerp(-38, -22, kk) * (k % 2 ? -1 : 1), A);
              cam.position.set(A.x, lerp(95, 42, kk), A.z);
              pose(s0 + u * span * 0.55 + 170, 0, B);
              look(B.x, 0, B.z);
              lens(52, 3200);
            };
            // A cut in from black at the first district, a quick dip at
            // every other district boundary.
            fade = k === 0 ? 1 : Math.min(1, lt / 0.25);
          } else {
            // The road: the chase view at racing speed, traffic in lane.
            const u = (lt - aerialLen) / (per - aerialLen);
            const sp = 33;
            parkAll(d.mid);
            p.s = wrap(s0 + span * 0.35 + (lt - aerialLen) * sp); p.lat = k % 2 ? -1.75 : 1.75; p.speed = sp;
            placeTraffic(p.s, lt - aerialLen, k + 1);
            place = () => {
              pose(p.s - 6.8, p.lat * 0.6, A);
              cam.position.set(A.x, 2.15, A.z);
              pose(p.s + 9, p.lat * 0.4, B);
              look(B.x, 0.9, B.z);
              lens(58, FAR_GAME);
            };
            fade = Math.min(1, (lt - aerialLen) / 0.12 + 0.35);
          }
          overlay.push(() => lowerThird(d, k, cardA));
        } else {
          // 3. Out over the whole map again, and the end card.
          const u = (t - SEG1) / (LEN - SEG1), kk = ease(u);
          parkAll(0);
          p.s = 60; p.speed = 0;
          fogK = lerp(0.4, 0.12, kk);
          place = () => overview(1 - u * 0.3, lerp(0.5, 1, kk));
          const ea = Math.min(1, Math.max(0, (t - SEG1 - 1.5) / 1.2));
          overlay.push(() => {
            drawRoute(Math.min(1, u * 3));
            labelDistricts(Math.min(1, Math.max(0, u * 3 - 0.6)));
            text({ text: "متسابق الليل", size: 0.1, arabic: true, poster: true, color: "#ffc45c", glow: "rgba(255,160,40,0.6)" }, W / 2, H * 0.47, "center", ea);
            text({ text: "NIGHT RACER", size: 0.06, italic: true, track: 0.12, rule: 0.22 }, W / 2, H * 0.56, "center", ea);
            text({ text: "FROM SHARQ TO THE CITY CENTRE — THE ROAD IS YOURS AFTER MIDNIGHT", size: 0.018, weight: 600, track: 0.32, color: "rgba(255,255,255,0.75)" }, W / 2, H * 0.62, "center", ea);
          });
          fade = 1 - Math.max(0, (t - (LEN - 1.6)) / 1.6);
        }

        e.timeHours = hour;
        e.world.setTimeOfDay(hour);
        e.applyDaylight();
        fog.density = FOG_GAME * fogK;
        const aerialHigh = t < SEG0 || t >= SEG1;
        aerialWorld(aerialHigh);
        const prof = {};
        let tp = performance.now();
        const mark = (k) => { const n = performance.now(); prof[k] = Math.round(n - tp); tp = n; };
        const keep = { s: p.s, lat: p.lat, speed: p.speed };
        e.update(dt);
        p.s = keep.s; p.lat = keep.lat; p.speed = keep.speed;
        e.update(0);
        place();
        e.updateBeamVisibility?.();
        mark("update");
        // The paint probe, from where this frame stands. The game renders
        // one face a frame (renderProbe), so a moving camera's paint
        // reflects where it has been over the last six frames — and that
        // is what the film draws, at a sixth of the cost of filling all
        // six faces every frame the way a single still has to.
        e.renderProbe();
        mark("probe");
        e.composer.render();
        mark("render");
        fog.density = FOG_GAME;
        aerialWorld(false);
        window.__mapProf = prof;

        ctx.clearRect(0, 0, W, H);
        // Fades as a black veil over the picture.
        if (fade < 1) { ctx.fillStyle = `rgba(0,0,0,${(1 - Math.max(0, fade)).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
        for (const o of overlay) o();
        return true;
      };
    }, { W: WIDTH, H: HEIGHT, TIER, AREAS_IN: AREAS, LEN, RENDER });

    const t0 = Date.now();
    let done = 0;
    for (const i of todo) {
      const t = i / FPS;
      await page.evaluate(([t, dt]) => window.__mapFrame(t, dt), [t, 1 / FPS]);
      // The browser composites the game canvas and the card layer; this
      // reads that once. Written to a temporary name and renamed, so a
      // frame on disk is always a whole one (the resume trusts that).
      const tmp = `${name(i)}.part`;
      const ts = Date.now();
      await page.screenshot({ path: tmp, type: "jpeg", quality: 94, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
      const shotMs = Date.now() - ts;
      renameSync(tmp, name(i));
      done++;
      if (arg("only", "") || process.env.PROFILE) {
        const prof = await page.evaluate(() => window.__mapProf);
        console.log(`${tag}  frame ${i} (t ${t.toFixed(2)} s) — ${((Date.now() - t0) / 1000 / done).toFixed(1)} s a frame so far; ms ${JSON.stringify({ ...prof, shot: shotMs })}`);
      }
      if (done % 12 === 0 || done === todo.length) {
        const rate = done / ((Date.now() - t0) / 1000);
        console.log(`${tag}  ${done}/${todo.length} (t ${t.toFixed(2)} s) — ${(1 / rate).toFixed(1)} s a frame, ~${((todo.length - done) / rate / 3600).toFixed(1)} h left`);
      }
    }
    await browser.close();
  }
}

if (arg("only", "") || process.argv.includes("--no-encode")) {
  if (arg("only", "")) console.log(`sample   frames written to ${FRAMEDIR}; not encoding`);
  process.exit(0);
}

// -------------------------------------------------------------- encode
const ff = findFfmpeg();
const frames = existsSync(FRAMEDIR) ? readdirSync(FRAMEDIR).filter((f) => f.endsWith(".jpg")).length : 0;
// Contiguous from frame 0: an encode of a partial render stops at the
// first gap rather than freezing on it.
let run = 0;
while (existsSync(name(run))) run++;
const dur = run / FPS;
const args = [
  "-y", "-hide_banner", "-loglevel", "error",
  "-framerate", String(FPS), "-i", `${FRAMEDIR}/f%05d.jpg`,
  "-stream_loop", "-1", "-i", MUSIC,
  "-filter_complex", `[1:a]atrim=0:${dur},asetpts=N/SR/TB,afade=t=in:d=2,afade=t=out:st=${Math.max(0, dur - 3)}:d=3,volume=0.6,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`,
  "-map", "0:v", "-map", "[aout]", "-t", String(dur),
  "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart",
  OUT,
];
if (!ff) {
  console.log(`\nframes   ${frames} in ${FRAMEDIR}; no ffmpeg found. Encode with:\n\n  ffmpeg ${args.map((a) => (/[ ;[\]|]/.test(a) ? `'${a}'` : a)).join(" ")}\n`);
  process.exit(0);
}
if (run < TOTAL) console.log(`WARNING  frames 0-${run - 1} of ${TOTAL} are contiguous on disk — encoding those (${dur.toFixed(1)} s)`);
mkdirSync(OUT.replace(/\/[^/]+$/, ""), { recursive: true });
execFileSync(ff, args, { stdio: ["ignore", "inherit", "inherit"] });
console.log(`encoded  ${OUT} — ${run} frames, ${dur.toFixed(1)} s at ${FPS} fps`);
