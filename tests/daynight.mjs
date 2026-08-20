// The cycle has to change the world, not just a variable. Every hour
// sampled here is checked against the sky, the key light, the stars and
// the streetlights — and the clock must actually advance in cycle mode.
import { chromium } from "playwright-core";
import { existsSync, writeFileSync } from "node:fs";
const C=[process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium","/usr/bin/google-chrome"].filter(Boolean);
const exe = C.find(p=>existsSync(p));
if (!exe) { console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium"); process.exit(2); }
const b = await chromium.launch({executablePath:exe,args:["--use-gl=angle","--enable-webgl","--no-sandbox","--disable-dev-shm-usage"],headless:true});
const page = await b.newPage({viewport:{width:1280,height:720}});
page.setDefaultTimeout(120000);
page.on("pageerror",(e)=>console.log("PAGEERROR:",e.message));
await page.goto("http://localhost:3000/race",{waitUntil:"networkidle"});
await page.evaluate(()=>{localStorage.clear();localStorage.setItem("gulf-road-nights-onboarded","2");localStorage.setItem("gulf-road-nights-coach","3");});
await page.reload({waitUntil:"networkidle"});
await page.click("text=START ENGINE");
await page.waitForFunction(()=>!!window.__grnDebug,null,{timeout:120000});

const fail=[]; const check=(c,m)=>{if(!c)fail.push(m);return c?"ok":"FAIL";};

const sample = (h) => page.evaluate((h)=>{
  const e = window.__grnEngine;
  e.setPaused(true);
  e.timeHours = h;
  e.world.setTimeOfDay(h);
  e.applyDaylight();
  e.update(1/60);
  let root=e.world.moonLight; while(root.parent) root=root.parent;
  let stars=null, lampPool=null;
  root.traverse((o)=>{
    if(o.isPoints && o.material?.sizeAttenuation === false && !stars) stars=o.material;
    if(o.isInstancedMesh && o.material?.blending === 2 && o.material.map && !lampPool) lampPool=o.material;
  });
  const sky = root.children.find((c)=>c.material?.uniforms?.uTop)?.material?.uniforms;
  const key = e.world.moonLight;
  return {
    h,
    top: sky ? [+sky.uTop.value.r.toFixed(3), +sky.uTop.value.g.toFixed(3), +sky.uTop.value.b.toFixed(3)] : null,
    keyY: +key.position.y.toFixed(0),
    keyInt: +key.intensity.toFixed(2),
    fog: +e.scene?.fog?.density?.toFixed?.(5) ?? null,
    stars: stars ? +stars.opacity.toFixed(3) : null,
    lampPool: lampPool ? +lampPool.opacity.toFixed(3) : null,
    beam: +e.beamBaseOpacity.toFixed(4),
    headlight: +e.headlight.intensity.toFixed(1),
  };
}, h);

console.log("hour   sky-top(rgb)          key   stars  lamps  beam    headlight");
const rows = [];
for (const h of [0, 5.6, 8, 12.5, 18.2, 20, 22.5]) {
  const r = await sample(h);
  rows.push(r);
  console.log(`${String(h).padStart(5)}  ${JSON.stringify(r.top).padEnd(22)} ${String(r.keyInt).padStart(5)} ${String(r.stars).padStart(6)} ${String(r.lampPool).padStart(6)} ${String(r.beam).padStart(7)} ${String(r.headlight).padStart(8)}`);
}
const night = rows.find(r=>r.h===22.5), noon = rows.find(r=>r.h===12.5), dawn = rows.find(r=>r.h===5.6);
check(noon.top[2] > night.top[2] + 0.3, "the sky does not brighten by day");
check(noon.keyInt > night.keyInt * 1.8, "the sun is no stronger than the moon");
check(night.stars > 0.8 && noon.stars < 0.05, "stars do not fade with the sunrise");
check(night.lampPool > 0.3 && noon.lampPool < 0.05, "streetlights do not switch off in daylight");
check(noon.beam < night.beam * 0.5, "headlight beams still hang in broad daylight");
check(dawn.top[0] > night.top[0], "dawn does not warm the sky");

// The clock must actually run — at two rates, on purpose.
//
// Racing runs midnight to 05:50, and those five hours and fifty minutes
// are given a whole session: about forty minutes of play. Once the
// window shuts the clock reverts to the old sixteen-minute day so the
// sun comes up at a watchable speed for anyone who stays out in it. One
// rate for both would mean either a night that is over in four minutes
// or a sunrise that takes an hour to arrive.
const ran = await page.evaluate(async ()=>{
  const e = window.__grnEngine;
  e.setSky("cycle");
  e.setPaused(true);
  const run = (from) => {
    e.timeHours = from;
    const t0 = e.timeHours;
    for (let i=0;i<60*40;i++) e.update(1/60); // 40 s of play
    return ((e.timeHours - t0) + 24) % 24;
  };
  const night = run(2);
  const day = run(9);
  return { night: +night.toFixed(3), day: +day.toFixed(3), cycling: e.timeCycling };
});
console.log(`\ncycle: 40 s of play moves the clock ${ran.night.toFixed(2)} h inside the ` +
  `racing window and ${ran.day.toFixed(2)} h outside it  ` +
  check(ran.cycling, "cycle mode did not engage") + " " +
  check(ran.night > 0.03 && ran.night < 0.3,
    `the clock advanced ${ran.night.toFixed(2)} h in 40 s at night — off the 40-minute racing window`) + " " +
  check(ran.day > 0.5 && ran.day < 3,
    `the clock advanced ${ran.day.toFixed(2)} h in 40 s after dawn — off the 16-minute day`));

// Stills across the day
const WRITE_STILLS = process.env.GRN_STILLS === "1";
const shots = WRITE_STILLS ? await page.evaluate(async ()=>{
  const e = window.__grnEngine; const out={};
  e.timeCycling = false;
  for (const [name,h] of [["night",22.5],["dawn",5.6],["noon",12.5],["dusk",18.2]]) {
    e.timeHours=h; e.world.setTimeOfDay(h); e.applyDaylight();
    e.player.s=e.track.length*0.30; e.player.lat=0; e.player.speed=30;
    for(let i=0;i<20;i++) e.update(1/60);
    e.composer.render();
    out[name]=e.renderer.domElement.toDataURL("image/png");
  }
  return out;
}) : {};
for(const [k,v] of Object.entries(shots)) writeFileSync(`/tmp/smoke/tod-${k}.png`, Buffer.from(v.split(",")[1],"base64"));
if (WRITE_STILLS) console.log("stills:", Object.keys(shots).join(", "));
// ---- key and fill ---------------------------------------------------
// A three-point rig is a claim about ratios, not about whether lights
// exist. The key must dominate at every hour, the fill must sit well
// under it and be cooler, and the fill must cast nothing: a fill that
// throws shadows gives the scene a second sun.
const rig = await page.evaluate(() => {
  const e = window.__grnEngine;
  const out = [];
  for (const h of [0, 6.5, 12.5, 18.5, 22]) {
    e.timeHours = h; e.world.setTimeOfDay(h); e.applyDaylight();
    const k = e.world.moonLight, f = e.world.fillLight;
    const warmth = (c) => c.r - c.b; // >0 warm, <0 cool
    out.push({
      h,
      key: +k.intensity.toFixed(3),
      fill: +f.intensity.toFixed(3),
      ratio: +(k.intensity / Math.max(1e-6, f.intensity)).toFixed(2),
      keyWarm: +warmth(k.color).toFixed(3),
      fillWarm: +warmth(f.color).toFixed(3),
      fillShadow: f.castShadow,
      // Opposition is a horizontal property: both lights come from
      // above (a fill under the horizon would uplight the scene like a
      // campfire), so it is the ground-plane bearing that must oppose.
      opposedXZ: (k.position.x * f.position.x + k.position.z * f.position.z) /
        Math.max(1e-6, Math.hypot(k.position.x, k.position.z) * Math.hypot(f.position.x, f.position.z)),
      lower: f.position.y < k.position.y,
    });
  }
  return out;
});
console.log("\nkey / fill:");
for (const r of rig) {
  console.log(`  ${String(r.h).padStart(4)}h  key ${String(r.key).padEnd(6)} fill ${String(r.fill).padEnd(6)} ` +
    `ratio ${String(r.ratio).padEnd(5)} warmth key ${r.keyWarm} vs fill ${r.fillWarm}`);
  check(r.key > r.fill, `at ${r.h}h the fill (${r.fill}) is not weaker than the key (${r.key})`);
  check(r.ratio >= 2.5 && r.ratio <= 5,
    `at ${r.h}h the key:fill ratio is ${r.ratio} — outside the 2.5:1..5:1 a key-and-fill rig means`);
  check(r.fillWarm < r.keyWarm, `at ${r.h}h the fill is not cooler than the key`);
  check(!r.fillShadow, "the fill casts shadows — that is a second key, not a fill");
  check(r.opposedXZ < -0.5,
    `at ${r.h}h the fill is not opposite the key across the ground plane (bearing dot ${r.opposedXZ.toFixed(2)})`);
  check(r.lower, `at ${r.h}h the fill is higher than the key`);
}

console.log(fail.length?"\nFAILURES:\n - "+fail.join("\n - "):"\nthe day actually turns");
await b.close();
process.exit(fail.length?1:0);
