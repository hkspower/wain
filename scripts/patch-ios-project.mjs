#!/usr/bin/env node
/**
 * Make the generated iOS project submittable:  npm run ios:patch
 *
 * Runs in CI straight after `npx cap add ios`, because `ios/` is generated on
 * every run and gitignored. Everything it writes is either a hard crash or a
 * rejected upload if it is missing, so the list is short and none of it taste.
 *
 * PURE NODE, deliberately: the obvious way to edit Info.plist is PlistBuddy,
 * which exists only on macOS, and that would make every line of this
 * untestable from the machine it was written on. `npm run test:ios` runs the
 * whole thing against a real `npx cap add ios` project on Linux.
 *
 * ── 1. USAGE STRINGS — the one that CRASHES ───────────────────────────────
 *
 * iOS does not refuse a privacy-sensitive call politely. A process that
 * reaches `navigator.geolocation.getCurrentPosition` with no
 * NSLocationWhenInUseUsageDescription is TERMINATED by the system: the crash
 * log says the app "attempted to access privacy-sensitive data without a usage
 * description". Not a denied permission — a kill.
 *
 * wain reaches it from three places, one being «استخدم موقعي» on the home
 * page's dial, the most obvious control the app has. Capacitor's template
 * ships no usage strings, so every build before this one crashed on the first
 * tap of its headline feature — and nothing here would have reported it: the
 * Simulator job screenshots the launch screen and passes.
 *
 * ── 2. THE PRIVACY MANIFEST ───────────────────────────────────────────────
 *
 * Required since 1 May 2024, and rejected at UPLOAD rather than at review — so
 * it fails after archiving and signing have already succeeded. Copying the
 * file in is not enough: Xcode ships what the TARGET lists, so it also needs
 * four entries in project.pbxproj. `config.xml` is the model this mirrors.
 *
 * ── 3. armv7 ──────────────────────────────────────────────────────────────
 *
 * Capacitor's template declares `UIRequiredDeviceCapabilities = armv7`, which
 * is 32-bit ARM — no device Apple still sells can satisfy it, and the app is
 * built arm64. Whether the store refuses it outright is not something this
 * repository can test, so the claim here is narrower: it is simply wrong, it
 * describes a requirement the binary does not have, and arm64 is what it means.
 *
 * ── 4. EXPORT COMPLIANCE, ARABIC ──────────────────────────────────────────
 *
 * ITSAppUsesNonExemptEncryption=false — wain uses HTTPS and nothing else, the
 * standard exemption. Without the key App Store Connect gates every build
 * behind a manual questionnaire, which is how a one-command release stops
 * being one. CFBundleDevelopmentRegion comes out of the template as `en` on an
 * app that is entirely Arabic and `dir="rtl"`.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = process.env.IOS_APP_DIR || join(ROOT, "ios/App");
const PLIST = join(APP, "App/Info.plist");
const PBX = join(APP, "App.xcodeproj/project.pbxproj");
const MANIFEST_SRC = join(ROOT, "ios-config/PrivacyInfo.xcprivacy");
const MANIFEST_DST = join(APP, "App/PrivacyInfo.xcprivacy");

if (!existsSync(PLIST) || !existsSync(PBX)) {
  console.error(
    `patch-ios-project: no generated project at ${APP}.\n` +
    "Run `npx cap add ios` first — this patches a generated project, it does not create one.",
  );
  process.exit(1);
}

/**
 * Arabic, because that is what the dialog shows a Kuwaiti user, and each says
 * what the app DOES with the data — Apple rejects a reason that only restates
 * the permission ("we need your location").
 */
const STRINGS = {
  NSLocationWhenInUseUsageDescription:
    "عشان نرتب لك الأماكن من الأقرب لك. موقعك ما يطلع من جهازك.",
  NSMicrophoneUsageDescription:
    "عشان تتكلم مع شوق وتسألها وين تطلع.",
  NSSpeechRecognitionUsageDescription:
    "عشان نفهم سؤالك وانت تتكلم مع شوق.",
};

/* ── Info.plist ──────────────────────────────────────────────────────────── */

let plist = readFileSync(PLIST, "utf8");
const changes = [];

/** Replace a <key>/<string> pair if present, otherwise append before </dict>. */
function setString(key, value) {
  const re = new RegExp(`(<key>${key}</key>\\s*)<string>[^<]*</string>`);
  if (re.test(plist)) {
    const before = plist;
    plist = plist.replace(re, `$1<string>${value}</string>`);
    if (before !== plist) changes.push(`${key} (replaced)`);
  } else {
    plist = plist.replace(/(\n<\/dict>\n<\/plist>)/, `\n\t<key>${key}</key>\n\t<string>${value}</string>$1`);
    changes.push(`${key} (added)`);
  }
}
function setFalse(key) {
  const re = new RegExp(`<key>${key}</key>\\s*<(true|false)/>`);
  if (re.test(plist)) {
    const before = plist;
    plist = plist.replace(re, `<key>${key}</key>\n\t<false/>`);
    // Compared, not assumed: without this a re-run reports changes it did not
    // make, and "2 changes" on an already-patched project is a lie that makes
    // the log useless for telling a real second edit from a no-op.
    if (before !== plist) changes.push(`${key} (replaced)`);
  } else {
    plist = plist.replace(/(\n<\/dict>\n<\/plist>)/, `\n\t<key>${key}</key>\n\t<false/>$1`);
    changes.push(`${key} (added)`);
  }
}

for (const [key, value] of Object.entries(STRINGS)) setString(key, value);
setFalse("ITSAppUsesNonExemptEncryption");
setString("CFBundleDevelopmentRegion", "ar");

// armv7 is 32-bit; the binary is arm64. Narrow, exact replacement.
if (plist.includes("<string>armv7</string>")) {
  plist = plist.replace("<string>armv7</string>", "<string>arm64</string>");
  changes.push("UIRequiredDeviceCapabilities armv7 → arm64");
}

// CFBundleLocalizations is an array, so it is built rather than set.
if (!plist.includes("<key>CFBundleLocalizations</key>")) {
  plist = plist.replace(
    /(\n<\/dict>\n<\/plist>)/,
    "\n\t<key>CFBundleLocalizations</key>\n\t<array>\n\t\t<string>ar</string>\n\t\t<string>en</string>\n\t</array>$1",
  );
  changes.push("CFBundleLocalizations (added)");
}

writeFileSync(PLIST, plist);

/* ── the privacy manifest, into the TARGET and not just the folder ───────── */

copyFileSync(MANIFEST_SRC, MANIFEST_DST);

let pbx = readFileSync(PBX, "utf8");
const FILE_REF = "FADE0001FADE0001FADE0001";
const BUILD_FILE = "FADE0002FADE0002FADE0002";

if (pbx.includes("PrivacyInfo.xcprivacy")) {
  changes.push("PrivacyInfo.xcprivacy (already in the target)");
} else {
  // Four edits, mirroring how the template carries config.xml. Each anchors on
  // that file's own lines, so a Capacitor template change breaks this loudly
  // here rather than quietly at upload.
  const anchors = [
    [/(\t\t[0-9A-F]{24} \/\* config\.xml in Resources \*\/ = \{isa = PBXBuildFile[^\n]*\n)/,
      `\t\t${BUILD_FILE} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = ${FILE_REF} /* PrivacyInfo.xcprivacy */; };\n`,
      "PBXBuildFile"],
    [/(\t\t[0-9A-F]{24} \/\* config\.xml \*\/ = \{isa = PBXFileReference[^\n]*\n)/,
      `\t\t${FILE_REF} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };\n`,
      "PBXFileReference"],
    [/(\t\t\t\t[0-9A-F]{24} \/\* config\.xml \*\/,\n)/,
      `\t\t\t\t${FILE_REF} /* PrivacyInfo.xcprivacy */,\n`,
      "group children"],
    [/(\t\t\t\t[0-9A-F]{24} \/\* config\.xml in Resources \*\/,\n)/,
      `\t\t\t\t${BUILD_FILE} /* PrivacyInfo.xcprivacy in Resources */,\n`,
      "Copy Bundle Resources"],
  ];
  for (const [re, insert, what] of anchors) {
    if (!re.test(pbx)) {
      console.error(
        `patch-ios-project: could not find the ${what} anchor in project.pbxproj.\n` +
        "The Capacitor template changed shape. Refusing to guess: a half-edited pbxproj is a\n" +
        "failure nobody can read, and the upload would be rejected having looked fixed.",
      );
      process.exit(1);
    }
    pbx = pbx.replace(re, `$1${insert}`);
  }
  writeFileSync(PBX, pbx);
  changes.push("PrivacyInfo.xcprivacy (added to the App target)");
}

/* ── read it back, rather than trust the writes ──────────────────────────── */

const after = readFileSync(PLIST, "utf8");
const missing = [
  ...Object.keys(STRINGS),
  "ITSAppUsesNonExemptEncryption",
  "CFBundleLocalizations",
].filter((k) => !after.includes(`<key>${k}</key>`));
if (after.includes("<string>armv7</string>")) missing.push("armv7 is still declared");
if (!readFileSync(PBX, "utf8").includes("PrivacyInfo.xcprivacy in Resources")) {
  missing.push("PrivacyInfo.xcprivacy is not in Copy Bundle Resources");
}

if (missing.length) {
  console.error(`patch-ios-project: wrote, but the result is still wrong — ${missing.join("; ")}`);
  process.exit(1);
}

console.log(`patch-ios-project: ${changes.length} change(s) ✓`);
for (const c of changes) console.log(`  ${c}`);
