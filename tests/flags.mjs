// The flags: are they the right shape, the right colours, and the right
// flag?
//
//   npm run dev
//   npm run test:flags
//
// A flag is one of the few things in a game where being approximately
// right is visibly wrong to the people it belongs to, and it is also one
// of the easiest things to get wrong without anyone noticing — a wrong
// hex, a 3:2 drawn at 2:1, five serrations where there should be nine.
// None of that throws. It just quietly shows somebody the wrong flag.
//
// So this measures the pixels. For each flag it reads back the rendered
// canvas and checks:
//
//   ratio     the texture's own aspect against the specification
//   palette   that every colour the flag is SUPPOSED to have is actually
//             present in quantity, and sampled at the point where that
//             colour belongs — a band check that only counts pixels
//             would pass a flag with its stripes in the wrong order
//   ink       that the flags carrying an emblem or an inscription have
//             one: a measurable amount of non-field colour where the
//             emblem goes. This is what catches a font that never
//             loaded, which is the failure mode Arabic script has.
//   distinct  that no two flags are the same image. Bahrain and Qatar
//             differ only in proportion, serration count and hue, and a
//             copy-paste between them would pass every other check here.

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); return ok ? "ok" : "FAIL"; };

// What each flag must contain, and where. Points are in fractions of the
// flag's own width and height, so they follow the proportions rather
// than assuming them. Colours are the published ones; the tolerance is
// generous enough for canvas antialiasing and tight enough that a wrong
// red fails.
const EXPECT = {
  bh: { ratio: 5 / 3, at: [[0.1, 0.5, "#ffffff"], [0.75, 0.5, "#ce1126"]] },
  cy: { ratio: 3 / 2, at: [[0.1, 0.15, "#ffffff"], [0.5, 0.42, "#d57800"]],
       emblem: [0.5, 0.5, 0.22, "#ffffff"] },
  eg: { ratio: 3 / 2, at: [[0.15, 0.15, "#ce1126"], [0.15, 0.5, "#ffffff"], [0.15, 0.85, "#000000"]],
       emblem: [0.5, 0.5, 0.12, "#ffffff"] },
  ir: { ratio: 7 / 4, at: [[0.5, 0.1, "#239f40"], [0.1, 0.5, "#ffffff"], [0.5, 0.9, "#da0000"]],
       emblem: [0.5, 0.5, 0.09, "#ffffff"], emblem2: [0.5, 0.305, 0.03, "#239f40"] },
  iq: { ratio: 3 / 2, at: [[0.15, 0.15, "#ce1126"], [0.15, 0.5, "#ffffff"], [0.15, 0.85, "#000000"]],
       emblem: [0.5, 0.5, 0.14, "#ffffff"] },
  il: { ratio: 11 / 8, at: [[0.5, 0.02, "#ffffff"], [0.5, 0.19, "#0038b8"]],
       emblem: [0.5, 0.5, 0.16, "#ffffff"] },
  jo: { ratio: 2, at: [[0.7, 0.15, "#000000"], [0.7, 0.5, "#ffffff"], [0.7, 0.85, "#007a3d"], [0.08, 0.5, "#ce1126"]],
       emblem: [0.176, 0.5, 0.05, "#ce1126"] },
  kw: { ratio: 2, at: [[0.7, 0.15, "#007a3d"], [0.7, 0.5, "#ffffff"], [0.7, 0.85, "#ce1126"], [0.06, 0.5, "#000000"]] },
  lb: { ratio: 3 / 2, at: [[0.15, 0.1, "#ed1c24"], [0.15, 0.5, "#ffffff"], [0.15, 0.9, "#ed1c24"]],
       emblem: [0.5, 0.48, 0.14, "#ffffff"] },
  om: { ratio: 2, at: [[0.6, 0.15, "#ffffff"], [0.6, 0.5, "#db161b"], [0.6, 0.85, "#008000"], [0.06, 0.8, "#db161b"]],
       emblem: [0.14, 0.22, 0.07, "#db161b"] },
  ps: { ratio: 2, at: [[0.7, 0.15, "#000000"], [0.7, 0.5, "#ffffff"], [0.7, 0.85, "#007a3d"], [0.08, 0.5, "#ce1126"]] },
  qa: { ratio: 28 / 11, at: [[0.1, 0.5, "#ffffff"], [0.75, 0.5, "#8a1538"]] },
  // Two probes: the shahada, and the sword under it. One region
  // covering both passed with the inscription deleted, because the
  // sword alone filled 12.5% of it — an assertion that names the script
  // has to look ONLY where the script is.
  sa: { ratio: 3 / 2, at: [[0.05, 0.06, "#006c35"]],
       emblem: [0.5, 0.38, 0.11, "#006c35"], emblem2: [0.5, 0.66, 0.05, "#006c35"] },
  sy: { ratio: 3 / 2, at: [[0.05, 0.15, "#ce1126"], [0.05, 0.5, "#ffffff"], [0.05, 0.85, "#000000"]],
       emblem: [0.333, 0.5, 0.07, "#ffffff"] },
  tr: { ratio: 3 / 2, at: [[0.85, 0.5, "#e30a17"], [0.22, 0.5, "#ffffff"]],
       // The STAR, not the middle of the crescent — the middle of a
       // crescent is the bite taken out of it, and is correctly the
       // colour of the field.
       emblem: [0.539, 0.5, 0.085, "#e30a17"] },
  ae: { ratio: 2, at: [[0.7, 0.15, "#00732f"], [0.7, 0.5, "#ffffff"], [0.7, 0.85, "#000000"], [0.1, 0.5, "#ff0000"]] },
  ye: { ratio: 3 / 2, at: [[0.5, 0.15, "#ce1126"], [0.5, 0.5, "#ffffff"], [0.5, 0.85, "#000000"]] },
};

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
// The debug hooks are registered by the engine, so the engine has to
// start before any of them exist.
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnFlags, null, { timeout: 240000 });
// The script flags repaint when the Arabic font settles; give it that.
await page.waitForTimeout(3000);

const got = await page.evaluate((expect) => {
  const F = window.__grnFlags;
  const out = {};
  const sigs = {};
  for (const id of F.FLAG_IDS) {
    const spec = F.FLAGS[id];
    const tex = F.flagTexture(id);
    const img = tex.image;
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const at = (fx, fy) => {
      const x = Math.min(c.width - 1, Math.max(0, Math.round(fx * c.width)));
      const y = Math.min(c.height - 1, Math.max(0, Math.round(fy * c.height)));
      const i = (y * c.width + x) * 4;
      return [d[i], d[i + 1], d[i + 2]];
    };
    // A signature: mean colour of a 24x16 grid of cells. It has to be
    // this fine. At 6x4 a cell is a quarter of the flag's height, which
    // averages Jordan's star and Iraq's inscription away entirely and
    // declares four pairs of different countries' flags identical.
    const sig = [];
    for (let gy = 0; gy < 16; gy++) {
      for (let gx = 0; gx < 24; gx++) {
        let r = 0, g = 0, b = 0, n = 0;
        const x0 = Math.floor((gx * c.width) / 24), x1 = Math.floor(((gx + 1) * c.width) / 24);
        const y0 = Math.floor((gy * c.height) / 16), y1 = Math.floor(((gy + 1) * c.height) / 16);
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) {
            const i = (y * c.width + x) * 4;
            r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
          }
        }
        sig.push(Math.round(r / n), Math.round(g / n), Math.round(b / n));
      }
    }
    sigs[id] = sig;

    const e = expect[id];
    const samples = (e?.at ?? []).map(([fx, fy, want]) => ({
      want,
      got: at(fx, fy),
      at: [fx, fy],
    }));

    // Is the emblem actually THERE?
    //
    // The first version of this counted how much of the whole flag was
    // not one of its three commonest colours, and it could not work:
    // Israel's Star of David is the same blue as its own stripes, so
    // the star lived inside the colours it was being measured against
    // and a flag with no star at all scored the same. Oman's khanjar is
    // 0.09% of its flag and drowned in rounding.
    //
    // So the question is asked where the emblem is: inside a disc at the
    // emblem's own place, what fraction of pixels differ from the FIELD
    // colour it is drawn on? An emblem that drew is tens of percent. One
    // that did not is zero, whatever colour it would have been.
    const measure = (em) => {
      if (!em) return null;
      const [ex, ey, er, field] = em;
      const fr = parseInt(field.slice(1, 3), 16);
      const fg = parseInt(field.slice(3, 5), 16);
      const fb = parseInt(field.slice(5, 7), 16);
      const cx0 = ex * c.width, cy0 = ey * c.height, rad = er * c.height;
      let n = 0, diff = 0;
      for (let y = Math.max(0, cy0 - rad); y < Math.min(c.height, cy0 + rad); y++) {
        for (let x = Math.max(0, cx0 - rad); x < Math.min(c.width, cx0 + rad); x++) {
          if (Math.hypot(x - cx0, y - cy0) > rad) continue;
          const i = ((y | 0) * c.width + (x | 0)) * 4;
          n++;
          if (Math.abs(d[i] - fr) + Math.abs(d[i + 1] - fg) + Math.abs(d[i + 2] - fb) > 60) diff++;
        }
      }
      return n ? +((diff / n) * 100).toFixed(2) : 0;
    };
    const inkPct = measure(e?.emblem) ?? 0;
    const inkPct2 = measure(e?.emblem2);
    out[id] = {
      name: spec.name,
      ratio: +(img.width / img.height).toFixed(4),
      wantRatio: +spec.ratio.toFixed(4),
      px: `${img.width}x${img.height}`,
      samples,
      inkPct,
      inkPct2,
      script: !!spec.script,
    };
  }
  return { out, sigs };
}, EXPECT);

const hex = ([r, g, b]) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
const near = (got, want, tol = 26) => {
  const w = [1, 3, 5].map((i) => parseInt(want.slice(i, i + 2), 16));
  return Math.abs(got[0] - w[0]) <= tol && Math.abs(got[1] - w[1]) <= tol && Math.abs(got[2] - w[2]) <= tol;
};

console.log("\n=== FLAGS ===");
console.log("  flag                   texture      ratio            ink");
for (const id of Object.keys(got.out)) {
  const f = got.out[id];
  const ratioOk = Math.abs(f.ratio - f.wantRatio) / f.wantRatio < 0.01;
  const bad = f.samples.filter((s) => !near(s.got, s.want));
  console.log(
    `  ${(f.name + " (" + id + ")").padEnd(24)} ${f.px.padEnd(11)} ` +
      `${f.ratio.toFixed(3)}/${f.wantRatio.toFixed(3)} ${ratioOk ? "ok  " : "FAIL"} ` +
      `${String(f.inkPct).padStart(5)}%  ${bad.length ? "COLOUR " + bad.map((b) => `${b.at}=${hex(b.got)} want ${b.want}`).join("; ") : ""}`
  );
  check(ratioOk, `${f.name} is drawn ${f.ratio.toFixed(3)}:1 against a specified ${f.wantRatio.toFixed(3)}:1`);
  for (const b of bad) {
    check(false, `${f.name} is ${hex(b.got)} at (${b.at[0]}, ${b.at[1]}) where its specification says ${b.want}`);
  }
}

// Emblems and inscriptions have to actually be there.
console.log("");
for (const id of Object.keys(got.out)) {
  const f = got.out[id];
  if (!EXPECT[id]?.emblem) continue;
  console.log(
    `  emblem/script  ${f.name.padEnd(22)} ${check(f.inkPct > 4,
      `${f.name} should carry an emblem or an inscription, but only ${f.inkPct}% of the area where it belongs differs from the field — it did not draw`)}  ${String(f.inkPct).padStart(5)}%` +
      (f.inkPct2 == null ? "" : `  second mark ${check(f.inkPct2 > 4,
        `${f.name}'s second mark covers only ${f.inkPct2}% of its own patch — it did not draw`)} ${f.inkPct2}%`)
  );
}

// No two flags are the same picture.
const ids = Object.keys(got.sigs);
let clashes = 0;
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    // MAX cell difference, not mean. Jordan and Palestine are the same
    // flag apart from a seven-pointed star, and Syria and Yemen apart
    // from two small ones; averaged over the whole picture those vanish
    // into a rounding error and two different countries come out
    // identical. The largest single cell disagreement is exactly the
    // quantity a small emblem is large in.
    const a = got.sigs[ids[i]], b = got.sigs[ids[j]];
    let d = 0;
    for (let k = 0; k < a.length; k++) d = Math.max(d, Math.abs(a[k] - b[k]));
    if (d < 10) {
      clashes++;
      check(false, `${got.out[ids[i]].name} and ${got.out[ids[j]].name} render as the same picture`);
    }
  }
}
console.log(`\n  distinct       ${check(clashes === 0, `${clashes} pairs of flags are the same picture`)}  ` +
  `${ids.length} flags, no two alike`);

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nevery flag is its own flag, at its own proportions");
await browser.close();
process.exit(fail.length ? 1 : 0);
