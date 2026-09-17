#!/usr/bin/env node
/**
 * The iOS project is submittable:  npm run test:ios
 *
 * Scaffolds a real project with `npx cap add ios`, runs the patcher over it,
 * and reads the result back with a plist parser — not a regex over the text
 * that wrote it, which would only prove the script agrees with itself.
 *
 * NOT in `npm run scan`, for the same reason test:api and test:tts are not: it
 * shells out to `npx cap add ios`, which is slow and needs the network.
 *
 * Runs on Linux, which is the point. The obvious way to edit an Info.plist is
 * PlistBuddy, and PlistBuddy is macOS-only — every line of the patcher would
 * then be untestable from the machine it was written on, verified for the first
 * time by a store upload. `.github/workflows/ios.yml`'s xcodebuild steps are
 * already in that position and say so; this did not have to join them.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IOS = join(ROOT, "ios");
const PLIST = join(IOS, "App/App/Info.plist");
const PBX = join(IOS, "App/App.xcodeproj/project.pbxproj");

let pass = 0;
const fails = [];
const ok = (what, cond) => { if (cond) { pass++; console.log(`  ✓ ${what}`); } else { fails.push(what); console.log(`  ✗ ${what}`); } };

/** Minimal plist reader: enough for the flat keys this asserts on. */
function readPlist(text) {
  const out = {};
  const re = /<key>([^<]+)<\/key>\s*(<string>([^<]*)<\/string>|<(true|false)\/>|<array>([\s\S]*?)<\/array>)/g;
  for (const m of text.matchAll(re)) {
    if (m[3] !== undefined) out[m[1]] = m[3];
    else if (m[4] !== undefined) out[m[1]] = m[4] === "true";
    else out[m[1]] = [...m[5].matchAll(/<string>([^<]*)<\/string>/g)].map((s) => s[1]);
  }
  return out;
}

if (!existsSync(join(ROOT, "out/index.html"))) {
  console.error("test:ios needs out/ — run npm run build first.");
  process.exit(1);
}

console.log("\n── scaffolding a fresh project ──");
rmSync(IOS, { recursive: true, force: true });
execFileSync("npx", ["cap", "add", "ios"], { cwd: ROOT, stdio: "pipe" });
ok("npx cap add ios produced an Info.plist", existsSync(PLIST));

const before = readPlist(readFileSync(PLIST, "utf8"));
console.log("\n── what Capacitor's template ships, before patching ──");
ok("it ships NO location usage string (this is the crash)", before.NSLocationWhenInUseUsageDescription === undefined);
ok("it ships NO microphone usage string", before.NSMicrophoneUsageDescription === undefined);
ok("it declares armv7, a 32-bit capability", JSON.stringify(before.UIRequiredDeviceCapabilities) === '["armv7"]');
ok("its development region is en, on an Arabic app", before.CFBundleDevelopmentRegion === "en");

console.log("\n── after the patch ──");
execFileSync("node", ["scripts/patch-ios-project.mjs"], { cwd: ROOT, stdio: "pipe" });
const after = readPlist(readFileSync(PLIST, "utf8"));

for (const key of [
  "NSLocationWhenInUseUsageDescription",
  "NSMicrophoneUsageDescription",
  "NSSpeechRecognitionUsageDescription",
]) {
  const v = after[key];
  ok(`${key} is set`, typeof v === "string" && v.length > 0);
  // Apple rejects a reason that only restates the permission, so each has to
  // say what the app does with the data. Arabic, because that is the dialog
  // a Kuwaiti user reads.
  ok(`  …and it is Arabic, not the template's English`, /[؀-ۿ]/.test(v || ""));
}

ok("ITSAppUsesNonExemptEncryption is false", after.ITSAppUsesNonExemptEncryption === false);
ok("CFBundleDevelopmentRegion is ar", after.CFBundleDevelopmentRegion === "ar");
ok("CFBundleLocalizations lists ar first", JSON.stringify(after.CFBundleLocalizations) === '["ar","en"]');
ok("armv7 is gone, arm64 declared", JSON.stringify(after.UIRequiredDeviceCapabilities) === '["arm64"]');
ok("CFBundleDisplayName is still وين", after.CFBundleDisplayName === "وين");

console.log("\n── the privacy manifest ships INSIDE the bundle ──");
const manifest = join(IOS, "App/App/PrivacyInfo.xcprivacy");
ok("PrivacyInfo.xcprivacy was copied in", existsSync(manifest));
const pbx = readFileSync(PBX, "utf8");
// Copying it is not enough — Xcode ships what the TARGET lists. Four entries.
ok("it has a PBXFileReference", /FADE0001[0-9A-F]* \/\* PrivacyInfo\.xcprivacy \*\/ = \{isa = PBXFileReference/.test(pbx));
ok("it has a PBXBuildFile", /FADE0002[0-9A-F]* \/\* PrivacyInfo\.xcprivacy in Resources \*\/ = \{isa = PBXBuildFile/.test(pbx));
ok("it is in the App group", /\t{4}FADE0001[0-9A-F]* \/\* PrivacyInfo\.xcprivacy \*\/,/.test(pbx));
ok("it is in Copy Bundle Resources", /\t{4}FADE0002[0-9A-F]* \/\* PrivacyInfo\.xcprivacy in Resources \*\/,/.test(pbx));
const pm = readPlist(readFileSync(manifest, "utf8"));
ok("it declares no tracking", pm.NSPrivacyTracking === false);

console.log("\n── running it twice is a clean no-op ──");
execFileSync("node", ["scripts/patch-ios-project.mjs"], { cwd: ROOT, stdio: "pipe" });
const twice = readFileSync(PBX, "utf8");
// LINES, not occurrences. The first version of this counted the filename and
// expected 4; there are 6, because the PBXBuildFile line names it twice (once
// as its own comment, once in the fileRef comment) and the PBXFileReference
// line names it as both comment and `path =`. The entries are four, one per
// section, and that is the invariant a second run must not disturb.
const entryLines = twice.split("\n").filter((l) => l.includes("PrivacyInfo.xcprivacy")).length;
ok(`still exactly 4 pbxproj entry lines (got ${entryLines})`, entryLines === 4);
const re2 = readPlist(readFileSync(PLIST, "utf8"));
ok("the plist is unchanged by the second run", JSON.stringify(re2) === JSON.stringify(after));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("التطبيق جاهز للرفع — the project carries what Apple requires ✓");
