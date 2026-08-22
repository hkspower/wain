// A close-up of one wheel, lit hard from the side so the tire's SECTION
// shows: bead, sidewall bulge, shoulder radius, crowned tread.
//
//   npm run dev
//   node tools/shots/tyre.mjs
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
const exe = [process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium"].filter(Boolean).find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: exe,
  args: ["--use-gl=angle","--enable-webgl","--no-sandbox","--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
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
const b64 = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const W = 450, H = 500;
  const out = document.createElement("canvas");
  out.width = W * 2; out.height = H + 26;
  const octx = out.getContext("2d");
  octx.fillStyle = "#0b0e13"; octx.fillRect(0,0,out.width,out.height);
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffffff, 3.0); key.position.set(4,3,5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xaaccff, 1.6); rim.position.set(-5,2,-3); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x8899bb, 0x111111, 0.9));
  const r = new THREE.WebGLRenderer({ antialias:true });
  r.setSize(W,H); r.outputColorSpace = THREE.SRGBColorSpace; r.setClearColor(0x11141b);
  const g = window.__grnBuildCar({ body: 0x9c1c2c, style:"sedan", kit:"street", lengthM: 4.7 });
  scene.add(g);
  const wheel = g.userData.wheels[1];
  const c = new THREE.Vector3(); wheel.getWorldPosition(c);
  const views = [
    { name: "three-quarter", pos: [c.x + 1.05, c.y + 0.34, c.z + 0.95] },
    { name: "edge on — the section", pos: [c.x + 1.35, c.y + 0.05, c.z + 0.06] },
  ];
  const cam = new THREE.PerspectiveCamera(24, W/H, 0.05, 60);
  views.forEach((v, i) => {
    cam.position.set(...v.pos); cam.lookAt(c.x, c.y, c.z);
    cam.updateProjectionMatrix();
    r.render(scene, cam);
    octx.drawImage(r.domElement, i*W, 26);
    octx.fillStyle="#e8ecf2"; octx.font="600 15px system-ui"; octx.textBaseline="middle";
    octx.fillText(v.name, i*W + 12, 14);
  });
  return out.toDataURL("image/png").split(",")[1];
});
mkdirSync("press/shop", { recursive: true });
writeFileSync("press/shop/tyre.png", Buffer.from(b64,"base64"));
console.log("press/shop/tyre.png");
await browser.close();
