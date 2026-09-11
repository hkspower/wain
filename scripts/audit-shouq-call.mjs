#!/usr/bin/env node
/**
 * The one URL a call to شوق cannot survive being wrong about.
 *
 * `WAIN_AI_WIDGET_SRC` is fetched at the moment somebody taps «كلّم شوق», from
 * a CDN, by a <script> tag whose only failure signal is `onerror`. Nothing in
 * this repository builds against it, imports it, or renders it, so a URL that
 * resolves to nothing is invisible to every other check here — and one was.
 *
 * It said `@elevenlabs/convai-widget-embed@1`. That is a semver RANGE, and the
 * package has never published a 1.x: 79 versions, 0.1.0 to 0.18.1. A range with
 * no match cannot resolve, so every call in agent mode ended at `agentFailed`
 * and told the visitor «ما قدرنا نوصلك بشوق — جرّب مرة ثانية», which reads as a
 * bad connection. Months of that.
 *
 * So this asserts the two properties that make the URL survivable, offline,
 * from the module itself:
 *
 *   1. an EXACT version, never a range — the bug that happened;
 *   2. a path down to the file, so neither of unpkg's two redirects (range →
 *      version, version → entry) is on the critical path of a call.
 *
 * Then, only if the registry answers, it checks that the exact version is
 * really published and that the path really is that version's entry. That part
 * needs the network and says so when it cannot run; the two checks above are
 * the ones that catch this class of bug and they never need it.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let errors = 0;
let notes = 0;
const fail = (m, d = "") => { errors++; console.log(`  ✗ ${m}${d ? `\n      ${d}` : ""}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const note = (m) => { notes++; console.log(`  · ${m}`); };

/* Read the constant by importing it, not by grepping for it — a regex over the
   source would keep passing if the export were renamed or moved. */
const tmp = mkdtempSync(join(tmpdir(), "wain-shouq-call-"));
let SRC, ORIGIN, AGENT_ENABLED;
/** Is شوق on, for a given value of the build-time variable? */
let enabledWhen = () => null;
try {
  const entry = join(tmp, "e.mjs");
  const bundle = join(tmp, "b.mjs");
  writeFileSync(
    entry,
    "export { WAIN_AI_WIDGET_SRC, WAIN_AI_WIDGET_ORIGIN, WAIN_AI_AGENT_ENABLED } from " +
      `${JSON.stringify(join(ROOT, "src/lib/wain-ai.ts"))};\n`
  );
  execFileSync(join(ROOT, "node_modules/.bin/esbuild"), [
    entry, "--bundle", "--format=esm", `--alias:@=${join(ROOT, "src")}`,
    `--outfile=${bundle}`, "--log-level=error",
  ], { cwd: ROOT, stdio: "pipe" });
  const mod = await import(pathToFileURL(bundle).href);
  SRC = mod.WAIN_AI_WIDGET_SRC;
  ORIGIN = mod.WAIN_AI_WIDGET_ORIGIN;
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

const url = new URL(SRC);
if (url.protocol !== "https:") fail("it must be https", url.protocol);
else ok("https");

if (ORIGIN !== url.origin) {
  fail("WAIN_AI_WIDGET_ORIGIN must be the origin of the src — it is what gets preconnected",
       `${ORIGIN} vs ${url.origin}`);
} else ok(`the preconnect origin matches it (${ORIGIN})`);

/* unpkg spells a package as /<name>@<version>/<path>, and the name may be
   scoped, so the version is the last @ before the path. */
const m = /^\/((?:@[^/@]+\/)?[^/@]+)@([^/]+)(\/.*)?$/.exec(url.pathname);
if (!m) {
  fail("the path does not name a package and a version", url.pathname);
} else {
  const [, pkg, version, path] = m;
  ok(`package ${pkg}`);

  // THE CHECK. A range is what shipped, and a range is what could not resolve.
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    fail(
      `version «${version}» is a range or a tag, not an exact version`,
      "A range resolves at request time, on a phone, with onerror as the only\n" +
      "      signal — and `@1` resolved to nothing at all for months. Pin x.y.z."
    );
  } else ok(`exact version ${version}`);

  if (!path || !path.endsWith(".js")) {
    fail(
      "the path does not name the entry file",
      "unpkg answers 302 to the package entry when the file is left off, which\n" +
      "      puts a redirect in front of 451KB at the moment a call is placed."
    );
  } else ok(`entry ${path} — no redirect on the way to it`);

  // Everything below wants the registry. It is a bonus, not the check.
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    let meta = null;
    try {
      meta = JSON.parse(
        execFileSync("npm", ["view", `${pkg}@${version}`, "--json"], {
          cwd: ROOT, stdio: ["ignore", "pipe", "ignore"], timeout: 60_000, encoding: "utf8",
        })
      );
    } catch {
      note("the registry could not be reached — the version itself was NOT verified here");
    }
    if (meta) {
      ok(`the registry has ${pkg}@${meta.version}`);
      const declared = meta.unpkg ?? meta.main;
      const want = declared ? `/${String(declared).replace(/^\.?\//, "")}` : null;
      if (want && path && want !== path) {
        fail(`the path is not this version's entry`, `declared ${want}, using ${path}`);
      } else if (want) ok(`and declares that file as its entry (${want})`);
    }
  }
}

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
