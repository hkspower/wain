#!/usr/bin/env node
/**
 * The app can still be submitted:  npm run audit:ios
 *
 * Static — no Xcode, no network, no generated project — so it can live in
 * `npm run scan` and run on every change. `npm run test:ios` does the end-to-end
 * proof against a real `npx cap add ios`; this one guards the inputs that proof
 * depends on.
 *
 * THE CHECK WORTH HAVING IS THE LAST ONE. The others confirm files exist. The
 * last walks `src/` for privacy-sensitive browser APIs and requires a matching
 * usage string, because the failure this whole area has is not «we forgot a
 * file» — it is «someone added a feature and nobody thought about the plist».
 * iOS terminates a process that touches one of these with no declared reason,
 * so the day a camera or a contacts picker lands in the admin screens, this
 * fails in CI rather than in a reviewer's hands.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PATCHER = join(ROOT, "scripts/patch-ios-project.mjs");
const MANIFEST = join(ROOT, "ios-config/PrivacyInfo.xcprivacy");
const ICON = join(ROOT, "public/brand/app-icon-1024.png");
const WORKFLOW = join(ROOT, ".github/workflows/ios.yml");
const CONFIG = join(ROOT, "capacitor.config.ts");

let problems = 0;
const bad = (m) => { console.log(`  ✗ ${m}`); problems++; };
const good = (m) => console.log(`  ✓ ${m}`);

/* ── 1. the pieces exist ─────────────────────────────────────────────────── */

console.log("\n── the things Apple refuses an upload without ──");

if (!existsSync(MANIFEST)) bad("ios-config/PrivacyInfo.xcprivacy is missing (required since May 2024)");
else {
  const m = readFileSync(MANIFEST, "utf8");
  if (!m.includes("NSPrivacyTracking")) bad("the privacy manifest declares no NSPrivacyTracking");
  else good("privacy manifest present and declares tracking");
}

if (!existsSync(ICON)) {
  bad("public/brand/app-icon-1024.png is missing — run `npm run icon:app`");
} else {
  // PNG header: width and height are big-endian 32-bit at bytes 16 and 20,
  // colour type is byte 25. Read rather than trusted: the filename is not
  // evidence of the size, which is the point audit:assets already makes.
  const b = readFileSync(ICON);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), colourType = b[25];
  if (w !== 1024 || h !== 1024) bad(`the app icon is ${w}×${h}, not 1024×1024`);
  else if (colourType === 4 || colourType === 6) bad("the app icon has an alpha channel — refused at upload");
  else good(`app icon is ${w}×${h}, colour type ${colourType}, no alpha`);
}

/* ── 2. CI actually runs the patcher ─────────────────────────────────────── */

console.log("\n── the workflow uses them ──");
const wf = existsSync(WORKFLOW) ? readFileSync(WORKFLOW, "utf8") : "";
// `run:`-anchored, not a bare mention. Counting occurrences of the command
// found three "jobs" on a two-job workflow, because the header comment
// explains what `npx cap add ios` does. An audit that cannot tell a step from
// a sentence about a step reports a defect that is not there — and the next
// person silences it rather than reading it.
const runStep = (cmd) => (wf.match(new RegExp(`^\\s*run:\\s*${cmd}\\s*$`, "gm")) || []).length;
const patchCalls = runStep("npm run ios:patch");
const addCalls = runStep("npx cap add ios");
if (patchCalls !== addCalls) {
  bad(`${addCalls} job(s) scaffold a project but only ${patchCalls} patch it — an unpatched job ships a crashing build`);
} else if (addCalls === 0) bad("no job scaffolds an iOS project");
else good(`all ${addCalls} job(s) that scaffold also run ios:patch`);

if (!wf.includes("app-icon-1024.png")) bad("the workflow still feeds Capacitor an icon other than the 1024");
else good("the workflow feeds Capacitor the 1024 icon");

/* ── 3. the bundle id is still a placeholder ─────────────────────────────── */

const cfg = readFileSync(CONFIG, "utf8");
const appId = cfg.match(/appId:\s*"([^"]+)"/)?.[1];
if (appId === "com.wainkw.app") {
  console.log(
    `\n  ! appId is still ${appId}. Not an error — it is a perfectly good id — but App\n` +
    "    Store Connect fixes the bundle id to whatever the FIRST TestFlight build\n" +
    "    declares, and it cannot be changed afterwards. Decide it before that upload.",
  );
}

/* ── 4. every privacy API the site calls has a reason string ─────────────── */

console.log("\n── every privacy-sensitive API has a usage string ──");

/** Browser API → the Info.plist key iOS kills the process without. */
const NEEDS = [
  { api: /navigator\.geolocation/, key: "NSLocationWhenInUseUsageDescription", what: "geolocation" },
  { api: /getUserMedia|SpeechRecognition/, key: "NSMicrophoneUsageDescription", what: "microphone capture" },
  { api: /SpeechRecognition/, key: "NSSpeechRecognitionUsageDescription", what: "speech recognition" },
  { api: /video\s*:\s*true|facingMode/, key: "NSCameraUsageDescription", what: "the camera" },
  { api: /navigator\.contacts/, key: "NSContactsUsageDescription", what: "contacts" },
  { api: /navigator\.bluetooth/, key: "NSBluetoothAlwaysUsageDescription", what: "bluetooth" },
];

const sources = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if ([".ts", ".tsx"].includes(extname(p))) sources.push(readFileSync(p, "utf8"));
  }
})(join(ROOT, "src"));
const src = sources.join("\n");
const patcher = readFileSync(PATCHER, "utf8");

for (const { api, key, what } of NEEDS) {
  const used = api.test(src);
  const declared = patcher.includes(key);
  if (used && !declared) {
    bad(`src/ calls ${what} but patch-ios-project.mjs declares no ${key} — iOS kills the app on that call`);
  } else if (used) {
    good(`${what} → ${key}`);
  } else if (declared) {
    console.log(`  · ${key} is declared but nothing in src/ calls ${what} — harmless, but Apple asks why`);
  }
}

console.log(
  problems
    ? `\n${problems} error(s).`
    : "\n0 errors — nothing here would stop an upload.",
);
process.exit(problems ? 1 : 0);
