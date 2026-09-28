// The game's trailer: about 39 seconds of the Gulf Road, narrated in
// Kuwaiti Arabic, rendered frame by frame from the running game.
//
//   npm run dev
//   node tools/shots/trailer.mjs                 # 1920x1080, 24 fps, lossless
//   node tools/shots/trailer.mjs --width 3840    # 4K — on a machine with a GPU
//   node tools/shots/trailer.mjs --jpeg          # a quick preview: JPEG frames, MP4 only
//   node tools/shots/trailer.mjs --audio-only    # re-mix the sound onto existing frames
//
// LOSSLESS, END TO END. Every frame is read back as PNG and the master
// is FFV1 in Matroska — the archival lossless codec, RGB, no chroma
// subsampling — with the mix as FLAC. Nothing between the renderer and
// that file loses a bit. Beside it a playback MP4 is written for the
// players and browsers that cannot open FFV1 (H.264 at CRF 12, 4:2:0,
// AAC 320k): visually transparent, but it is the copy, not the master.
// The only losses in the chain are upstream of it and cannot be
// undone here: the narration and the score are MP3 renders.
// PNG readback costs about twice what JPEG does on a software
// renderer (measured in exportfilm.mjs: 26 s against 9 s a frame at
// 1280 wide) — so --jpeg exists for a look before the long run.
//
// Rendered the way tools/shots/exportfilm.mjs renders the pre-race film,
// and for the same reason: a screen recording of a software renderer
// is a recording of the renderer. Every frame is a pure function of its
// timestamp — the hour, the camera, where every car is on the road — set
// explicitly, drawn, and read back, so the result is a true 24 fps film
// however long each frame took. And because each frame depends only on
// its own time, a render that dies half way (a container restart, a
// closed laptop) RESUMES: frames already on disk are skipped.
//
// THE SHOTS, and the narration line each one carries:
//
//    0-6   the corniche at golden hour, craning up into the skyline
//          "Kuwait... when the sun goes down, the Gulf Road wakes up."
//    6-11  night falls over the towers; the city lights
//          "The lights come on... and the road is calling."
//   11-16  low tracking shot, your car on the empty Gulf Road
//          "Every night... a new challenge."
//   16-21  the challenge: flash your lights at the car ahead
//          "Flash your lights... and let your rival know you're coming."
//   21-27  three of the eight legends, each with their name card
//          "Eight legends... each one with a story."
//   27-33  the duel: side by side at speed
//          "From Sharq to Salmiya... the night is yours."
//   33-39  the title
//          "Night Racer."
//
// THE VOICE is press/trailer/narration-ar.mp3: one take generated with
// ElevenLabs (voice "Mohamed – Warm Arabic Business Narrator", Kuwaiti
// accent, eleven_multilingual_v2). LINES below are its seven lines, cut
// at the pauses ffmpeg's silencedetect found in that take (-35 dB,
// 0.3 s) — regenerate the take and these have to be re-measured.
//
// THE MUSIC is the game's own battle score, ducked under every line.
//
// Needs ffmpeg: $FFMPEG, one on PATH, or `npx ffmpeg-static` installed
// anywhere and pointed to with FFMPEG=. Without one the frames are
// written and the exact encode commands are printed.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const FPS = Number(arg("fps", 24));
const WIDTH = Number(arg("width", 1920));
const HEIGHT = Math.round((WIDTH * 9) / 16);
const OUT = arg("out", `press/trailer/trailer-${HEIGHT}p.mp4`);
const FRAMEDIR = arg("frames", `press/trailer/frames-${HEIGHT}p`);
const AUDIO_ONLY = process.argv.includes("--audio-only");
const JPEG = process.argv.includes("--jpeg");
const EXT = JPEG ? "jpg" : "png";
const MASTER = OUT.replace(/\.mp4$/, "-master.mkv");
const NARRATION = "press/trailer/narration-ar.mp3";
const MUSIC = "public/music/battle.mp3";
const LEN = 39;

/** The narration's seven lines: [from, to] in the take, and where each
 *  lands in the film. */
const LINES = [
  { src: [0.0, 3.85], at: 0.8 },
  { src: [4.15, 6.75], at: 6.5 },
  { src: [7.1, 9.06], at: 11.8 },
  { src: [9.45, 12.83], at: 16.4 },
  { src: [13.13, 15.96], at: 21.6 },
  { src: [16.27, 19.1], at: 27.8 },
  { src: [19.5, 20.72], at: 34.4 },
];
/** Effects from the game's own sfx, on the beats that want them. */
const SFX = [
  { file: "public/sfx/flash.mp3", at: 17.6, gain: 0.8 },
  { file: "public/sfx/flash.mp3", at: 18.3, gain: 0.8 },
  { file: "public/sfx/blowoff.mp3", at: 29.4, gain: 0.6 },
];

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

// ------------------------------------------------------------- frames
if (!AUDIO_ONLY) {
  mkdirSync(FRAMEDIR, { recursive: true });
  const have = new Set(readdirSync(FRAMEDIR).filter((f) => f.endsWith(`.${EXT}`)));
  const total = Math.round(LEN * FPS);
  // --only 2,8,13 draws just the frames at those seconds: a contact
  // sheet to check the framing before committing hours to the render.
  const ONLY = arg("only", "");
  const todo = [];
  if (ONLY) for (const sec of ONLY.split(",").map(Number)) todo.push(Math.round(sec * FPS));
  else for (let i = 0; i < total; i++) if (!have.has(`f${String(i).padStart(5, "0")}.${EXT}`)) todo.push(i);
  console.log(`trailer      ${WIDTH}x${HEIGHT} at ${FPS} fps, ${total} frames — ${total - todo.length} on disk, ${todo.length} to draw`);

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
      args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
    });
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
    page.setDefaultTimeout(600000);
    page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
    await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("gulf-road-nights-onboarded", "2");
      localStorage.setItem("gulf-road-nights-coach", "3");
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.click("text=START ENGINE");
    await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 600000 });
    await page.evaluate(() => window.__grnEngine?.skipCinematic?.());
    await page.waitForTimeout(3000);
    // The webfonts, loaded before a card is drawn: a canvas draws with
    // whatever face is resident, and a face nothing on the page has
    // used yet is not.
    await page.evaluate(async () => {
      const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      await document.fonts.ready;
      for (const f of ["--font-display", "--font-arabic-display", "--font-arabic-poster"])
        await document.fonts.load(`700 60px ${v(f)}`, "متسابق الليل NIGHT RACER").catch(() => {});
    });

    // The director, installed once. Everything a frame needs is decided
    // from `t` alone.
    await page.evaluate(({ W, H, JPEG }) => {
      const e = window.__grnEngine;
      const THREE = window.__grnThree;
      e.setPaused(true);
      e.applyQualityTier("ultra");
      e.timeReal = false;
      e.timeCycling = false;
      const tr = e.track;
      const v = () => new THREE.Vector3();
      const P = v(), T = v(), R = v(), A = v(), B = v();
      const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
      const lerp = (a, b, k) => a + (b - a) * k;
      const pose = (s, lat, out) => { tr.pointAt(s, out); tr.sideAt(s, R); return out.addScaledVector(R, lat); };
      const cam = e.camera;
      const look = (x, y, z) => { cam.lookAt(x, y, z); cam.updateMatrixWorld(); };
      const setFov = (f) => { cam.fov = f; cam.updateProjectionMatrix(); };
      // Everything off the road that is not in the shot.
      const clearTraffic = (s) => { for (const c of e.traffic) c.s = tr.wrap(s + tr.length / 2); };
      const fontOf = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "sans-serif";
      const DISPLAY = fontOf("--font-display");
      // The game's own Arabic faces, as the menu wears them: the poster
      // face (Reem Kufi) for the title, the display face (Cairo) for the
      // rivals' names — not the body face, which is set for reading.
      const ARABIC = fontOf("--font-arabic-display") || DISPLAY;
      const ARABIC_POSTER = fontOf("--font-arabic-poster") || ARABIC;
      let rivalShown = -1;
      const showRival = (i) => {
        if (rivalShown === i) return;
        e.rivalIndex = i;
        e.spawnRival();
        rivalShown = i;
      };
      const out = document.createElement("canvas");
      out.width = W;
      out.height = H;
      const ctx = out.getContext("2d");

      /** Letterbox, fades and title cards, over the rendered frame. */
      const card = (lines, alpha) => {
        if (alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(0,0,0,0.85)";
        ctx.shadowBlur = H * 0.02;
        for (const l of lines) {
          ctx.font = `${l.weight ?? 700} ${Math.round(H * l.size)}px ${l.poster ? ARABIC_POSTER : l.arabic ? ARABIC : DISPLAY}`;
          ctx.fillStyle = l.color ?? "#ffffff";
          if (l.italic) ctx.font = `italic ${ctx.font}`;
          ctx.fillText(l.text, W * (l.x ?? 0.5), H * l.y);
        }
        ctx.restore();
      };

      window.__trailerFrame = (t, dt) => {
        let hour = 22.5;
        let fade = 1; // 0 black .. 1 picture
        const cards = [];
        // Each shot hands back how to place the lens; it is applied after
        // update(), which moves the camera itself.
        let place = () => {};
        const p = e.player;
        const r = () => e.rival;
        let S0 = 900; // the corniche, clear of the plaza
        if (t < 6) {
          // 1. Golden hour on the corniche, craning up into the skyline.
          const k = ease(t / 6);
          hour = lerp(17.35, 17.7, t / 6);
          clearTraffic(S0);
          p.s = tr.wrap(S0 + 30 + t * 6); p.lat = 0; p.speed = 6;
          place = () => {
            pose(S0 - 30 + t * 4, -26, A);
            cam.position.set(A.x, lerp(3, 26, k), A.z);
            pose(S0 + 420, 60, B);
            look(B.x, lerp(20, 45, k), B.z);
            setFov(50);
          };
          fade = Math.min(1, t / 1.2);
        } else if (t < 11) {
          // 2. Night falls over the towers.
          const u = (t - 6) / 5, k = ease(u);
          hour = lerp(18.25, 19.4, u);
          S0 = 1800;
          clearTraffic(S0);
          p.s = tr.wrap(S0 - 200); p.speed = 0;
          place = () => {
            pose(S0, -18, A);
            cam.position.set(A.x, lerp(14, 11, k), A.z);
            pose(S0 + 500, 90, B);
            look(B.x, lerp(55, 40, k), B.z);
            setFov(lerp(46, 40, k));
          };
        } else if (t < 16) {
          // 3. Low and fast beside your car on an empty road.
          const u = (t - 11) / 5;
          hour = 22.6;
          const sp = 52;
          S0 = 2600;
          p.s = tr.wrap(S0 + u * 5 * sp); p.lat = -1.75; p.speed = sp;
          clearTraffic(p.s);
          if (r()) r().s = tr.wrap(p.s + 900);
          place = () => {
            pose(p.s + lerp(-2.5, 3.5, ease(u)), p.lat + 3.1, A);
            cam.position.set(A.x, 0.55, A.z);
            pose(p.s + 1.2, p.lat, B);
            look(B.x, 0.62, B.z);
            setFov(56);
          };
        } else if (t < 21) {
          // 4. The challenge: close on the car ahead and flash it.
          const u = (t - 16) / 5, k = ease(u);
          hour = 23.1;
          showRival(0);
          const sp = 34;
          S0 = 3400;
          p.s = tr.wrap(S0 + u * 5 * sp); p.lat = 1.75; p.speed = sp;
          const rv = r();
          rv.s = tr.wrap(p.s + lerp(26, 17, k)); rv.lat = 1.75; rv.speed = sp; rv.state = "cruise";
          clearTraffic(p.s);
          place = () => {
            pose(p.s - lerp(7.5, 5.2, k), p.lat - lerp(2.6, 1.4, k), A);
            cam.position.set(A.x, lerp(0.85, 1.05, k), A.z);
            pose(p.s + 14, p.lat * 0.5, B);
            look(B.x, 1.0, B.z);
            setFov(48);
          };
          // Two flashes, on the beats the sound effects land on.
          if (!window.__flash1 && t >= 17.6) { e.flashHeadlights(); window.__flash1 = true; }
          if (!window.__flash2 && t >= 18.3) { e.flashHeadlights(); window.__flash2 = true; }
        } else if (t < 27) {
          // 5. Three of the eight: a slow orbit each, and a name card.
          const which = [0, 4, 7][Math.min(2, Math.floor((t - 21) / 2))];
          const u = ((t - 21) % 2) / 2, k = ease(u);
          hour = 23.4;
          showRival(which);
          S0 = 4200 + which * 40;
          const rv = r();
          rv.s = tr.wrap(S0); rv.lat = 0; rv.speed = 0; rv.state = "cruise";
          p.s = tr.wrap(S0 - 400); p.speed = 0;
          clearTraffic(S0);
          place = () => {
            pose(rv.s, rv.lat, B);
            tr.tangentAt(rv.s, T);
            tr.sideAt(rv.s, R);
            const a = lerp(2.3, 1.2, k);
            const rad = lerp(6.4, 5.2, k);
            cam.position.set(
              B.x + (T.x * Math.cos(a) + R.x * Math.sin(a)) * rad,
              B.y + lerp(1.4, 0.9, k),
              B.z + (T.z * Math.cos(a) + R.z * Math.sin(a)) * rad
            );
            look(B.x, B.y + 0.6, B.z);
            setFov(44);
          };
          const def = rv.def;
          const a2 = Math.min(1, u * 4) * Math.min(1, (1 - u) * 5);
          cards.push({ a: a2, lines: [
            { text: def.arabicName, y: 0.72, size: 0.085, arabic: true, color: "#ffc45c" },
            { text: def.name.toUpperCase(), y: 0.8, size: 0.04, italic: true },
            { text: def.crew, y: 0.855, size: 0.026, weight: 500, color: "rgba(255,255,255,0.8)" },
          ] });
        } else if (t < 33) {
          // 6. The duel: side by side, the lens ahead and falling back.
          const u = (t - 27) / 6, k = ease(u);
          hour = 23.8;
          showRival(7);
          const sp = 58;
          S0 = 5200;
          p.s = tr.wrap(S0 + u * 6 * sp); p.lat = -1.75; p.speed = sp;
          const rv = r();
          rv.s = tr.wrap(p.s + lerp(1.5, -0.6, k)); rv.lat = 1.75; rv.speed = sp; rv.state = "cruise";
          clearTraffic(p.s);
          place = () => {
            tr.tangentAt(p.s, T);
            pose(p.s + lerp(11, 6.5, k), 0, A);
            cam.position.set(A.x, lerp(0.7, 1.0, k), A.z);
            pose(p.s, 0, B);
            look(B.x, 0.7, B.z);
            setFov(52);
          };
        } else {
          // 7. The title, over the skyline, and out to black.
          const u = (t - 33) / 6, k = ease(u);
          hour = 0.4;
          S0 = 1800;
          p.s = tr.wrap(S0 - 200); p.speed = 0;
          clearTraffic(S0);
          place = () => {
            pose(S0, -24, A);
            cam.position.set(A.x, lerp(8, 30, k), A.z);
            pose(S0 + 500, 90, B);
            look(B.x, lerp(40, 70, k), B.z);
            setFov(44);
          };
          const ta = Math.min(1, Math.max(0, (t - 34.2) / 0.8));
          cards.push({ a: ta, lines: [
            { text: "متسابق الليل", y: 0.47, size: 0.13, arabic: true, poster: true, color: "#ffc45c" },
            { text: "NIGHT RACER", y: 0.6, size: 0.075, italic: true },
            { text: "KUWAIT XTREME RACER", y: 0.67, size: 0.024, weight: 600, color: "rgba(255,255,255,0.7)" },
          ] });
          fade = 1 - Math.max(0, (t - 37.6) / 1.4);
        }
        e.timeHours = hour;
        e.world.setTimeOfDay(hour);
        e.applyDaylight();
        // The update moves wheels, lamps and suspension; the positions
        // are re-asserted after it so physics cannot walk a car off its
        // mark.
        const keep = { s: p.s, lat: p.lat, speed: p.speed };
        const rk = e.rival ? { s: e.rival.s, lat: e.rival.lat } : null;
        e.update(dt);
        p.s = keep.s; p.lat = keep.lat; p.speed = keep.speed;
        if (rk && e.rival) { e.rival.s = rk.s; e.rival.lat = rk.lat; }
        e.update(0);
        place();
        e.composer.render();

        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = Math.max(0, Math.min(1, fade));
        ctx.drawImage(e.renderer.domElement, 0, 0, W, H);
        ctx.globalAlpha = 1;
        // A 2.39:1 letterbox: bars, not a crop, so the 16:9 file plays
        // anywhere.
        const bar = Math.round((H - W / 2.39) / 2);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, bar);
        ctx.fillRect(0, H - bar, W, bar);
        for (const c of cards) card(c.lines, c.a * fade);
        return JPEG ? out.toDataURL("image/jpeg", 0.93) : out.toDataURL("image/png");
      };
    }, { W: WIDTH, H: HEIGHT, JPEG });

    const t0 = Date.now();
    let done = 0;
    for (const i of todo) {
      const t = i / FPS;
      const img = await page.evaluate(([t, dt]) => window.__trailerFrame(t, dt), [t, 1 / FPS]);
      writeFileSync(`${FRAMEDIR}/f${String(i).padStart(5, "0")}.${EXT}`, Buffer.from(img.split(",")[1], "base64"));
      done++;
      if (done % 12 === 0 || done === todo.length) {
        const rate = done / ((Date.now() - t0) / 1000);
        console.log(`  ${done}/${todo.length} (${t.toFixed(2)} s) — ${(1 / rate).toFixed(1)} s a frame, ~${Math.round((todo.length - done) / rate / 60)} min left`);
      }
    }
    await browser.close();
  }
}

if (arg("only", "")) {
  console.log(`sample       frames written to ${FRAMEDIR} (f<frame>.jpg at ${FPS} fps); not encoding`);
  process.exit(0);
}

// -------------------------------------------------------------- sound
const ff = findFfmpeg();
const frames = existsSync(FRAMEDIR) ? readdirSync(FRAMEDIR).filter((f) => f.endsWith(`.${EXT}`)).length : 0;
const inputs = ["-framerate", String(FPS), "-i", `${FRAMEDIR}/f%05d.${EXT}`, "-i", MUSIC];
const filters = [];
// The music: faded in, faded out with the picture, and ducked under the
// narration by a sidechain compressor keyed on the voice bus.
filters.push(`[1:a]atrim=0:${LEN},asetpts=N/SR/TB,afade=t=in:d=1.5,afade=t=out:st=${LEN - 2.5}:d=2.5,volume=0.55[music]`);
LINES.forEach((l, i) => {
  inputs.push("-i", NARRATION);
  const ms = Math.round(l.at * 1000);
  filters.push(`[${2 + i}:a]atrim=${l.src[0]}:${l.src[1]},asetpts=N/SR/TB,afade=t=in:d=0.04,afade=t=out:st=${(l.src[1] - l.src[0] - 0.08).toFixed(2)}:d=0.08,adelay=${ms}|${ms},apad=whole_dur=${LEN}[v${i}]`);
});
filters.push(`${LINES.map((_, i) => `[v${i}]`).join("")}amix=inputs=${LINES.length}:normalize=0,volume=1.6[voice]`);
SFX.forEach((s, i) => {
  inputs.push("-i", s.file);
  const ms = Math.round(s.at * 1000);
  filters.push(`[${2 + LINES.length + i}:a]adelay=${ms}|${ms},volume=${s.gain},apad=whole_dur=${LEN}[s${i}]`);
});
filters.push(`[voice]asplit=2[vkey][vmix]`);
filters.push(`[music][vkey]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350[ducked]`);
filters.push(`[ducked][vmix]${SFX.map((_, i) => `[s${i}]`).join("")}amix=inputs=${2 + SFX.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`);
const common = [
  "-y", "-hide_banner", "-loglevel", "error",
  ...inputs,
  "-filter_complex", filters.join(";"),
  "-map", "0:v", "-map", "[aout]",
  "-t", String(LEN),
];
/** The playback copy: H.264 for every player, at a quality no eye
 *  separates from the master, plus the master's own audio at 320k. */
const copyArgs = [
  ...common,
  "-c:v", "libx264", "-preset", "slower", "-crf", JPEG ? "18" : "12",
  "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
  "-c:a", "aac", "-b:a", "320k",
  "-movflags", "+faststart",
  OUT,
];
/** The lossless master: FFV1 (RGB, no subsampling) with the mix as FLAC. */
const masterArgs = [
  ...common,
  "-c:v", "ffv1", "-level", "3", "-coder", "1", "-context", "1", "-g", "1", "-slices", "16", "-slicecrc", "1",
  "-pix_fmt", "gbrp",
  "-c:a", "flac", "-compression_level", "8",
  MASTER,
];
const quote = (a) => (/[ ;[\]|]/.test(a) ? `'${a}'` : a);
if (!ff) {
  console.log(
    `\nframes       ${frames} in ${FRAMEDIR}; no ffmpeg found. Encode with:\n\n` +
    (JPEG ? "" : `  ffmpeg ${masterArgs.map(quote).join(" ")}\n\n`) +
    `  ffmpeg ${copyArgs.map(quote).join(" ")}\n`
  );
  process.exit(0);
}
if (frames < Math.round(LEN * FPS)) console.log(`WARNING      only ${frames} of ${Math.round(LEN * FPS)} frames — encoding what there is`);
mkdirSync(OUT.replace(/\/[^/]+$/, ""), { recursive: true });
const size = (f) => (Number(execFileSync("stat", ["-c", "%s", f], { encoding: "utf8" }).trim()) / 1e6).toFixed(1);
if (!JPEG) {
  execFileSync(ff, masterArgs, { stdio: ["ignore", "inherit", "inherit"] });
  console.log(`master       ${MASTER} — ${size(MASTER)} MB, FFV1 RGB + FLAC, lossless from the frames`);
}
execFileSync(ff, copyArgs, { stdio: ["ignore", "inherit", "inherit"] });
console.log(`encoded      ${OUT} — ${size(OUT)} MB, ${frames} frames at ${FPS} fps, H.264 playback copy${JPEG ? "" : " of the master"}`);
