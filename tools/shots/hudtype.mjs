// What the HUD's type actually is, measured in the browser.
//
//   npm run dev
//   node tools/shots/hudtype.mjs
//
// Typography is the one part of a game people judge instantly and the
// hardest to argue about from source, because almost everything that
// matters is decided after the CSS: which family actually resolved,
// whether the weight exists or was synthesised, whether the figures are
// really tabular. `font-variant-numeric: tabular-nums` is the sharpest
// example — it is silently a no-op if the font has no `tnum` table, and
// the only way to know is to set the digits and measure the box.
//
// So this reads the COMPUTED style of every text node in the HUD and
// then, for anything that shows a number, measures the rendered width of
// the widest and narrowest digit strings. A readout whose width changes
// with its value is a readout that dances, and at 60 frames a second on
// a speed that never stops changing, it is the most visible thing on the
// screen.
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
  args: ["--use-gl=angle", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(240000);
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnEngine, null, { timeout: 240000 });
// Get the car moving so every readout has a real value in it.
await page.evaluate(async () => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.player.speed = 188 / 3.6;
  e.setTouchInput({ throttle: 1, brake: 0, steer: 0 });
  for (let i = 0; i < 90; i++) { e.update(1 / 60); e.player.speed = 188 / 3.6; }
  await new Promise((r) => setTimeout(r, 400));
});

const report = await page.evaluate(async () => {
  await document.fonts.ready;
  const out = [];
  const seen = new Set();
  // Every element that renders text of its own, anywhere in the HUD.
  const roots = document.querySelectorAll("body *");
  const measure = document.createElement("span");
  document.body.appendChild(measure);

  for (const el of roots) {
    // Own text only — a wrapper's textContent is its children's.
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join("");
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") continue;

    const key = `${own}|${cs.fontFamily}|${cs.fontSize}|${cs.fontWeight}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Which family actually took the text, rather than the whole stack.
    const families = cs.fontFamily.split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""));
    let resolved = null;
    for (const f of families) {
      if (document.fonts.check(`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} "${f}"`)) { resolved = f; break; }
    }

    // Does this readout hold a number that changes?
    const numeric = /\d/.test(own);
    let digitSpread = null;
    if (numeric) {
      // Same styling, three digit strings of equal length. If the widths
      // differ the figures are proportional and the readout will dance.
      measure.style.cssText = "";
      for (const p of ["fontFamily","fontSize","fontWeight","fontStyle","letterSpacing","fontVariantNumeric","fontFeatureSettings","fontStretch"]) {
        measure.style[p] = cs[p];
      }
      measure.style.position = "absolute";
      measure.style.visibility = "hidden";
      measure.style.whiteSpace = "pre";
      const widths = ["111", "888", "000", "479"].map((s) => {
        measure.textContent = s;
        return measure.getBoundingClientRect().width;
      });
      digitSpread = +(Math.max(...widths) - Math.min(...widths)).toFixed(2);
    }

    out.push({
      text: own.length > 18 ? own.slice(0, 18) + "…" : own,
      family: families[0],
      resolved,
      px: +parseFloat(cs.fontSize).toFixed(1),
      weight: cs.fontWeight,
      style: cs.fontStyle,
      tracking: cs.letterSpacing === "normal" ? 0 : +parseFloat(cs.letterSpacing).toFixed(2),
      numeric: cs.fontVariantNumeric,
      features: cs.fontFeatureSettings,
      digitSpread,
      at: [Math.round(r.x), Math.round(r.y)],
    });
  }
  measure.remove();
  // The loaded faces, so a stack that falls through to a system font is
  // visible rather than inferred.
  const faces = [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.style} ${f.status}`);
  return { out, faces: [...new Set(faces)].sort() };
});

mkdirSync("press/hud", { recursive: true });
writeFileSync("press/hud/type.json", JSON.stringify(report, null, 1) + "\n");

console.log(`loaded faces (${report.faces.length}):`);
for (const f of report.faces) console.log("  " + f);

console.log(`\n${report.out.length} text elements in the HUD\n`);
console.log("  px  wt  style  track  spread  resolved family            variant           text");
const rows = report.out.slice().sort((a, b) => b.px - a.px);
for (const r of rows) {
  console.log(
    `${String(r.px).padStart(5)} ${String(r.weight).padStart(3)} ` +
      `${(r.style === "italic" ? "ital" : "    ")}  ${String(r.tracking).padStart(5)}  ` +
      `${r.digitSpread === null ? "     -" : String(r.digitSpread).padStart(6)}  ` +
      `${String(r.resolved ?? "NONE — fell through").padEnd(24)} ` +
      `${String(r.numeric === "normal" ? "" : r.numeric).padEnd(17)} ${r.text}`
  );
}
const dancing = report.out.filter((r) => r.digitSpread !== null && r.digitSpread > 0.5);
console.log(
  `\n${dancing.length} numeric readout${dancing.length === 1 ? "" : "s"} whose width changes with the value` +
    (dancing.length ? ":" : " — nothing dances")
);
for (const d of dancing) console.log(`  ${d.digitSpread} px at ${d.px}px: "${d.text}"`);
const unresolved = report.out.filter((r) => !r.resolved);
if (unresolved.length) {
  console.log(`\n${unresolved.length} element(s) whose first family did not load:`);
  for (const u of unresolved) console.log(`  ${u.family} ${u.weight} — "${u.text}"`);
}
console.log("\nwrote press/hud/type.json");
await browser.close();
