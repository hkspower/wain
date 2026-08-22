// A sheet of every flag this game draws.
//
//   npm run dev
//   node tools/shots/flags.mjs
//
// Each one at its own proportions, laid out on a common HEIGHT rather
// than a common width — because that is how flags are actually flown
// next to each other, and it is the only layout in which Qatar's 28:11
// and Israel's 11:8 both look like themselves.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

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
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnFlags, null, { timeout: 240000 });
await page.waitForTimeout(3500); // let the Arabic font land and repaint

const b64 = await page.evaluate(() => {
  const F = window.__grnFlags;
  const ids = F.FLAG_IDS;
  const COLS = 3;
  const FH = 150;            // every flag flies at this height
  const CELL_W = 460;
  const CELL_H = FH + 74;
  const rows = Math.ceil(ids.length / COLS);
  const c = document.createElement("canvas");
  c.width = COLS * CELL_W + 40;
  c.height = rows * CELL_H + 84;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0b0e13";
  ctx.fillRect(0, 0, c.width, c.height);

  ctx.fillStyle = "#e8ecf2";
  ctx.font = "700 30px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("Flags of the Middle East", 22, 34);
  ctx.fillStyle = "#8a94a4";
  ctx.font = "400 15px system-ui, sans-serif";
  ctx.fillText(
    `${ids.length} flags, each drawn from its own specification and flown at its own proportions`,
    22,
    62
  );

  ids.forEach((id, i) => {
    const spec = F.FLAGS[id];
    const col = i % COLS, row = (i / COLS) | 0;
    const x0 = 20 + col * CELL_W;
    const y0 = 84 + row * CELL_H;
    const fw = FH * spec.ratio;
    const img = F.flagTexture(id).image;
    // A hairline so a white-edged flag still has an edge on dark.
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    ctx.drawImage(img, x0, y0, fw, FH);
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, fw - 1, FH - 1);
    ctx.fillStyle = "#e8ecf2";
    ctx.font = "600 17px system-ui, sans-serif";
    ctx.fillText(spec.name, x0, y0 + FH + 20);
    ctx.fillStyle = "#8a94a4";
    ctx.font = "400 15px system-ui, sans-serif";
    const r = spec.ratio;
    const nice =
      Math.abs(r - 2) < 0.001 ? "2:1"
      : Math.abs(r - 1.5) < 0.001 ? "3:2"
      : Math.abs(r - 5 / 3) < 0.001 ? "5:3"
      : Math.abs(r - 11 / 8) < 0.001 ? "11:8"
      : Math.abs(r - 28 / 11) < 0.001 ? "28:11"
      : Math.abs(r - 7 / 4) < 0.001 ? "7:4"
      : `${r.toFixed(2)}:1`;
    ctx.fillText(`${nice}   ${img.width}x${img.height}`, x0, y0 + FH + 42);
    ctx.font = "400 16px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(spec.nameAr, x0 + fw, y0 + FH + 20);
    ctx.textAlign = "left";
  });
  return c.toDataURL("image/png").split(",")[1];
});

mkdirSync("press/flags", { recursive: true });
writeFileSync("press/flags/sheet.png", Buffer.from(b64, "base64"));
console.log("  press/flags/sheet.png");
await browser.close();
