import { chromium } from "playwright-core";
const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const b = await chromium.launch({ executablePath: exe, args:["--use-gl=angle","--enable-webgl","--no-sandbox","--disable-dev-shm-usage"], headless:true });
const p = await b.newPage();
const models = [];
p.on("response", async (r) => {
  const u = r.url();
  if (/\/models\/.*\.glb/.test(u)) models.push(`${r.status()} ${u.replace(/^https?:\/\/[^/]+/,"")} cc=${(r.headers()["cache-control"]||"-")}`);
  if (/build\.json/.test(u)) models.push(`${r.status()} /models/build.json cc=${(r.headers()["cache-control"]||"-")}`);
});
const errs = [];
p.on("pageerror", e => errs.push(e.message));
await p.goto("http://localhost:3000/race", { waitUntil:"domcontentloaded", timeout:60000 });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem("gulf-road-nights-onboarded","2"); localStorage.setItem("gulf-road-nights-coach","3"); });
await p.reload({ waitUntil:"domcontentloaded" });
try { await p.click("text=START ENGINE", { timeout: 30000 }); } catch { console.log("no START ENGINE button"); }
try { await p.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 }); console.log("engine booted"); }
catch { console.log("engine did NOT boot in 240s"); }
await p.waitForTimeout(8000);
console.log("--- model requests ---");
for (const m of models) console.log("  " + m);
console.log(`versioned .glb requests: ${models.filter(m=>/\.glb\?v=/.test(m)).length}`);
if (errs.length) console.log("page errors:\n  " + errs.slice(0,4).join("\n  "));
await b.close();
