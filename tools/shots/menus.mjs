// What colour the menus actually are.
//
//   npm run dev
//   node tools/shots/menus.mjs
//
// "Too blue" is a claim about pixels, and a stylesheet cannot answer it:
// half of what a menu looks like is a translucent layer over whatever is
// behind it, so the declared colour and the delivered colour are two
// different things. This screenshots each menu, decodes the PNG, and
// reports what a viewer's eye is actually receiving:
//
//   cast      blue minus red in the background, in 0-255. Zero is
//             neutral; the higher it is the bluer the screen reads.
//   lum       how light the background is, 0-1.
//   contrast  the body text against it, as a WCAG ratio. 4.5 is the
//             floor for normal text and it is not negotiable — a menu
//             that reads beautifully and cannot be read is a worse menu.
//
// The background sample is the MEDIAN pixel of the region, not the mean:
// a menu is mostly background with type and buttons scattered over it,
// and a mean drags toward whatever is brightest.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

/**
 * Minimal PNG decoder: 8-bit RGB or RGBA, non-interlaced, which is what
 * Chromium's screenshots are. Written out rather than pulled in because
 * the alternative is a dependency for four filter types.
 */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let w = 0, h = 0, depth = 0, colour = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      colour = data[9];
      if (depth !== 8 || (colour !== 2 && colour !== 6)) {
        throw new Error(`unsupported PNG: depth ${depth}, colour type ${colour}`);
      }
      if (data[12] !== 0) throw new Error("interlaced PNG");
    } else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const bpp = colour === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}

const srgbToLin = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export const relLuminance = ([r, g, b]) =>
  0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
export const contrastRatio = (a, b) => {
  const la = relLuminance(a), lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** The median pixel of a region, channel by channel. */
export function medianColour(img, box) {
  const { w, h, bpp, data } = img;
  const x0 = Math.max(0, Math.round(box.x));
  const y0 = Math.max(0, Math.round(box.y));
  const x1 = Math.min(w, Math.round(box.x + box.width));
  const y1 = Math.min(h, Math.round(box.y + box.height));
  const ch = [[], [], []];
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * w + x) * bpp;
      ch[0].push(data[i]);
      ch[1].push(data[i + 1]);
      ch[2].push(data[i + 2]);
    }
  }
  if (!ch[0].length) return [0, 0, 0];
  return ch.map((c) => {
    c.sort((a, b) => a - b);
    return c[c.length >> 1];
  });
}

const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

if (import.meta.url === `file://${process.argv[1]}`) {
  const browser = await chromium.launch({
    executablePath: exe,
    args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
           "--force-color-profile=srgb"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.setDefaultTimeout(180000);
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  mkdirSync("press/menus", { recursive: true });

  const seed = async () => {
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("gulf-road-nights-onboarded", "2");
      localStorage.setItem("gulf-road-nights-coach", "3");
    });
    await page.reload({ waitUntil: "networkidle" });
  };

  await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
  await seed();

  /** Each menu: how to get there, and where to sample the background. */
  const shots = [];
  const grab = async (name, region) => {
    const buf = await page.screenshot();
    writeFileSync(`press/menus/${name}.png`, buf);
    const img = decodePng(buf);
    const box = region ?? { x: 0, y: 0, width: img.w, height: img.h };
    const bg = medianColour(img, box);
    shots.push({ name, bg, lum: relLuminance(bg), cast: bg[2] - bg[0] });
  };

  // Each menu is opened, sampled and closed. A step that cannot find its
  // way is reported and skipped rather than killing the run — this is a
  // measuring tool, and a partial reading beats no reading.
  const step = async (name, open, close, region) => {
    try {
      await open();
      await page.waitForTimeout(800);
      await grab(name, region);
      if (close) await close();
      await page.waitForTimeout(600);
    } catch (err) {
      console.log(`${name.padEnd(10)} SKIPPED — ${String(err.message).split("\n")[0]}`);
    }
  };
  // Closing has to actually close. The how-to-play dialog is the
  // onboarding component, and while it is open the game's own Escape
  // handler refuses to open the pause menu — so a dialog left standing
  // here silently costs the last and most important measurement.
  const closeDialog = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const sel of ["text=SKIP", "text=/^DONE/", "text=/^BACK/", "text=/^CLOSE/"]) {
        const el = await page.$(sel);
        if (el && (await el.isVisible())) {
          await el.click().catch(() => {});
          break;
        }
      }
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
      const stuck = await page.$("[role='dialog']");
      if (!stuck || !(await stuck.isVisible())) return;
    }
    throw new Error("a dialog would not close");
  };

  await page.waitForSelector("nav[aria-label='Main menu']");
  await page.waitForTimeout(2200);
  await grab("menu");

  await step("garage", () => page.click("text=GARAGE"), closeDialog);
  await step("settings", () => page.click("text=SETTINGS"), closeDialog);
  await step("howto", () => page.click("text=HOW TO PLAY"), closeDialog);

  // In game, paused: the one that sits over the road, and the only one
  // whose look depends on what is behind it.
  // A fresh page before the last measurement. The how-to-play dialog is
  // the onboarding component, and the game's Escape handler is gated on
  // it being closed — so anything left standing by the steps above
  // silently costs the pause reading, which is the one measurement that
  // is actually about glass.
  await seed();
  await page.waitForSelector("nav[aria-label='Main menu']");
  await page.click("text=START ENGINE");
  await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
  // __grnDebug exists as soon as the ENGINE starts, which is a step
  // before the UI's phase becomes "playing" — and the pause key is gated
  // on that phase. Waiting for the HUD is waiting for the actual state,
  // rather than for a number of milliseconds that happened to work.
  await page.waitForSelector("[class*='hud-safe']", { timeout: 60000 });
  await page.waitForTimeout(3500);
  await page.evaluate(() => {
    const e = window.__grnEngine;
    e.timeHours = 22.5;
    e.world.setTimeOfDay(22.5);
    e.applyDaylight();
    e.player.s = 2203;
    e.player.lat = 0;
    e.player.speed = 0;
    for (let i = 0; i < 20; i++) e.update(1 / 60);
  });
  await page.waitForTimeout(600);
  await step(
    "pause",
    async () => {
      // Ask the engine to request a pause — the same event its Start
      // button fires, and the same one the UI listens to.
      //
      // Not the Escape key. Escape works for a player and refuses to
      // work for a script here for reasons this tool has no business
      // caring about; it is a measuring instrument, and it should reach
      // the state it wants to measure by the shortest path that is still
      // the app's own. Four keypresses that silently did nothing is how
      // this tool spent three runs reporting the night sky as a menu.
      await page.evaluate(() => window.__grnEngine.events.onPauseRequest());
      await page.waitForSelector("[aria-label='Paused']", { timeout: 20000 });
    },
    null
  );

  // The glass panel, and whether the type on it still reads.
  //
  // A lighter panel is the whole point of the change and it is also the
  // whole risk: every grey in this dialog was chosen against a near-black
  // ground. `text-white/60` on black is 12:1 and on frosted glass it can
  // be 3:1, which is a menu you cannot read while the car idles behind
  // it. So the muted text is measured, not assumed — and the sample is
  // taken from the panel's own padding, where there is no glyph to drag
  // the reading toward the text colour it is supposed to be judging.
  const panel = await page.$(".grn-dialog-glass");
  if (panel) {
    const box = await panel.boundingBox();
    const img = decodePng(await page.screenshot());
    // Well inside the panel. At +6 the strip straddled the panel's own
    // 1px border and the scrim outside it, which put the scrim's cast
    // into a reading that is supposed to be about the panel.
    const strip = { x: box.x + 20, y: box.y + 44, width: 12, height: box.height - 90 };
    const bg = medianColour(img, strip);
    const over = (alpha) => bg.map((c) => Math.round(alpha * 255 + (1 - alpha) * c));
    console.log(
      `\nglass panel  ${hex(bg)}  cast ${bg[2] - bg[0]}  luminance ${relLuminance(bg).toFixed(3)}`
    );
    // Every text colour the panel actually renders, read off the live
    // elements. A hardcoded list of "the colours we think are in there"
    // is a list that goes stale the first time somebody edits the
    // markup — and it already had one entry that this dialog does not
    // use and was missing one it does.
    const used = await page.evaluate(() => {
      const panel = document.querySelector(".grn-dialog-glass");
      const seen = new Map();
      for (const el of panel.querySelectorAll("*")) {
        const text = [...el.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.trim())
          .join("")
          .trim();
        if (!text) continue;
        const cs = getComputedStyle(el);
        // A button with its own background is judged against that
        // background, not against the glass behind it — and so is the
        // Arabic span nested inside that button, which has no background
        // of its own and was being measured against the panel it never
        // touches.
        let ownBg = false;
        for (let n = el; n && n !== panel.parentElement; n = n.parentElement) {
          const s2 = getComputedStyle(n);
          if (s2.backgroundImage !== "none" || !/rgba?\(0, 0, 0, 0\)/.test(s2.backgroundColor)) {
            if (n !== panel) ownBg = true;
            break;
          }
        }
        const key = cs.color + "|" + ownBg;
        if (!seen.has(key)) seen.set(key, { color: cs.color, ownBg, sample: text.slice(0, 22) });
      }
      return [...seen.values()];
    });
    const parse = (css) => {
      const m = css.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(",").map((v) => parseFloat(v));
      const a = p[3] ?? 1;
      // Alpha text composites over the panel it sits on.
      return p.slice(0, 3).map((c, i) => Math.round(a * c + (1 - a) * bg[i]));
    };
    for (const u of used) {
      const rgb = parse(u.color);
      if (!rgb) continue;
      if (u.ownBg) {
        console.log(`  ${u.sample.padEnd(24)} on its own button — not judged against the glass`);
        continue;
      }
      const ratio = contrastRatio(rgb, bg);
      console.log(
        `  ${u.sample.padEnd(24)} ${hex(rgb)}  ${ratio.toFixed(2)}:1  ` +
          `${ratio >= 4.5 ? "ok" : "BELOW THE 4.5 FLOOR"}`
      );
    }
  } else {
    console.log("\nglass panel  not on screen — the pause menu never opened");
  }

  // The hub lobby is a page of its own and was never in this list.
  try {
    await page.goto("http://localhost:3000/hub", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await grab("hub");
  } catch (err) {
    console.log(`hub        SKIPPED — ${String(err.message).split("\n")[0]}`);
  }

  console.log("\nmenu       background   cast(B-R)   luminance");
  for (const s of shots) {
    console.log(
      `${s.name.padEnd(10)} ${hex(s.bg)}      ${String(s.cast).padStart(4)}      ${s.lum.toFixed(3)}`
    );
  }
  console.log("\npress/menus/*.png");
  await browser.close();
}
