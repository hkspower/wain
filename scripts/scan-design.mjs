import { chromium } from "playwright";

/**
 * A Photoshop-style read of the rendered design: luminance histogram, black
 * and white points, midtone placement, per-channel balance and clipping —
 * the numbers the Levels and Histogram panels show, measured from the real
 * pixels rather than eyeballed.
 */
const BASE = "http://localhost:4173";
const VIEWS = [
  ["home", "/", 0],
  ["explore", "/explore/", 0],
  ["place", "/places/kuwait-towers/", 0],
  ["search", "/search/?q=" + encodeURIComponent("بحر"), 0],
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

function analyse(px) {
  const lum = new Array(256).fill(0);
  const ch = { r: new Array(256).fill(0), g: new Array(256).fill(0), b: new Array(256).fill(0) };
  let n = 0, sumR = 0, sumG = 0, sumB = 0, sat = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const l = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    lum[l]++; ch.r[r]++; ch.g[g]++; ch.b[b]++;
    sumR += r; sumG += g; sumB += b; n++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat += mx === 0 ? 0 : (mx - mn) / mx;
  }
  const pct = (p) => { let c = 0, t = n * p; for (let i = 0; i < 256; i++) { c += lum[i]; if (c >= t) return i; } return 255; };
  const clipBlack = (lum[0] + lum[1]) / n, clipWhite = (lum[254] + lum[255]) / n;
  return {
    black: pct(0.005), median: pct(0.5), white: pct(0.995),
    mean: Math.round((sumR + sumG + sumB) / (3 * n)),
    clipBlack: +(clipBlack * 100).toFixed(2), clipWhite: +(clipWhite * 100).toFixed(2),
    cast: { r: Math.round(sumR / n), g: Math.round(sumG / n), b: Math.round(sumB / n) },
    saturation: +((sat / n) * 100).toFixed(1),
    // How much of the frame sits in each zone
    shadows: +(((lum.slice(0, 86).reduce((a, b) => a + b, 0)) / n) * 100).toFixed(1),
    mids: +(((lum.slice(86, 171).reduce((a, b) => a + b, 0)) / n) * 100).toFixed(1),
    highs: +(((lum.slice(171).reduce((a, b) => a + b, 0)) / n) * 100).toFixed(1),
  };
}

console.log("PHOTOSHOP-STYLE HISTOGRAM READ (levels measured from rendered pixels)\n");
for (const [name, route] of VIEWS) {
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(350);
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 900 } });
  const px = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    return Array.from(x.getImageData(0, 0, c.width, c.height).data);
  }, buf.toString("base64"));

  const a = analyse(px);
  const castSpread = Math.max(a.cast.r, a.cast.g, a.cast.b) - Math.min(a.cast.r, a.cast.g, a.cast.b);
  console.log(`── ${name}`);
  console.log(`   levels    black ${a.black}  median ${a.median}  white ${a.white}   (0–255)`);
  console.log(`   zones     shadows ${a.shadows}%  mids ${a.mids}%  highlights ${a.highs}%`);
  console.log(`   clipping  black ${a.clipBlack}%  white ${a.clipWhite}%`);
  console.log(`   cast      R${a.cast.r} G${a.cast.g} B${a.cast.b}  spread ${castSpread}`);
  console.log(`   saturation ${a.saturation}%`);
  const notes = [];
  if (a.white < 245) notes.push(`no true white (brightest ${a.white}) — flat highlights`);
  if (a.black > 40) notes.push(`no true black (darkest ${a.black}) — washed shadows`);
  if (a.clipWhite > 60) notes.push(`${a.clipWhite}% pure white — very light-dominant`);
  if (castSpread > 12) notes.push(`colour cast, ${castSpread} levels between channels`);
  console.log(notes.length ? "   ⚠ " + notes.join("\n   ⚠ ") : "   ✓ full tonal range, neutral, no clipping issues");
  console.log("");
}
await browser.close();
