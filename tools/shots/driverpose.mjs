// What the driver actually looks like in the seat.
//
//   npm run dev
//   node tools/shots/driverpose.mjs [outfile]
//
// The glasshouse is hidden for the shot. A cabin photographed through
// its own glass is a picture of a reflection — which is why an inverted
// elbow pole survived in this game long enough to reach every car on the
// road: nothing that rendered the driver could see him.
import { chromium } from "playwright-core";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2] || "/tmp/smoke/driver-pose.png";
const C=[process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium","/usr/bin/google-chrome"].filter(Boolean);
const exe = C.find(p=>existsSync(p));
if (!exe) { console.error("No Chromium found. Set CHROME_PATH."); process.exit(2); }
const b = await chromium.launch({executablePath:exe,args:["--use-gl=angle","--enable-webgl","--no-sandbox","--disable-dev-shm-usage"],headless:true});
const page = await b.newPage({viewport:{width:1280,height:720}});
page.setDefaultTimeout(120000);
page.on("pageerror",(e)=>console.log("PAGEERROR:",e.message));
await page.goto("http://localhost:3000/race",{waitUntil:"networkidle"});
await page.evaluate(()=>{localStorage.clear();localStorage.setItem("gulf-road-nights-onboarded","2");localStorage.setItem("gulf-road-nights-coach","3");});
await page.reload({waitUntil:"networkidle"});
await page.click("text=START ENGINE");
await page.waitForFunction(()=>!!window.__grnDebug,null,{timeout:120000});

const shot = await page.evaluate((cut)=>{
  window.__grnPoseCutaway = cut;
  const e = window.__grnEngine;
  e.timeHours = 12.5; e.world.setTimeOfDay(12.5); e.applyDaylight();
  e.setPaused(true);
  e.setTouchInput({ steer: 0.35 });
  for (let i=0;i<60;i++) e.update(1/60);
  const car = e.carBody;
  const hidden = [];
  car.traverse((o)=>{
    const shell = o.userData.shell;
    if (o.isMesh && (shell === "canopy" || shell === "roof" || (window.__grnPoseCutaway && shell === "body")) && o.visible) { o.visible = false; hidden.push(o); }
  });
  const rig = car.userData.driver;
  car.updateWorldMatrix(true,true);
  const V = e.camera.position.constructor;
  const p = new V().setFromMatrixPosition(rig.group.matrixWorld);
  const cam = e.camera;
  const off = (window.__grnPoseCam || [1.15, 0.85, 1.0]);
  cam.position.set(p.x + off[0], p.y + off[1], p.z + off[2]);
  cam.lookAt(p.x, p.y + 0.42, p.z);
  cam.fov = 40; cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  e.composer.render();
  const url = e.renderer.domElement.toDataURL("image/png");
  for (const o of hidden) o.visible = true;
  return url;
}, process.env.CUT === "1");
mkdirSync(out.replace(/\/[^/]+$/, ""), { recursive: true });
writeFileSync(out, Buffer.from(shot.split(",")[1], "base64"));
console.log("saved", out);
await b.close();
