// Crop a region out of a PNG and magnify it, for looking at one gadget
// closely.
//
//   npm run shots -- night
//   node tools/shots/crop.mjs press/shots/night.png out.png 0 620 380 280 2
//
// A 1600x900 reference still is the right size for judging a scene and
// the wrong size for judging a 116-pixel map panel: at that scale a
// caption sitting on top of the route it is captioning looks like
// antialiasing. Nearest-neighbour, so a magnified edge is the edge and
// not a guess about it.
import { chromium } from "playwright-core";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const [inp, outp, X, Y, W, H, S = "2"] = process.argv.slice(2);
const C=[process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium","/usr/bin/google-chrome"].filter(Boolean);
const b = await chromium.launch({executablePath:C.find(p=>existsSync(p)),args:["--no-sandbox","--disable-dev-shm-usage"],headless:true});
const page = await b.newPage();
const data = "data:image/png;base64," + readFileSync(inp).toString("base64");
const url = await page.evaluate(async ({data,X,Y,W,H,S}) => {
  const img = new Image(); img.src = data; await img.decode();
  const c = document.createElement("canvas");
  c.width = W*S; c.height = H*S;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(img, X, Y, W, H, 0, 0, W*S, H*S);
  return c.toDataURL("image/png");
}, {data,X:+X,Y:+Y,W:+W,H:+H,S:+S});
writeFileSync(outp, Buffer.from(url.split(",")[1], "base64"));
console.log("saved", outp);
await b.close();
