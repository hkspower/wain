// Car shells back from 3ds Max, gated, into the game.
//
//   npm run max:import -- path/to/car-gtr.fbx            # one style
//   npm run max:import -- path/to/folder                 # every car-*.fbx in it
//   npm run max:import -- --mirror path/to/car-gtr.fbx   # make it symmetric first
//   npm run max:import -- --dry-run path/to/car-gtr.fbx  # judge it, ship nothing
//   npm run max:import -- --style gtr path/to/body-v3.fbx
//
// For each file: tools/max/import_from_max.py turns the FBX into a game
// GLB, then it has to pass, in order,
//
//   1. fit     scripts/check-shell-fit.mjs, the game's own accept test. A
//              shell the game would drop is refused here, out loud. A slot
//              that was ALREADY rejected in the shipped file (the hatch
//              and super canopies, today) is a warning, not a refusal: the
//              edit did not make it worse, and the other slots still ship.
//   2. mirror  npm run check:shells (with --mirror, scripts/mirror-shells.mjs
//              first, which pairs the two halves' triangles).
//   3. glass   npm run test:glassfit: the glass still lands on the body.
//
// Only then is public/models/car-<style>.glb replaced and build.json told
// (tris, kb, "source": "3ds Max"), which also changes the cache key so
// browsers fetch the new file. Any failure puts every file back as it was.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const si = argv.indexOf("--style");
const forced = si >= 0 ? argv[si + 1] : null;
const inputs = argv.filter((a, i) => !a.startsWith("--") && !(si >= 0 && i === si + 1));
if (!inputs.length) {
  console.error("usage: npm run max:import -- [--mirror] [--dry-run] [--style s] <car-<style>.fbx | folder> ...");
  process.exit(2);
}
const fbx = inputs.flatMap((p) =>
  statSync(p).isDirectory() ? readdirSync(p).filter((f) => /^car-.+\.fbx$/i.test(f)).map((f) => join(p, f)) : [p]);
if (forced && fbx.length !== 1) { console.error("--style names one file's style; pass one file with it"); process.exit(2); }

const MODELS = "public/models";
const TS = ["--experimental-strip-types", "--no-warnings", "--import", "./tools/parity/ts-resolve.mjs"];
const work = mkdtempSync(join(tmpdir(), "max-import-"));

// Everything a failed import must put back: every car shell and the manifest.
const backup = join(work, "backup");
execFileSync("mkdir", ["-p", backup]);
const guarded = readdirSync(MODELS).filter((f) => /^car-.+\.glb$/.test(f) || f === "build.json");
for (const f of guarded) copyFileSync(join(MODELS, f), join(backup, f));
const restore = () => { for (const f of guarded) copyFileSync(join(backup, f), join(MODELS, f)); };

const fit = (file, style) => {
  const r = spawnSync("node", [...TS, "scripts/check-shell-fit.mjs", "--json", "--style", style, file], { encoding: "utf8" });
  try { return JSON.parse(r.stdout).files[0]; } catch { return { error: r.stderr || r.stdout }; }
};
const mm = (v) => (Number.isFinite(v) ? `${(v * 1000).toFixed(1)} mm` : "--");

const staged = [];
let refused = 0;
for (const src of fbx) {
  const style = forced ?? basename(src).match(/^car-(.+)\.fbx$/i)?.[1]?.toLowerCase();
  console.log(`\n== ${src}${style ? ` -> car-${style}.glb` : ""}`);
  if (!style) { console.log("   refused: name it car-<style>.fbx, or pass --style"); refused++; continue; }
  if (!existsSync(join(MODELS, `car-${style}.glb`))) { console.log(`   refused: ${style} is not a shipped body style`); refused++; continue; }
  const out = join(work, `car-${style}.glb`), rep = join(work, `car-${style}.json`);
  const py = spawnSync("python3", ["tools/max/import_from_max.py", "--in", src, "--out", out, "--report", rep], { encoding: "utf8" });
  for (const l of `${py.stdout}\n${py.stderr}`.split("\n")) if (l.startsWith("import:")) console.log(`   ${l}`);
  if (py.status !== 0) { console.log("   refused: the FBX could not be converted (above)"); refused++; continue; }

  const now = fit(out, style), was = fit(join(MODELS, `car-${style}.glb`), style);
  if (now.error) { console.log(`   refused: ${now.error}`); refused++; continue; }
  let bad = false;
  for (const slot of ["body", "canopy", "roof"]) {
    const a = now.slots[slot], b = was.slots?.[slot];
    if (!a) continue;
    const nums = a.box !== undefined ? `box ${mm(a.box)}, skin ${mm(a.skin)}, ${a.tris} tris` : a.reason;
    if (a.ok) console.log(`   fit ok      ${slot.padEnd(6)} ${nums}`);
    else if (b && !b.ok) console.log(`   fit WARN    ${slot.padEnd(6)} ${nums} — the game rejects it, as it already rejected the shipped one`);
    else { console.log(`   fit REFUSED ${slot.padEnd(6)} ${nums} — the game would drop it (${a.reason}); bring it within 10 mm of the Envelope`); bad = true; }
  }
  if (bad) { refused++; continue; }
  staged.push({ style, out, rep: JSON.parse(readFileSync(rep, "utf8")), src });
}

let ok = refused === 0 && staged.length > 0;
if (staged.length) {
  for (const s of staged) copyFileSync(s.out, join(MODELS, `car-${s.style}.glb`));
  const run = (label, cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: "utf8" });
    const tail = `${r.stdout}${r.stderr}`.trim().split("\n").slice(-6).map((l) => `     ${l}`).join("\n");
    console.log(`\n-- ${label}: ${r.status === 0 ? "pass" : "FAIL"}\n${tail}`);
    return r.status === 0;
  };
  if (flag("--mirror")) ok = run("mirror-shells", "node", ["scripts/mirror-shells.mjs"]) && ok;
  ok = run("check:shells (mirror symmetry)", "node", ["scripts/check-shell-mirror.mjs"]) && ok;
  ok = run("test:glassfit", "node", [...TS, "tests/glassfit.mjs"]) && ok;
}

if (!ok || flag("--dry-run")) {
  restore();
  console.log(flag("--dry-run") && ok
    ? "\ndry run: every gate passed; nothing was changed."
    : `\nnot imported: ${refused} file(s) refused${staged.length ? ", or a gate failed" : ""}. public/models is as it was.`);
} else {
  const bp = join(MODELS, "build.json");
  const build = JSON.parse(readFileSync(bp, "utf8"));
  for (const s of staged) {
    const kb = Math.round((statSync(join(MODELS, `car-${s.style}.glb`)).size / 1024) * 10) / 10;
    build.assets[`car-${s.style}`] = { tris: s.rep.tris, kb, parts: s.rep.parts, source: "3ds Max", from: basename(s.src) };
  }
  writeFileSync(bp, JSON.stringify(build, null, 2));
  console.log(`\nimported ${staged.map((s) => `car-${s.style}`).join(", ")} into ${MODELS}; build.json updated (new cache key).`);
  console.log("tools/blender/build_assets.py now leaves these alone unless run with --overwrite-max.");
}
rmSync(work, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
