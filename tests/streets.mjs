// The street network — walked, not assumed.
//
// "Connected" is a claim about geometry, and the only honest way to test
// it is to try to walk it. So this fires rays straight down at closely
// spaced points along every street in the city and asks what each one
// lands on. A sample that hits nothing is a hole in the pavement; a run
// of them is a street that does not reach what it is supposed to join.
//
// Checking the layout arithmetic instead would prove only that the
// builder agrees with itself, which it always will.
//
//   npm run dev            # in another shell
//   npm run test:streets
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium");
  process.exit(2);
}
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const r = await page.evaluate(async () => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  const track = e.track;
  const L = track.length;
  const scene = e.scene;
  const streets = scene.getObjectByName("streets");
  const road = scene.getObjectByName("road");
  if (!streets || !road) return { missing: !streets ? "streets" : "road" };

  const S = window.__grnStreets;
  const COAST = window.__grnCoastU;
  const HALF = window.__grnRoadHalf;
  const outer = S.avenues[S.avenues.length - 1];

  const ray = new THREE.Raycaster();
  ray.far = 60;
  const down = new THREE.Vector3(0, -1, 0);
  const from = new THREE.Vector3();
  const p = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const targets = [streets, road];
  // Is there pavement under (s, lat)?
  const paved = (s, lat) => {
    track.pose(s, lat, p, tmp);
    from.set(p.x, 20, p.z);
    ray.set(from, down);
    return ray.intersectObjects(targets, false).length > 0;
  };

  const crossCount = Math.round(L / S.crossEvery);
  const out = { crossCount, avenues: S.avenues.length, gaps: [], junctions: 0, junctionGaps: [] };

  // 1. Walk out along a sample of cross streets, from the highway's own
  //    edge to past the last avenue. Every step must be on pavement, or
  //    the street does not actually reach the blocks it serves.
  const sampleCross = 8;
  let crossSamples = 0, crossPaved = 0;
  for (let k = 0; k < sampleCross; k++) {
    const idx = Math.floor((k / sampleCross) * crossCount);
    const s = (idx / crossCount) * L;
    // Strictly inside the far kerb. The last step used to land exactly on
    // `outer + half`, which is the quad's outer edge — a ray fired at a
    // polygon boundary hits or misses on floating-point luck, and it
    // reported one phantom hole out of eight. The claim being tested is
    // that the street runs from the highway out past the last avenue,
    // and stopping a metre short of the kerb still tests exactly that.
    for (let lat = track.halfWidthAt(s); lat < outer + S.half - 1; lat += 2) {
      crossSamples++;
      if (paved(s, lat)) crossPaved++;
      else if (out.gaps.length < 6) out.gaps.push(`cross ${idx} at lat ${lat.toFixed(0)}`);
    }
  }
  out.crossSamples = crossSamples;
  out.crossPaved = crossPaved;

  // 2. Walk each inland avenue all the way round the lap. A break here
  //    is an avenue that stops partway and starts again.
  let aveSamples = 0, avePaved = 0;
  for (const d of S.avenues) {
    for (let s = 0; s < L; s += 24) {
      aveSamples++;
      if (paved(s, d)) avePaved++;
      else if (out.gaps.length < 12) out.gaps.push(`avenue ${d} at s ${s.toFixed(0)}`);
    }
  }
  out.aveSamples = aveSamples;
  out.avePaved = avePaved;

  // 3. The junctions themselves: every cross street must meet every
  //    avenue it passes. This is the actual claim — a grid whose lines
  //    cross without touching is a set of streets, not a network.
  for (let idx = 0; idx < crossCount; idx++) {
    const s = (idx / crossCount) * L;
    for (const d of S.avenues) {
      out.junctions++;
      if (!paved(s, d) && out.junctionGaps.length < 6) {
        out.junctionGaps.push(`cross ${idx} x avenue ${d}`);
      }
    }
  }

  // 4. The seaward side must NOT be paved out over the water on the
  //    coastal leg — a grid that connects everything to everything
  //    includes connecting the city to the Gulf.
  let inSea = 0;
  for (let k = 0; k < 20; k++) {
    const s = (COAST.from + ((k + 0.5) / 20) * (COAST.to - COAST.from)) * L;
    if (paved(s, -(outer + S.half))) inSea++;
  }
  out.inSea = inSea;

  // 5. Buildings must stand in the blocks, not in the streets.
  // By name. Searching for "an instanced box mesh with a lot of
  // instances" found some other mesh entirely and reported its instances
  // as buildings standing in the road.
  const blocks = scene.getObjectByName("cityBlocks");
  out.blockCount = blocks ? blocks.count : 0;
  let onStreet = 0;
  if (blocks) {
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (let i = 0; i < blocks.count; i++) {
      blocks.getMatrixAt(i, m);
      pos.setFromMatrixPosition(m);
      from.set(pos.x, 20, pos.z);
      ray.set(from, down);
      if (ray.intersectObjects(targets, false).length > 0) onStreet++;
    }
  }
  out.onStreet = onStreet;
  return out;
});

if (r.missing) {
  console.error(`the "${r.missing}" mesh is not in the scene`);
  await browser.close();
  process.exit(1);
}

console.log(`grid        ${r.crossCount} cross streets x ${r.avenues} avenues`);
console.log(`cross runs  ${r.crossPaved}/${r.crossSamples} samples on pavement, highway edge to the last avenue  ` +
  check(r.crossPaved === r.crossSamples,
    `${r.crossSamples - r.crossPaved} gaps walking out along a cross street (${r.gaps.slice(0, 3).join("; ")})`));
console.log(`avenue runs ${r.avePaved}/${r.aveSamples} samples on pavement, right around the lap  ` +
  check(r.avePaved === r.aveSamples,
    `${r.aveSamples - r.avePaved} gaps walking an avenue (${r.gaps.slice(0, 3).join("; ")})`));
console.log(`junctions   ${r.junctions - r.junctionGaps.length}/${r.junctions} crossings meet  ` +
  check(r.junctionGaps.length === 0,
    `${r.junctionGaps.length} crossings where the streets pass without touching (${r.junctionGaps.slice(0, 3).join("; ")})`));
console.log(`the Gulf    ${r.inSea}/20 seaward samples paved on the coastal leg  ` +
  check(r.inSea === 0, `the grid paves ${r.inSea} samples out over the water`));
console.log(`buildings   ${r.blockCount} placed, ${r.onStreet} standing in a street  ` +
  check(r.blockCount > 150, `only ${r.blockCount} buildings placed — the city emptied out`) + " " +
  check(r.onStreet === 0, `${r.onStreet} buildings are standing in the middle of a street`));

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nthe street network is connected");
await browser.close();
process.exit(fail.length ? 1 : 0);
