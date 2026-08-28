// The gadgets, as they are actually drawn.
//
//   npm run dev
//   node tools/shots/gadgets.mjs
//
// type.mjs asked whether this interface has a type SCALE or just has
// sizes. This asks the same question one level up, about the boxes: the
// tach, the clock, the minimap, the fuel gauge, the street plate, the
// cards, the buttons, the badges. A set of gadgets reads as a set when
// they are cut from the same stock — one corner radius, one border, one
// ground, one shadow — and reads as a pile of widgets when each one was
// styled where it was written.
//
// globals.css already HAS that stock: .grn-panel, .grn-plate, .grn-info,
// .grn-dialog, .grn-meter, .grn-btn. So the question is not "what should
// the system be", it is "how much of the interface is outside it".
//
// WHAT IS REPORTED
//
//   treatments  every distinct combination of corner radius, border,
//               ground, shadow and blur, with a count. Ones used once
//               are listed: a treatment with a single user is not a
//               decision, it is a thing somebody typed.
//   strays      boxes that carry none of the component classes. These
//               are the ones that drift, because nothing links them to
//               the others.
//   radii       the corner radii in play, in pixels. A family has two or
//               three; a pile has as many as it has boxes.
//
// A "gadget" is an element that paints a box — it has a border, a ground
// or a shadow — and is big enough to be furniture rather than a hairline
// (24 px on both sides). Text runs are type.mjs's job, not this one's.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("No Chromium found. Set CHROME_PATH."); process.exit(2); }

const SYSTEM = ["grn-panel", "grn-plate", "grn-info", "grn-dialog", "grn-meter", "grn-btn"];

const COLLECT = `(() => {
  const vis = (e) => e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const SYSTEM = ${JSON.stringify(SYSTEM)};
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) continue;
    const cs = getComputedStyle(el);
    const bw = ["Top","Right","Bottom","Left"].map((s)=>parseFloat(cs["border"+s+"Width"])||0);
    const hasBorder = bw.some((v)=>v > 0);
    const ground = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none";
    const shadow = cs.boxShadow !== "none";
    if (!hasBorder && !ground && !shadow) continue;
    // A full-bleed backdrop is scenery, not a gadget.
    if (r.width >= innerWidth - 2 && r.height >= innerHeight - 2) continue;
    const radii = ["TopLeft","TopRight","BottomRight","BottomLeft"]
      .map((c)=>cs["border"+c+"Radius"]);
    const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || "");
    const own = cls.split(/\\s+/).filter(Boolean);
    out.push({
      tag: el.tagName.toLowerCase(),
      system: SYSTEM.filter((s)=>own.includes(s)),
      radius: radii.join(" "),
      border: hasBorder ? bw.join("/") + " " + cs.borderTopColor : "none",
      ground: cs.backgroundImage !== "none" ? "image" : cs.backgroundColor,
      shadow: shadow ? cs.boxShadow.slice(0, 60) : "none",
      blur: cs.backdropFilter === "none" ? "" : cs.backdropFilter,
      w: Math.round(r.width), h: Math.round(r.height),
      label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\\s+/g," ").slice(0, 28),
      cls: own.filter((c)=>!/^(flex|grid|absolute|relative|inset|top-|left-|right-|bottom-|z-|w-|h-|min-|max-|p[xytblr]?-|m[xytblr]?-|gap-|overflow|pointer|select|items-|justify-|text-|font-|leading-|tracking-)/.test(c)).slice(0,4).join(" "),
    });
  }
  return out;
})()`;

const SIZES = [
  { name: "phone portrait", w: 390, h: 844 },
  { name: "desktop", w: 1600, h: 900 },
];
const screens = [
  { name: "menu", go: async () => {} },
  { name: "garage", go: async (page) => { await page.click("text=GARAGE"); await page.waitForTimeout(900); } },
  {
    name: "race HUD",
    go: async (page) => {
      await page.click("text=START ENGINE");
      await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.__grnEngine?.skipCinematic?.());
      await page.waitForFunction(
        () => [...document.querySelectorAll("span,div")].some(
          (e) => e.textContent === "km/h" && e.checkVisibility({ opacityProperty: true, visibilityProperty: true })),
        null, { timeout: 60000 });
      await page.waitForTimeout(600);
    },
  },
];

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const all = [];
for (const size of SIZES) {
  for (const sc of screens) {
    const page = await browser.newPage({ viewport: { width: size.w, height: size.h } });
    page.setDefaultTimeout(240000);
    page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
    await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("gulf-road-nights-onboarded", "2");
      localStorage.setItem("gulf-road-nights-coach", "3");
    });
    await page.reload({ waitUntil: "networkidle" });
    await sc.go(page);
    const rows = await page.evaluate(COLLECT);
    for (const r of rows) all.push({ ...r, screen: sc.name, size: size.name });
    await page.close();
  }
}
await browser.close();

const key = (r) => [r.radius, r.border, r.ground, r.shadow, r.blur].join(" | ");
const byTreat = new Map();
for (const r of all) {
  const k = key(r);
  if (!byTreat.has(k)) byTreat.set(k, []);
  byTreat.get(k).push(r);
}
const treats = [...byTreat.entries()].sort((a, b) => b[1].length - a[1].length);

console.log(`\n${all.length} gadgets across ${SIZES.length * screens.length} screen/size combinations`);
console.log(`\nTREATMENTS — every distinct box, most used first`);
for (const [k, rows] of treats) {
  const sys = [...new Set(rows.flatMap((r) => r.system))].join(",") || "—";
  console.log(`  x${String(rows.length).padStart(3)}  ${sys.padEnd(12)} ${k.slice(0, 96)}`);
}
const onceOff = treats.filter(([, rows]) => rows.length === 1);
console.log(`\n  ${treats.length} distinct treatments; ${onceOff.length} used exactly once`);

const strays = all.filter((r) => !r.system.length);
const strayKinds = new Map();
for (const r of strays) {
  const k = `${r.cls || r.tag} ${r.radius}`;
  if (!strayKinds.has(k)) strayKinds.set(k, r);
}
console.log(`\nSTRAYS — boxes wearing none of the component classes: ${strays.length} of ${all.length}`);
for (const [, r] of [...strayKinds].slice(0, 24))
  console.log(`  ${String(r.w).padStart(4)}x${String(r.h).padEnd(4)} ${r.screen.padEnd(9)} r=${r.radius.padEnd(22)} ${(r.cls || r.tag).slice(0, 34).padEnd(34)} "${r.label.slice(0, 20)}"`);

const radii = new Map();
for (const r of all) for (const v of r.radius.split(" ")) radii.set(v, (radii.get(v) || 0) + 1);
console.log(`\nRADII — corner radii in play`);
console.log("  " + [...radii].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} x${n}`).join("   "));

mkdirSync("press/type", { recursive: true });
writeFileSync("press/type/gadgets.json", JSON.stringify({ all }, null, 1));
console.log("\npress/type/gadgets.json");
