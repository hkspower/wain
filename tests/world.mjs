// The city is the same city every time.
//
//   npm run dev
//   node tests/world.mjs
//
// The world used to be built from Math.random(), so every page load was
// a different Kuwait. That is pleasant for a player and ruinous for
// anything that measures the game: over one session it produced four
// separate check failures that each looked exactly like a real bug, and
// it made before-and-after comparison impossible — a change to the
// facade texture could only be measured against a DIFFERENT city, with
// the buildings somewhere else and a different number of them in frame.
//
// So this asserts the property everything else now leans on: two loads,
// one city. It compares the building instance matrices rather than a
// screenshot, because that is exact — no auto-exposure settling, no
// timing, no tolerance to argue about.
//
// And against a RECORDED city, not only against itself. Two loads that
// agree prove the build is repeatable; they do not prove it is the same
// city as yesterday's. The shared stream (rand.ts) is consumed in build
// order, so one draw added or dropped anywhere moves everything placed
// after it — every building, billboard and lamp — and two loads of the
// moved city still agree perfectly. tests/baselines/world.json records
// each named instanced group's hash and the stream's total draw count;
// a change that is MEANT to move the city re-records it with
//
//   BASELINE=write node tests/world.mjs
//
// and says so in its commit. Groups listed in IGNORE are the ones a
// change in hand is deliberately rebuilding (pass IGNORE=planting,palm).
import { chromium } from "playwright-core";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
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
const page = await browser.newPage({ viewport: { width: 800, height: 460 } });
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

/** Load the game and fingerprint what the world generator produced. */
const build = async () => {
  await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("gulf-road-nights-onboarded", "2");
    localStorage.setItem("gulf-road-nights-coach", "3");
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.click("text=START ENGINE");
  await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  return page.evaluate(() => {
    const e = window.__grnEngine;
    const out = {};
    // Several meshes share a name ("planting" is one per shrub shape),
    // and keyed by name alone only the last of them was fingerprinted.
    const seen = {};
    e.scene.traverse((o) => {
      if (!o.isInstancedMesh || !o.name) return;
      // Round hard. Float noise from matrix composition is not a
      // difference in the world, and asserting on the last bit of a
      // float would make this fail for reasons nobody could act on.
      const a = o.instanceMatrix.array;
      const q = new Array(a.length);
      for (let i = 0; i < a.length; i++) q[i] = Math.round(a[i] * 1000) / 1000;
      const k = seen[o.name] ?? 0;
      seen[o.name] = k + 1;
      out[k ? `${o.name}#${k}` : o.name] = { count: o.count, m: q.join(",") };
    });
    out.__draws = { count: e.worldDraws, m: String(e.worldDraws) };
    return out;
  });
};

const digest = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);

const first = await build();
const second = await build();

const names = Object.keys(first).sort();
console.log(`instanced groups: ${names.length ? names.join(", ") : "(none named)"}`);
console.log(
  `blocks    ${check(
    names.includes("cityBlocks"),
    "no InstancedMesh named cityBlocks — the fingerprint would be measuring nothing"
  )}  ${first.cityBlocks ? first.cityBlocks.count : 0} city blocks placed`
);

let same = 0;
for (const n of names) {
  const a = first[n], b = second[n];
  const ok = b && a.count === b.count && a.m === b.m;
  if (ok) same++;
  else {
    check(
      false,
      `"${n}" came out different on the second load: ` +
        (b ? `${a.count} vs ${b.count} instances, hash ${digest(a.m)} vs ${digest(b.m)}` : "missing entirely")
    );
  }
}
console.log(
  `repeatable ${check(
    same === names.length && names.length > 0,
    `${names.length - same} of ${names.length} instanced groups differ between two loads`
  )} ${same}/${names.length} groups identical across two loads ` +
    `(cityBlocks ${first.cityBlocks ? digest(first.cityBlocks.m) : "-"})`
);

// --- Against the recorded city.
{
  const file = "tests/baselines/world.json";
  const flat = Object.fromEntries(names.map((n) => [n, { count: first[n].count, hash: digest(first[n].m) }]));
  if (process.env.BASELINE === "write") {
    mkdirSync("tests/baselines", { recursive: true });
    writeFileSync(file, JSON.stringify(flat, null, 1) + "\n");
    console.log(`baseline  written: ${names.length} groups, ${first.__draws.count} draws -> ${file}`);
  } else if (!existsSync(file)) {
    check(false, `no ${file}: record one on a known-good commit with BASELINE=write`);
  } else {
    const base = JSON.parse(readFileSync(file, "utf8"));
    const ignore = (process.env.IGNORE ?? "").split(",").filter(Boolean);
    const skip = (n) => ignore.some((p) => n === p || n.startsWith(p) || n.startsWith(`${p}#`));
    let held = 0, checked = 0;
    for (const n of Object.keys(base)) {
      if (skip(n)) continue;
      checked++;
      const now = flat[n];
      if (now && now.count === base[n].count && now.hash === base[n].hash) held++;
      else check(false, `"${n}" moved from the recorded city: ${now ? `${now.count} instances, hash ${now.hash}` : "missing"} (was ${base[n].count}, ${base[n].hash})`);
    }
    console.log(`recorded  ${check(held === checked, `${checked - held} group(s) moved`)} ${held}/${checked} groups and the stream length match ${file}` +
      (ignore.length ? ` (ignoring ${ignore.join(", ")})` : ""));
  }
}

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nsame seed, same Kuwait.");
