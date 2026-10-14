#!/usr/bin/env node
/**
 * The one file a call to شوق cannot survive being wrong about.
 *
 * `WAIN_AI_WIDGET_SRC` is fetched at the moment somebody taps «كلّم شوق», by a
 * <script> tag whose only failure signal is `onerror`, so a path that resolves
 * to nothing is invisible to every other check here — and one was.
 *
 * It was `unpkg.com/@elevenlabs/convai-widget-embed@1` for months. That is a
 * semver RANGE, and the package has never published a 1.x, so every call in
 * agent mode ended at `agentFailed` and told the visitor «ما قدرنا نوصلك بشوق —
 * جرّب مرة ثانية», which reads as a bad connection.
 *
 * Since 2 October the file is served from this origin (scripts/vendor-widget.mjs),
 * so what this asserts moved with it:
 *
 *   1. package.json pins the widget to an EXACT version — the same bug, one
 *      file over: a caret would let an install change the call silently;
 *   2. the path is on this origin, under _next/static/media/, named for that
 *      version and its content — so the immutable cache cannot serve stale bytes;
 *   3. the generated module is current for what node_modules holds;
 *   4. when out/ exists, the file is there and its bytes match the integrity
 *      the tag will demand — a mismatch would be refused by every browser.
 *
 * Then, only if the registry answers, that the version is really published.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
let SRC, INTEGRITY, ANY_AGENT;
/** What the build decides for given values of the two build-time variables. */
let enabledWhen = () => null;
/** Salem's agent, as published — pinned here so a changed id is a deliberate edit. */
const SALEM_AGENT = "agent_5101m4wwgr3ae5qat412ezcnffhn";
/** Shouq's agent, as published. */
const SHOUQ_AGENT = "agent_1701m1gcrccrethae9y3nyv1e116";
try {
  const entry = join(tmp, "e.mjs");
  const bundle = join(tmp, "b.mjs");
  writeFileSync(
    entry,
    "export { WAIN_AI_WIDGET_SRC, WAIN_AI_AGENT_ENABLED, SALEM_AGENT_ENABLED, WAIN_AI_ANY_AGENT_ENABLED, agentIdFor } from " +
      `${JSON.stringify(join(ROOT, "src/lib/wain-ai.ts"))};\n` +
      `export { WAIN_AI_WIDGET_INTEGRITY } from ${JSON.stringify(join(ROOT, "src/lib/widget-src.g.ts"))};\n`
  );
  execFileSync(join(ROOT, "node_modules/.bin/esbuild"), [
    entry, "--bundle", "--format=esm", `--alias:@=${join(ROOT, "src")}`,
    `--outfile=${bundle}`, "--log-level=error",
  ], { cwd: ROOT, stdio: "pipe" });
  const mod = await import(pathToFileURL(bundle).href);
  SRC = mod.WAIN_AI_WIDGET_SRC;
  INTEGRITY = mod.WAIN_AI_WIDGET_INTEGRITY;
  ANY_AGENT = mod.WAIN_AI_ANY_AGENT_ENABLED;

  /**
   * Ask the same module what it would decide under given variables.
   *
   * A child process because `process.env` is read at module load and Node
   * caches modules; esbuild leaves the read intact in a node bundle, so the
   * only honest way to vary it is to load it again somewhere else. Both agent
   * variables go in, and what comes back is what the page would do with each:
   * whether each persona is on, and which agent id each one would reach.
   */
  enabledWhen = (shouqValue, salemValue) => {
    const env = { ...process.env };
    delete env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
    delete env.NEXT_PUBLIC_ELEVENLABS_SALEM_AGENT_ID;
    if (shouqValue !== undefined) env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID = shouqValue;
    if (salemValue !== undefined) env.NEXT_PUBLIC_ELEVENLABS_SALEM_AGENT_ID = salemValue;
    const probe =
      `import(${JSON.stringify(pathToFileURL(bundle).href)}).then((m) => console.log(JSON.stringify({` +
      `shouq: m.WAIN_AI_AGENT_ENABLED, salem: m.SALEM_AGENT_ENABLED, any: m.WAIN_AI_ANY_AGENT_ENABLED, ` +
      `shouqId: m.agentIdFor("shouq"), salemId: m.agentIdFor("salem") })))`;
    return JSON.parse(
      execFileSync(process.execPath, ["-e", probe], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        env,
      })
    );
  };
} finally {
  // Deliberately NOT removed here — enabledWhen() re-imports the bundle below.
}

console.log("\n── the widget file a call depends on ──");
console.log(`  ${SRC}`);

const PKG = "@elevenlabs/convai-widget-embed";
const pinned = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).devDependencies?.[PKG];
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
// THE CHECK, moved from the URL to the manifest. A range is what shipped once.
if (!pinned) fail(`package.json has no devDependency on ${PKG}`);
else if (!EXACT.test(pinned)) {
  fail(
    `package.json pins «${pinned}», a range or a tag, not an exact version`,
    "The bytes that ship are whatever npm installed, so a range lets an install\n" +
    "      change the call without a commit saying so — and `@1` once resolved to\n" +
    "      nothing at all. Pin x.y.z."
  );
} else ok(`package.json pins exactly ${pinned}`);

const m = /^\/_next\/static\/media\/convai-([^-/]+(?:-[0-9A-Za-z.]+)?)-([0-9a-f]{16})\.js$/.exec(SRC ?? "");
if (!m) {
  fail(
    "the src is not a hashed file under /_next/static/media/ on this origin",
    "That directory is cached for a year as immutable; a name that does not\n" +
    "      change with the bytes would serve the old widget to everyone who had it."
  );
} else {
  ok("on this origin, under _next/static/media/, named for its content");
  if (pinned && m[1] !== pinned) fail("the file is named for a different version than package.json pins", `${m[1]} vs ${pinned}`);
  else ok(`and for the pinned version (${m[1]})`);
}

try {
  execFileSync(process.execPath, [join(ROOT, "scripts/vendor-widget.mjs"), "--check"], { cwd: ROOT, stdio: "pipe" });
  ok("src/lib/widget-src.g.ts is current for node_modules");
} catch (e) {
  fail("src/lib/widget-src.g.ts is stale", String(e.stderr ?? e.message).trim());
}

const shipped = SRC ? join(ROOT, "out", SRC) : null;
// Which build out/ is: the one this environment builds (the same switch the
// build read). Reading it off the chunks does not work — the agent branch is
// still in a free build's code, unreachable, behind a constant.
const outIsAgent = existsSync(join(ROOT, "out")) ? ANY_AGENT : null;
if (!shipped || outIsAgent === null) {
  note("no out/ — whether the build carries the file was NOT checked here");
} else if (!outIsAgent) {
  const stray = readdirSync(join(ROOT, "out/_next/static/media")).filter((f) => f.startsWith("convai-"));
  if (stray.length) fail("a free build ships the ElevenLabs widget anyway — the live site must not carry it", stray.join(", "));
  else ok("out/ is a free build, and the widget is not shipped with it");
} else if (!existsSync(shipped)) {
  fail("out/ does not carry the file the page will ask for", SRC);
} else {
  const got = `sha384-${createHash("sha384").update(readFileSync(shipped)).digest("base64")}`;
  if (got !== INTEGRITY) fail("the shipped bytes do not match the integrity the tag demands — every browser would refuse them", `${got} vs ${INTEGRITY}`);
  else ok("out/ carries it, and its bytes match the integrity on the tag");
}

// Everything below wants the registry. It is a bonus, not the check.
if (pinned && EXACT.test(pinned)) {
  let meta = null;
  try {
    meta = JSON.parse(
      execFileSync("npm", ["view", `${PKG}@${pinned}`, "--json"], {
        cwd: ROOT, stdio: ["ignore", "pipe", "ignore"], timeout: 60_000, encoding: "utf8",
      })
    );
  } catch {
    note("the registry could not be reached — the version itself was NOT verified here");
  }
  if (meta) ok(`the registry has ${PKG}@${meta.version}`);
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
  /**
   * Each row: shouq's variable, salem's variable, and what must follow.
   *
   * The two rows that matter most are the ones where only ONE agent is set.
   * Before the split, a missing Salem id fell back to Shouq's agent, so his
   * typed chat and his call were hers — and the reverse. Those rows fail if
   * either persona picks up the other's id.
   */
  const cases = [
    [undefined, undefined, { shouq: false, salem: false }, "both unset — a laptop, a sandbox, or CI as it ships"],
    ["", "", { shouq: false, salem: false }, "both empty — unset GitHub variables reach the build as \"\""],
    ["none", "none", { shouq: false, salem: false }, "both «none» — the explicit off switches"],
    [SHOUQ_AGENT, undefined, { shouq: true, salem: false }, "only شوق's agent — Salem must NOT take her id"],
    [undefined, SALEM_AGENT, { shouq: false, salem: true }, "only سالم's agent — شوق must NOT take his id"],
    [SHOUQ_AGENT, SALEM_AGENT, { shouq: true, salem: true }, "both — the staging build, two agents"],
  ];
  for (const [shouqValue, salemValue, want, why] of cases) {
    const got = enabledWhen(shouqValue, salemValue);
    const problems = [];
    if (got.shouq !== want.shouq) problems.push(`شوق ${want.shouq ? "on" : "off"} expected, got ${got.shouq ? "on" : "off"}`);
    if (got.salem !== want.salem) problems.push(`سالم ${want.salem ? "on" : "off"} expected, got ${got.salem ? "on" : "off"}`);
    if (got.any !== (want.shouq || want.salem)) problems.push(`the any-agent flag reads ${got.any}`);
    if (got.shouqId !== (want.shouq ? SHOUQ_AGENT : "")) problems.push(`شوق reaches «${got.shouqId}»`);
    if (got.salemId !== (want.salem ? SALEM_AGENT : "")) problems.push(`سالم reaches «${got.salemId}»`);
    if (problems.length) {
      fail(`${why}: ${problems.join("; ")}`,
           "A persona reaching the other's agent is the mix the 14 October split ended.\n" +
           "      Each persona's id must come only from its own variable, and an unset one\n" +
           "      must stay unset (\"\"), never borrow the other's.");
    } else ok(`${why} → شوق ${got.shouq ? "on" : "off"}, سالم ${got.salem ? "on" : "off"}`);
  }
}
rmSync(tmp, { recursive: true, force: true });

// A URL nobody fetches is not a bug, so say which case this is.
if (!ANY_AGENT) note("this environment builds free — the widget path is used only by a build with an agent id");

console.log(`\n${errors} errors, ${notes} notes`);
process.exit(errors ? 1 : 0);
