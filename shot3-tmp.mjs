import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
const C=[process.env.CHROME_PATH,process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,"/usr/bin/chromium"].filter(Boolean);
const exe=C.find(p=>existsSync(p));
const b=await chromium.launch({executablePath:exe,args:["--use-gl=angle","--enable-webgl","--no-sandbox","--disable-dev-shm-usage"]});
const page=await b.newPage({viewport:{width:1000,height:620}});
page.setDefaultTimeout(200000);
page.on("pageerror",e=>console.log("PAGEERROR:",e.message));
await page.goto("http://localhost:3000/race",{waitUntil:"networkidle"});
await page.evaluate(()=>{localStorage.clear();localStorage.setItem("gulf-road-nights-onboarded","2");localStorage.setItem("gulf-road-nights-coach","3");});
await page.reload({waitUntil:"networkidle"});
await page.click("text=START ENGINE");
await page.waitForFunction(()=>!!window.__grnDebug,null,{timeout:200000});
await page.waitForTimeout(2500);
const shots=[
  {name:"shop", eye:[4,5.2,-15], at:[-9,2.2,0], fov:55},
  {name:"parking", eye:[8,7.5,-13], at:[-6,1.2,0], fov:62},
  {name:"front", eye:[-2.5,2.0,0], at:[-9.2,1.9,0], fov:70},
];
const info=await page.evaluate(async(shots)=>{
  const THREE=window.__grnThree, e=window.__grnEngine;
  e.setPaused(true); e.applyQualityTier("high");
  let st=null; e.scene.traverse(o=>{ if(o.name==="fuel-station"&&!st) st=o; });
  if(!st) return {noStation:true};
  st.updateMatrixWorld(true);
  const away=e.track.wrap(3900+e.track.length/2);
  for(let i=0;i<120;i++){ e.player.s=3860; e.player.lat=10; e.player.speed=4;
    for(const t of e.traffic) t.s=away; if(e.rival) e.rival.s=away; e.update(1/60); }
  window.__shot=(s)=>{
    const cam=e.camera;
    const eye=st.localToWorld(new THREE.Vector3(...s.eye));
    const at=st.localToWorld(new THREE.Vector3(...s.at));
    cam.position.copy(eye); cam.lookAt(at); cam.fov=s.fov; cam.updateProjectionMatrix();
    e.exposurePass.dt=1/30;
    for(let i=0;i<70;i++){ e.composer.render(); e.exposurePass.dt=1/30; }
  };
  return {ok:true};
},shots);
console.log(JSON.stringify(info));
mkdirSync("press/station",{recursive:true});
for(const s of shots){
  await page.evaluate((s)=>window.__shot(s), s);
  await page.screenshot({path:`press/station/${s.name}.png`});
}
await b.close();
