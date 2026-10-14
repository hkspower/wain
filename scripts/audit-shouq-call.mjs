#!/usr/bin/env node
/**
 * The one URL a call to شوق cannot survive being wrong about.
 *
 * `WAIN_AI_WIDGET_SRC` is fetched at the moment somebody taps «كلّم شوق», by a
 * <script> tag whose only failure signal is `onerror`. Nothing in this
 * repository builds against it, imports it, or renders it, so a URL that
 * resolves to nothing is invisible to every other check here — and one was.
 *
 * It said `unpkg.com/@elevenlabs/convai-widget-embed@1`. That is a semver
 * RANGE, and the package has never published a 1.x. A range with no match
 * cannot resolve, so every call in agent mode ended at `agentFailed` and told
 * the visitor «ما قدرنا نوصلك بشوق — جرّب مرة ثانية», which reads as a bad
 * connection. Months of that.
 *
 * The widget is self-hosted now — an exact devDependency that
 * scripts/vendor-widget.mjs copies into public/vendor/ — so the URL is a path
 * on this origin and the version lives in two places at once: package.json and
 * the directory name. This asserts what keeps that survivable:
 *
 *   1. the src and the three worklet paths are same-origin and are exactly the
 *      paths the vendoring script writes — a drift there is a 404 mid-call;
 *   2. package.json pins the package EXACTLY, never a range — the bug that
 *      happened, in its new home;
 *   3. the version in the path is the version installed, and the files are
 *      really there once vendored.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { VENDOR_FILES } from "./vendor-widget-paths.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let errors = 0;
let notes = 0;
const fail = (m, d = "") => { errors++; console.log(`  ✗ ${m}${d ? `\n      ${d}` : ""}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const note = (m) => { notes++; console.log(`  · ${m}`); };

/* Read the constant by importing it, not by grepping for it — a regex over the
   source would keep passing if the export were renamed or moved. */
const tmp = mkdtempSync(join(tmpdir(), "wain-shouq-call-"));
let SRC, WORKLETS, AGENT_ENABLED;
/** Is شوق on, for a given value of the build-time variable? */
let enabledWhen = () => null;
try {
  const entry = join(tmp, "e.mjs");
  const bundle = join(tmp, "b.mjs");
  writeFileSync(
    entry,
    "export { WAIN_AI_WIDGET_SRC, WAIN_AI_WORKLET_PATHS, WAIN_AI_AGENT_ENABLED } from " +
      `${JSON.stringify(join(ROOT, "src/lib/wain-ai.ts"))};\n`
  );
  execFileSync(join(ROOT, "node_modules/.bin/esbuild"), [
    entry, "--bundle", "--format=esm", `--alias:@=${join(ROOT, "src")}`,
    `--outfile=${bundle}`, "--log-level=error",
  ], { cwd: ROOT, stdio: "pipe" });
  const mod = await import(pathToFileURL(bundle).href);
  SRC = mod.WAIN_AI_WIDGET_SRC;
  WORKLETS = mod.WAIN_AI_WORKLET_PATHS;
  AGENT_ENABLED = mod.WAIN_AI_AGENT_ENABLED;

  /**
   * Ask the same module what it would decide under a given variable.
   *
   * A child process because `process.env` is read at module load and Node
   * caches modules; esbuild leaves the read intact in a node bundle, so the
   * only honest way to vary it is to load it again somewhere else.
   */
  enabledWhen = (value) =>
    execFileSync(process.execPath, [
      "-e",
      `import(${JSON.stringify(pathToFileURL(bundle).href)})` +
        `.then((m) => console.log(m.WAIN_AI_AGENT_ENABLED ? "on" : "off"))`,
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: value === undefined
        ? { ...process.env, NEXT_PUBLIC_ELEVENLABS_AGENT_ID: undefined }
        : { ...process.env, NEXT_PUBLIC_ELEVENLABS_AGENT_ID: value },
    }).trim();
} finally {
  // Deliberately NOT removed here — enabledWhen() re-imports the bundle below.
}

console.log("\n── the widget URL a call depends on ──");
console.log(`  ${SRC}`);

// Same-origin, root-relative. An absolute URL here is a CDN back on the
// critical path of a call and a third-party host back in script-src.
if (!SRC.startsWith("/") || SRC.startsWith("//")) {
  fail("the src must be a root-relative path on this origin", SRC);
} else ok("served from this origin");

if (SRC !== `/${VENDOR_FILES.widget}`) {
  fail("the src is not where scripts/vendor-widget.mjs writes the bundle",
       `${SRC} vs /${VENDOR_FILES.widget}`);
} else ok("and is exactly where the vendoring step writes it");

const WANT_WORKLETS = {
  "worklet-path-raw-audio-processor": VENDOR_FILES.rawAudioProcessor,
  "worklet-path-audio-concat-processor": VENDOR_FILES.audioConcatProcessor,
  "worklet-path-libsamplerate": VENDOR_FILES.libsamplerate,
};
for (const [attr, file] of Object.entries(WANT_WORKLETS)) {
  if (WORKLETS?.[attr] !== `/${file}`) {
    fail(`${attr} does not point at the vendored worklet`,
         `${WORKLETS?.[attr]} vs /${file} — without it the widget falls back to a ` +
         "blob: URL that script-src refuses, and the call has no audio");
  } else ok(`${attr} → /${file}`);
}

console.log("\n── the version behind it ──");
const pkgJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
for (const [name, file] of [
  ["@elevenlabs/convai-widget-embed", VENDOR_FILES.widget],
  ["@alexanderolsen/libsamplerate-js", VENDOR_FILES.libsamplerate],
]) {
  const declared = pkgJson.dependencies?.[name] ?? pkgJson.devDependencies?.[name];
  // THE CHECK. A range is what shipped, and a range is what could not resolve.
  if (!declared) {
    fail(`${name} is not in package.json — the vendoring step has nothing to copy`);
    continue;
  }
  if (!EXACT.test(declared)) {
    fail(`${name} is declared as «${declared}», a range or a tag, not an exact version`,
         "The directory name promises one version and .htaccess caches it for a\n" +
         "      year as immutable. Pin x.y.z.");
    continue;
  }
  ok(`${name} pinned exactly at ${declared}`);
  if (!file.split("/")[1].endsWith(`-${declared}`)) {
    fail(`the vendored path does not carry ${declared}`, file);
  } else ok(`and the path carries the same version (${file.split("/")[1]})`);
  const installed = join(ROOT, "node_modules", name, "package.json");
  if (existsSync(installed)) {
    const v = JSON.parse(readFileSync(installed, "utf8")).version;
    if (v !== declared) fail(`node_modules has ${name}@${v}, not ${declared} — run npm ci`);
    else ok(`installed ${name}@${v}`);
  } else note(`${name} is not installed — run npm ci; the installed version was NOT checked`);
}

const missing = Object.values(VENDOR_FILES).filter((f) => !existsSync(join(ROOT, "public", f)));
if (missing.length === Object.keys(VENDOR_FILES).length) {
  note("public/vendor/ is not generated yet — npm run build writes it; the files were NOT checked");
} else if (missing.length) {
  fail("public/vendor/ is partly missing", missing.join(", "));
} else ok("all four vendored files are in public/vendor/");

/**
 * ── and whether a build actually carries her ──────────────────────────────
 *
 * The URL above only matters if agent mode is on, and it was off in exactly
 * the place that matters and nowhere anyone would look. `${{ vars.X }}` in
 * GitHub Actions expands to "" when the variable has never been set, and
 * `process.env.X ?? DEFAULT` does not fall back on "" — so every CI build
 * shipped the browser-speech fallback while deploy.yml's own log printed
 * «شوق: agent mode (built-in default)».
 *
 * Three values, because each is a different real situation: a hand build here
 * (unset), a CI build with the variable never set (empty), and the owner
 * deliberately turning her off (none). Nothing else in the repository can tell
 * them apart.
 */
console.log("\n── does a build carry شوق ──");
{
  const cases = [
    [undefined, "on", "unset — a build from a laptop or a sandbox"],
    ["", "on", "empty — an unset GitHub variable reaches the build as \"\""],
    ["none", "off", "«none» — the deliberate off switch"],
  ];
  for (const [value, want, why] of cases) {
    const got = enabledWhen(value);
    if (got !== want) {
      fail(`${why}: expected ${want}, got ${got}`,
           want === "on"
             ? "This is the bug that shipped: the built-in default is unreachable,\n" +
               "      so CI builds شوق out while the run log says she is in."
             : "The off switch has stopped working — there is now no way to take\n" +
               "      her off the live site without a commit.");
    } else ok(`${why} → ${got}`);
  }
}
rmSync(tmp, { recursive: true, force: true });

// A URL nobody fetches is not a bug, so say which case this is.
if (!AGENT_ENABLED) note("agent mode is switched off in this build — the URL is unused until it is on");

console.log(`\n${errors} errors, ${notes} notes`);
process.exit(errors ? 1 : 0);
