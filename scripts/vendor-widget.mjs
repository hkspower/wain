#!/usr/bin/env node
/**
 * Copy شوق's call widget, and the audio worklets it loads, into public/.
 *
 * The widget used to come from unpkg.com at the moment of a tap. That put a
 * third-party CDN on the critical path of every call and in three CSP
 * directives, and it meant the bytes that ran on wainkw.com were whatever
 * that CDN answered on the day — pinned by version, never by content. Now the
 * package is an exact devDependency, so npm's lockfile integrity check is what
 * decides the bytes, and the site serves them from its own origin.
 *
 * The bundle is not the whole of it, and that is the part worth reading. It
 * starts three AudioWorklets, and by default it fetches none of them from
 * where it was loaded:
 *
 *   rawAudioProcessor, audioConcatProcessor — carried INSIDE the bundle as
 *     strings and turned into a `blob:` URL, falling back to `data:`. An
 *     AudioWorklet's addModule() is a script fetch, checked against
 *     script-src, which allows neither — so both attempts are refused and the
 *     call dies with «Failed to load the rawAudioProcessor worklet module».
 *     That is the error recorded in public/.htaccess, and `worker-src` (which
 *     is where unpkg had been added to fix it) does not govern worklets at all.
 *   libsamplerate — fetched from cdn.jsdelivr.net, which no directive allows.
 *     Only reached when the browser will not open an AudioContext at the
 *     rate the agent asks for, which is why nobody has seen it fail.
 *
 * The widget takes a path for each (`worklet-path-*` attributes, read out of
 * the bundle), so all three are written here as plain files and WainAiCall
 * points the element at them. Same origin, `script-src 'self'`, nothing to
 * allowlist.
 *
 * Output goes under public/vendor/, gitignored: it is ~3.5MB derived entirely
 * from two locked packages, and committing it would be the archive bleed
 * CLAUDE.md describes, again. Directory names carry the package version,
 * because .htaccess caches .js as immutable for a year and only an exact
 * version makes that true here — see check-cache-safety.mjs.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { WIDGET_DIR, SAMPLERATE_DIR, VENDOR_FILES } from "./vendor-widget-paths.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const OUT = join(ROOT, "public");

function pkgDir(name) {
  return dirname(require.resolve(`${name}/package.json`));
}

const widgetPkg = pkgDir("@elevenlabs/convai-widget-embed");
const samplePkg = pkgDir("@alexanderolsen/libsamplerate-js");

// The directory names promise a version. Refuse to write a lie into them.
for (const [dir, name, want] of [
  [widgetPkg, "@elevenlabs/convai-widget-embed", WIDGET_DIR],
  [samplePkg, "@alexanderolsen/libsamplerate-js", SAMPLERATE_DIR],
]) {
  const { version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (!want.endsWith(`-${version}`)) {
    console.error(`vendor-widget: ${name} is ${version}, but the path says ${want}.`);
    console.error("  Bump both together: package.json and scripts/vendor-widget-paths.mjs.");
    process.exit(1);
  }
}

const bundle = readFileSync(join(widgetPkg, "dist/index.js"), "utf8");

/**
 * Pull one worklet's source out of the bundle.
 *
 * It sits there as `I_(`<name>`,`<source>`)` — a template literal. The name of
 * the function is minified and will move between versions, so match on the
 * worklet's own name and the literal after it, and refuse anything ambiguous:
 * a worklet extracted wrong is a call with no audio, and nothing else here
 * would notice.
 */
function worklet(name) {
  const marker = `(\`${name}\`,\``;
  const at = bundle.indexOf(marker);
  if (at < 0 || bundle.indexOf(marker, at + 1) >= 0) {
    console.error(`vendor-widget: expected exactly one ${name} worklet in the bundle.`);
    process.exit(1);
  }
  const start = at + marker.length;
  let end = start;
  while (end < bundle.length && !(bundle[end] === "`" && bundle[end - 1] !== "\\")) end++;
  const raw = bundle.slice(start, end);
  if (raw.includes("${")) {
    console.error(`vendor-widget: the ${name} literal interpolates — it is not plain source.`);
    process.exit(1);
  }
  const source = new Function(`return \`${raw}\`;`)();
  if (!source.includes("registerProcessor(")) {
    console.error(`vendor-widget: what was extracted as ${name} registers no processor.`);
    process.exit(1);
  }
  return source;
}

rmSync(join(OUT, "vendor"), { recursive: true, force: true });
for (const dir of [WIDGET_DIR, SAMPLERATE_DIR]) mkdirSync(join(OUT, "vendor", dir), { recursive: true });

copyFileSync(join(widgetPkg, "dist/index.js"), join(OUT, VENDOR_FILES.widget));
copyFileSync(join(widgetPkg, "LICENSE"), join(OUT, "vendor", WIDGET_DIR, "LICENSE.txt"));
writeFileSync(join(OUT, VENDOR_FILES.rawAudioProcessor), worklet("rawAudioProcessor"));
writeFileSync(join(OUT, VENDOR_FILES.audioConcatProcessor), worklet("audioConcatProcessor"));
copyFileSync(join(samplePkg, "dist/libsamplerate.worklet.js"), join(OUT, VENDOR_FILES.libsamplerate));
// LICENSE.md upstream, renamed: the export's .htaccess denies every .md.
copyFileSync(join(samplePkg, "LICENSE.md"), join(OUT, "vendor", SAMPLERATE_DIR, "LICENSE.txt"));

console.log("vendor-widget: the widget and its three worklets are in public/vendor/");
