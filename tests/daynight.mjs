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

// The clock must actually run in cycle mode
const ran = await page.evaluate(async ()=>{
  const e = window.__grnEngine;
  e.setSky("cycle");
  const t0 = e.timeHours;
  e.setPaused(true);
  for (let i=0;i<60*40;i++) e.update(1/60); // 40 s of play
  return { t0: +t0.toFixed(2), t1: +e.timeHours.toFixed(2), cycling: e.timeCycling };
});
const advanced = ((ran.t1 - ran.t0) + 24) % 24;
console.log(`\ncycle: ${ran.t0}h -> ${ran.t1}h after 40 s of play (${advanced.toFixed(2)} h)  ` +
  check(ran.cycling, "cycle mode did not engage") + " " +
  check(advanced > 0.5 && advanced < 3, `clock advanced ${advanced.toFixed(2)} h in 40 s — off the 16-minute day`));

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
console.log(fail.length?"\nFAILURES:\n - "+fail.join("\n - "):"\nthe day actually turns");
await b.close();
process.exit(fail.length?1:0);
