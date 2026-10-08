// The patrol cars, as the game builds them: the saloon and the SUV, from
// the front quarter, the side, the far side and the tail.
//
//   npm run dev
//   npm run shots:police             # -> press/police/
//
// Built by the game's own createCar (window.__grnBuildCar) with the
// traffic's own options — `simple`, the silver, the police livery, the
// card length — so what comes out is the car a player is overtaken by,
// furniture and all: the wrap, the bar, the push bar, the pillar
// spotlight, the aerial, the roof number, the bonnet word and the
// chevrons. Authored parts (the LED bar) are given time to land.
//
// A small studio rather than the race: a dark floor, a soft key, a cool
// fill and a warm rim, and an environment made of the same three so the
// silver has something to reflect. It is a reference plate for the
// patrol car's shape and dressing, not a frame of the game — the ik
// stills are those.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, statSync } from "node:fs";

const OUT = process.env.OUT ?? "press/police";
const W = 1600, H = 1120;
mkdirSync(OUT, { recursive: true });

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p) && statSync(p).isFile());
if (!exe) { console.error("No Chromium found. Set CHROME_PATH."); process.exit(2); }

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.setDefaultTimeout(600000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug && !!window.__grnBuildCar, null, { timeout: 600000 });
// The game is only needed for its builder: stop its frame loop.
await page.evaluate(() => { window.__grnEngine.skipCinematic?.(); window.__grnEngine.setPaused(true); });

// The two patrol cars, as engine.ts spawns them.
const CARS = [
  { id: "patrol-saloon", style: "sedan", lengthM: 4.7 },
  { id: "patrol-suv", style: "suv", lengthM: 4.85 },
];
// Camera stations around the car: azimuth from the nose (degrees, the
// car's left flank at 90), elevation, and distance as a multiple of the
// car's length.
const SHOTS = {
  quarter: { az: 38, el: 11, k: 1.15 },
  side: { az: 90, el: 5, k: 1.05 },
  farside: { az: 218, el: 10, k: 1.15 },
  tail: { az: 162, el: 9, k: 1.15 },
};

await page.evaluate(([cars, shots, W, H]) => {
  const THREE = window.__grnThree;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  canvas.id = "police-studio";
  Object.assign(canvas.style, { position: "fixed", left: "0", top: "0", zIndex: "99999" });
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e15);
  // The environment: three panels and a dark room, through PMREM, so
  // the silver and the lenses reflect a studio and not nothing.
  const room = new THREE.Scene();
  const panel = (w, h, pos, look, c, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c }));
    m.material.color.multiplyScalar(i);
    m.position.set(...pos); m.lookAt(...look); room.add(m);
  };
  room.add(new THREE.Mesh(new THREE.BoxGeometry(30, 12, 30), new THREE.MeshBasicMaterial({ color: 0x0a0c12, side: THREE.BackSide })));
  panel(10, 3, [0, 5.5, 0], [0, 0, 0], 0xfff3dc, 3.0);     // the strip overhead
  panel(6, 4, [-8, 3, 4], [0, 1, 0], 0xcfe0ff, 1.4);      // cool fill, left
  panel(4, 3, [7, 2.5, -6], [0, 1, 0], 0xffb070, 2.2);    // warm rim, right rear
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(room, 0.02).texture;
  // The lights that cast.
  const key = new THREE.DirectionalLight(0xfff1dc, 2.6);
  key.position.set(-4, 7, 5); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -4; key.shadow.camera.right = key.shadow.camera.top = 4;
  key.shadow.camera.near = 1; key.shadow.camera.far = 20; key.shadow.bias = -0.0005;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.7); fill.position.set(6, 3, 6); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffb070, 1.6); rim.position.set(5, 3, -7); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x3a4a66, 0x05060a, 0.35));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ color: 0x14171e, roughness: 0.55, metalness: 0.1 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 100);
  window.__policeStudio = { THREE, renderer, scene, camera, cars, shots, current: null };
}, [CARS, SHOTS, W, H]);

for (const car of CARS) {
  const info = await page.evaluate(async (car) => {
    const S = window.__policeStudio;
    const THREE = S.THREE;
    if (S.current) { S.scene.remove(S.current); S.current = null; }
    const g = window.__grnBuildCar({
      body: window.__grnPolice.POLICE.silver, livery: "police", style: car.style, simple: true, lengthM: car.lengthM,
    });
    g.traverse((o) => { if (o.isMesh && !o.userData.noShadow) { o.castShadow = true; o.receiveShadow = true; } });
    S.scene.add(g);
    S.current = g;
    // The authored bar, the shells and the wheels arrive over the network.
    await new Promise((r) => setTimeout(r, 4000));
    g.updateMatrixWorld(true);
    const box = new THREE.Box3();
    g.traverse((o) => { if (o.isMesh && !o.userData.noShadow && o.visible) box.expandByObject(o); });
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    S.box = { size: [size.x, size.y, size.z], centre: [centre.x, centre.y, centre.z] };
    // Count the furniture, so the plate says what it shows.
    const furniture = {};
    // Tagged with a string; the car's own userData.police is the engine's
    // handle on the bar, not a piece.
    g.traverse((o) => { if (typeof o.userData?.police === "string") furniture[o.userData.police] = (furniture[o.userData.police] ?? 0) + 1; });
    const onCall = g.userData.police;
    if (onCall) { onCall.left.emissiveIntensity = window.__grnPolice.POLICE.lampOn; onCall.right.emissiveIntensity = window.__grnPolice.POLICE.lampOff; }
    return { size: S.box.size.map((v) => +v.toFixed(2)), furniture };
  }, car);
  console.log(`${car.id}  ${info.size.join(" x ")} m  ${Object.entries(info.furniture).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  for (const [name, shot] of Object.entries(SHOTS)) {
    await page.evaluate(([shot]) => {
      const S = window.__policeStudio;
      const [sx, sy, sz] = S.box.size, [cx, cy, cz] = S.box.centre;
      const L = Math.max(sx, sz);
      const dist = L * shot.k * 1.9;
      const az = (shot.az * Math.PI) / 180, el = (shot.el * Math.PI) / 180;
      // Azimuth from the nose (+z), toward the car's left (+x) at 90.
      S.camera.position.set(cx + Math.sin(az) * Math.cos(el) * dist, cy + Math.sin(el) * dist + 0.1, cz + Math.cos(az) * Math.cos(el) * dist);
      S.camera.lookAt(cx, cy - sy * 0.05, cz);
      S.renderer.render(S.scene, S.camera);
    }, [shot]);
    const path = `${OUT}/${car.id}-${name}.png`;
    const el = await page.$("#police-studio");
    await el.screenshot({ path });
    console.log(`  wrote ${path}`);
  }
}
await browser.close();
