import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
const exe = [process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium"].filter(Boolean).find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: exe,
  args: ["--use-gl=angle","--enable-webgl","--no-sandbox","--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => { localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded","2");
  localStorage.setItem("gulf-road-nights-coach","3"); });
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnBuildCar, null, { timeout: 240000 });
await page.waitForTimeout(3500);
const b64 = await page.evaluate(async () => {
  const THREE = window.__grnThree, e = window.__grnEngine;
  const modes = ["stock","smoked","single"];
  const W = 460, H = 360;
  const out = document.createElement("canvas");
  out.width = W * 3; out.height = H + 30;
  const octx = out.getContext("2d");
  octx.fillStyle = "#0b0e13"; octx.fillRect(0,0,out.width,out.height);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(32, W/H, 0.1, 100);
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3,5,6); scene.add(key);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.7); fill.position.set(-4,2,3); scene.add(fill);
  scene.add(new THREE.HemisphereLight(0x8899bb, 0x222222, 0.7));
  const r = new THREE.WebGLRenderer({ antialias:true, alpha:false });
  r.setSize(W,H); r.outputColorSpace = THREE.SRGBColorSpace;
  r.setClearColor(0x11141b);
  for (let i=0;i<modes.length;i++){
    const g = window.__grnBuildCar({ body: 0x8c1c2c, style:"sedan", kit:"street",
      lengthM: 4.7, headlamps: modes[i] });
    scene.add(g);
    const box = new THREE.Box3().setFromObject(g);
    const c = box.getCenter(new THREE.Vector3());
    cam.position.set(c.x + 1.1, c.y + 0.75, c.z + 4.2);
    cam.lookAt(c.x, c.y + 0.12, c.z + 2.2);
    r.render(scene, cam);
    octx.drawImage(r.domElement, i*W, 30);
    scene.remove(g);
    octx.fillStyle="#e8ecf2"; octx.font="600 17px system-ui"; octx.textBaseline="middle";
    octx.fillText(modes[i], i*W + 14, 16);
  }
  return out.toDataURL("image/png").split(",")[1];
});
mkdirSync("press/shop", { recursive: true });
writeFileSync("press/shop/headlamps.png", Buffer.from(b64,"base64"));
console.log("press/shop/headlamps.png");
await browser.close();
