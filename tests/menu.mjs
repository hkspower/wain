// The main menu is the first thing anyone sees, and it is the one
// screen where a broken build looks exactly like a working one: a
// black rectangle with buttons on it. This checks the menu is real —
// that it comes BEFORE the game, that the turntable behind it is
// actually drawing your own car, that the list navigates by keyboard,
// that every item opens what it says it does, and that starting the
// race tears the turntable down instead of leaving it spinning behind
// the road.
import { chromium } from "playwright-core";
import { existsSync, writeFileSync } from "node:fs";
const C=[process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium","/usr/bin/google-chrome"].filter(Boolean);
const exe = C.find(p=>existsSync(p));
if (!exe) { console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium"); process.exit(2); }
const b = await chromium.launch({executablePath:exe,args:["--use-gl=angle","--enable-webgl","--no-sandbox","--disable-dev-shm-usage"],headless:true});
// Headless Chromium forces prefers-reduced-motion, which is exactly how
// the turntable is told to draw one frame and stop. Override it, or
// this test can only ever prove the still-frame path works.
const page = await b.newPage({viewport:{width:1280,height:800},reducedMotion:"no-preference"});
page.setDefaultTimeout(120000);
const errors=[];
page.on("pageerror",(e)=>{errors.push(e.message);console.log("PAGEERROR:",e.message);});

const fail=[]; const check=(c,m)=>{if(!c)fail.push(m);return c?"ok":"FAIL";};

await page.goto("http://localhost:3000/race",{waitUntil:"networkidle"});
await page.evaluate(()=>{localStorage.clear();localStorage.setItem("gulf-road-nights-onboarded","2");localStorage.setItem("gulf-road-nights-coach","3");});
await page.reload({waitUntil:"networkidle"});

// --- 1. The menu is what you land on, before any game exists ---
await page.waitForSelector("nav[aria-label='Main menu']");
const landed = await page.evaluate(()=>({
  items: [...document.querySelectorAll("nav[aria-label='Main menu'] button")]
    .map(b=>b.querySelector(".menu-item-label")?.textContent?.trim()),
  engine: !!window.__grnEngine,
  attract: !!document.querySelector("canvas.attract-canvas"),
}));
console.log(`menu         ${landed.items.join(" / ")}`);
check(landed.items[0] === "START ENGINE", `first item is "${landed.items[0]}", not START ENGINE`);
check(landed.items.length === 5, `${landed.items.length} menu items, expected 5`);
check(!landed.engine, "the game engine was built before the player chose to start");
check(landed.attract, "no turntable canvas behind the menu");

// --- 2. The turntable is live: frames accumulate, the car is in shot,
// and it actually turns. The canvas cannot be read back for this —
// WebGL discards the drawing buffer on composite, so a scripted
// readPixels sees zeros however good the picture is — so the scene
// reports its own render stats instead.
await page.waitForFunction(()=>!!window.__grnAttract,null,{timeout:60000});
const turntable = await page.evaluate(async ()=>{
  const a = window.__grnAttract;
  const wait = (ms)=>new Promise(r=>setTimeout(r,ms));
  await wait(900);
  const s1 = { frames:a.frames, tris:a.triangles, ang:+a.angle.toFixed(4) };
  await wait(1200);
  return { s1, s2:{ frames:a.frames, tris:a.triangles, ang:+a.angle.toFixed(4) } };
});
// Frame THROUGHPUT is not asserted: this suite runs on a software
// rasteriser where a quarter-million triangles costs whole seconds a
// frame, so a fps threshold would measure the test box and not the
// menu. What has to be true is that it is animating at all.
console.log(`turntable    frames ${turntable.s1.frames}→${turntable.s2.frames} (${((turntable.s2.frames-turntable.s1.frames)/1.2).toFixed(1)} fps on software GL), ${turntable.s2.tris} triangles, angle ${turntable.s1.ang}→${turntable.s2.ang}`);
check(turntable.s2.frames > turntable.s1.frames,
  "the turntable stopped drawing — it is a frozen still, not a live scene");
check(turntable.s2.tris > 5000,
  `only ${turntable.s2.tris} triangles rendered — the car is missing from the shot`);
check(Math.abs(turntable.s2.ang - turntable.s1.ang) > 0.001, "the turntable does not turn");

// --- 3. Keyboard navigation moves the selection and wraps ---
const nav = await page.evaluate(async ()=>{
  const sel = () => [...document.querySelectorAll("nav[aria-label='Main menu'] button")]
    .findIndex(b=>b.getAttribute("aria-current")==="true");
  const press = (key) => { window.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true})); };
  const wait = ()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const out = { start: sel() };
  press("ArrowDown"); await wait(); out.down1 = sel();
  press("ArrowDown"); await wait(); out.down2 = sel();
  press("ArrowUp");   await wait(); out.up = sel();
  // Wrap backwards off the top
  press("ArrowUp"); await wait(); press("ArrowUp"); await wait(); out.wrapped = sel();
  return out;
});
console.log(`keyboard     selection ${nav.start} →↓ ${nav.down1} →↓ ${nav.down2} →↑ ${nav.up} → wraps to ${nav.wrapped}`);
check(nav.start === 0, "the menu does not open on its first item");
check(nav.down1 === 1 && nav.down2 === 2, "arrow keys do not move the menu selection");
check(nav.up === 1, "the menu will not go back up");
check(nav.wrapped === 4, `arrow-up off the top landed on ${nav.wrapped}, not the last item`);

// --- 4. Each item opens the screen it advertises. These overlays sit
// ON TOP of the menu rather than replacing it, so "the menu nav is
// gone" proves nothing — look for the overlay's own content.
const overlayText = () => page.evaluate(()=>document.body.innerText);

await page.click("nav[aria-label='Main menu'] >> text=GARAGE");
await page.waitForTimeout(500);
const garageTxt = await overlayText();
const garageOpen = /SUPERCARS|SPORT CARS|NORMAL CARS/i.test(garageTxt);
console.log(`garage       showroom on screen ${check(garageOpen, "the GARAGE item did not open the garage")}`);
// Back out however this overlay closes
for (const sel of ["text=CLOSE", "text=BACK", "text=DONE"]) {
  const el = await page.$(sel);
  if (el) { await el.click(); break; }
}
await page.waitForTimeout(500);

await page.click("nav[aria-label='Main menu'] >> text=CREDITS");
await page.waitForTimeout(500);
const credits = await page.evaluate(()=>({
  // The Arabic heading, which appears nowhere else — the Latin one is
  // uppercased by .grn-label and collides with the menu item behind it.
  heading: document.body.innerText.includes("شكر وتقدير"),
  hasThree: document.body.innerText.includes("three.js"),
  hasFonts: document.body.innerText.includes("IBM Plex Sans Arabic"),
  hasPorts: document.body.innerText.includes("Unreal Engine 5"),
}));
console.log(`credits      heading=${credits.heading} engine=${credits.hasThree} fonts=${credits.hasFonts} ports=${credits.hasPorts}  ` +
  check(credits.heading && credits.hasThree && credits.hasFonts && credits.hasPorts,
    "the CREDITS item did not open a populated credits screen"));
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
const creditsClosed = await page.evaluate(()=>!document.body.innerText.includes("three.js"));
check(creditsClosed, "Escape does not close the credits");

// --- 5. Starting the race leaves the menu and disposes the turntable ---
const shot = process.env.GRN_STILLS === "1"
  ? await page.screenshot()
  : null;
if (shot) { writeFileSync("/tmp/smoke/menu.png", shot); console.log("saved /tmp/smoke/menu.png"); }

await page.click("text=START ENGINE");
await page.waitForFunction(()=>!!window.__grnDebug,null,{timeout:120000});
const after = await page.evaluate(()=>({
  menu: !!document.querySelector("nav[aria-label='Main menu']"),
  attract: !!document.querySelector("canvas.attract-canvas"),
  engine: !!window.__grnEngine,
}));
console.log(`start        menu gone=${!after.menu} turntable disposed=${!after.attract} engine live=${after.engine}  ` +
  check(!after.menu && !after.attract && after.engine, "starting the race did not hand the screen over cleanly"));

check(errors.length === 0, `page errors: ${errors.join(" | ")}`);
console.log(fail.length?"\nFAILURES:\n - "+fail.join("\n - "):"\nthe menu opens the game");
await b.close();
process.exit(fail.length?1:0);
