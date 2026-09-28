// Every piece of media the project has made — video, sound and images —
// gathered into one place, indexed, and zipped for handing over.
//
//   node tools/export-media.mjs            # -> press/export/
//
// Writes press/export/{video,sound,images}/..., an index (MEDIA.md and
// media.json: every file's size, duration or pixel size, and where it
// came from) and one zip per group — night-racer-video.zip,
// night-racer-sound.zip and three image zips (press kit, in-game,
// measurements). press/export is ignored: every file in it is a copy.
//
// WHAT COUNTS. scripts/lib/assets.mjs is the project's own declaration
// of which folders are deliverables and which are a test's scratch, and
// this reads it rather than keeping a second opinion: a "kept" family is
// exported whole, a "split" family only as far as its keep list goes (a
// film's 336 working frames are not the film), and a "scratch" family
// not at all. Folders the map does not know yet (sound-export, the
// trailer) are named here explicitly. The trailer's frames and its
// lossless master are left where they are — gigabytes, and not what
// anybody means by "send me the video" — and the index says where.
import { ASSETS } from "../scripts/lib/assets.mjs";
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, relative, extname, basename, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const OUT = "press/export";
const KIND = {
  video: [".mp4", ".webm", ".mov", ".mkv"],
  sound: [".mp3", ".wav", ".flac", ".ogg", ".m4a"],
  images: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"],
};
const kindOf = (f) => Object.keys(KIND).find((k) => KIND[k].includes(extname(f).toLowerCase())) ?? null;

// The press kit — what a trailer, a store page or a post is made from.
// Everything else the map keeps under press/ is a measurement: a
// before-and-after a comment cites, still media, but not for publishing.
const PRESS_KIT = new Set([
  "press/cars", "press/renders", "press/logo", "press/shots", "press/social", "press/stories",
  "press/map", "press/flags", "press/intro", "press/menu", "press/film", "press/ik", "press/trailer",
  "press/police",
]);
// The map's keep list for the trailer is what git keeps; the export
// wants the playback MP4s too. And sound-export sits outside press/ and
// public/, where the map does not look.
const EXTRA = [
  { path: "press/trailer", kind: "split", keep: ["narration-ar.mp3", "trailer-*.mp4"] },
  { path: "sound-export", kind: "kept" },
];
// Files at the top of press/ that belong to no family.
const LOOSE = ["press/dial.png", "press/flyover.png", "press/menu-corniche.png"];

const globRe = (g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$");
const walk = (dir) => {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
};

function findFfmpeg() {
  if (process.env.FFMPEG && existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  try {
    const p = execFileSync("which", ["ffmpeg"], { encoding: "utf8" }).trim();
    if (p) return p;
  } catch {}
  try {
    const p = createRequire(import.meta.url)("ffmpeg-static");
    if (p && existsSync(p)) return p;
  } catch {}
  return null;
}
const ff = findFfmpeg();
/** Duration in seconds, from ffmpeg's own banner — no ffprobe needed. */
const duration = (f) => {
  if (!ff) return null;
  let text = "";
  try {
    execFileSync(ff, ["-hide_banner", "-i", f], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    text = String(e.stderr ?? "");
  }
  const m = text.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const v = text.match(/Video: [^\n]*?(\d{2,5})x(\d{2,5})/);
  return m ? { s: +m[1] * 3600 + +m[2] * 60 + +m[3], w: v ? +v[1] : null, h: v ? +v[2] : null } : null;
};
let sharp = null;
try { sharp = (await import("sharp")).default; } catch {}

// ------------------------------------------------------------ collect
const families = [...ASSETS.filter((a) => a.path !== "press/trailer"), ...EXTRA];
const picked = [];
const skipped = { scratch: 0, split: 0 };
for (const fam of families) {
  if (!existsSync(fam.path)) continue;
  const files = walk(fam.path).filter((f) => kindOf(f));
  if (fam.kind === "scratch") { skipped.scratch += files.length; continue; }
  for (const f of files) {
    if (fam.kind === "split") {
      const rel = relative(fam.path, f);
      if (!(fam.keep ?? []).some((g) => globRe(g).test(rel))) { skipped.split++; continue; }
    }
    // The GLBs beside the renders are models, not media; kindOf already
    // leaves them out. So are the trailer's working frames (not in keep).
    const group = fam.path.startsWith("public/") ? "in-game" : PRESS_KIT.has(fam.path) ? "press-kit" : fam.path === "sound-export" ? "elevenlabs-export" : "measurements";
    picked.push({ src: f, family: fam.path, group, kind: kindOf(f) });
  }
}
for (const f of LOOSE) if (existsSync(f)) picked.push({ src: f, family: "press", group: "press-kit", kind: kindOf(f) });

// The same bytes shipped twice (sound-export was installed into public/)
// are exported once, under the copy the game actually plays.
const seen = new Map();
const unique = [];
let dupes = 0;
for (const p of picked.sort((a, b) => (a.group === "elevenlabs-export") - (b.group === "elevenlabs-export"))) {
  const h = createHash("sha1").update(readFileSync(p.src)).digest("hex");
  if (seen.has(h)) { dupes++; seen.get(h).alsoAt.push(p.src); continue; }
  p.alsoAt = [];
  seen.set(h, p);
  unique.push(p);
}

// --------------------------------------------------------------- copy
rmSync(OUT, { recursive: true, force: true });
const index = [];
for (const p of unique) {
  // video/<file>; sound/<family>/<file>; images/<group>/<family>/<file>
  const fam = p.family.replace(/^(press|public)\//, "");
  const dest = p.kind === "video"
    ? join(OUT, "video", basename(p.src))
    : p.kind === "sound"
      ? join(OUT, "sound", fam === "trailer" ? "trailer" : fam, relative(p.family, p.src))
      : join(OUT, "images", p.group, fam === "press" ? "" : fam, p.family === "press" ? basename(p.src) : relative(p.family, p.src));
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(p.src, dest);
  const bytes = statSync(p.src).size;
  let info = {};
  if (p.kind === "images" && sharp) {
    try { const m = await sharp(p.src).metadata(); info = { w: m.width, h: m.height }; } catch {}
  } else if (p.kind !== "images") {
    const d = duration(p.src);
    if (d) info = { seconds: +d.s.toFixed(2), ...(d.w ? { w: d.w, h: d.h } : {}) };
  }
  index.push({ file: relative(OUT, dest), kind: p.kind, group: p.group, bytes, ...info, source: p.src, ...(p.alsoAt.length ? { alsoAt: p.alsoAt } : {}) });
}

// -------------------------------------------------------------- index
const mb = (b) => (b / 1e6).toFixed(1);
const human = (e) => e.seconds != null ? `${e.seconds.toFixed(1)} s${e.w ? `, ${e.w}×${e.h}` : ""}` : e.w ? `${e.w}×${e.h}` : "";
const byKind = (k) => index.filter((e) => e.kind === k);
const lines = [
  "# Night Racer — media export",
  "",
  `${index.length} files, ${mb(index.reduce((s, e) => s + e.bytes, 0))} MB: ` +
    Object.keys(KIND).map((k) => `${byKind(k).length} ${k}`).join(", ") + ".",
  `Built by \`node tools/export-media.mjs\` from the families in \`scripts/lib/assets.mjs\`; ` +
    `${skipped.scratch} scratch files and ${skipped.split} working files of split families were left out, ` +
    `and ${dupes} byte-identical duplicates exported once.`,
  "",
  "Not in here, on purpose: the trailer's lossless master (`press/trailer/trailer-1080p-master.mkv`, FFV1 + FLAC, " +
    "about 2 GB when complete) and its PNG frames, and the car GLBs behind the Blender renders (`press/renders/glb/`).",
  "",
];
for (const k of Object.keys(KIND)) {
  const rows = byKind(k);
  if (!rows.length) continue;
  lines.push(`## ${k[0].toUpperCase() + k.slice(1)} (${rows.length}, ${mb(rows.reduce((s, e) => s + e.bytes, 0))} MB)`, "");
  lines.push("| File | Size | Length / pixels | From |", "| --- | ---: | --- | --- |");
  for (const e of rows.sort((a, b) => a.file.localeCompare(b.file)))
    lines.push(`| \`${e.file}\` | ${mb(e.bytes)} MB | ${human(e)} | \`${e.source}\` |`);
  lines.push("");
}
writeFileSync(join(OUT, "MEDIA.md"), lines.join("\n"));
writeFileSync(join(OUT, "media.json"), JSON.stringify(index, null, 2) + "\n");

// --------------------------------------------------------------- zips
// Stored, not deflated: every one of these formats is compressed already,
// and deflating an MP4 buys nothing but time.
const zips = [
  ["night-racer-video.zip", ["video"]],
  ["night-racer-sound.zip", ["sound"]],
  ["night-racer-images-press-kit.zip", ["images/press-kit"]],
  ["night-racer-images-in-game.zip", ["images/in-game"]],
  ["night-racer-images-measurements.zip", ["images/measurements"]],
];
const made = [];
for (const [name, dirs] of zips) {
  const present = dirs.filter((d) => existsSync(join(OUT, d)));
  if (!present.length) continue;
  execFileSync("zip", ["-q", "-r", "-0", name, "MEDIA.md", ...present], { cwd: OUT });
  made.push([name, statSync(join(OUT, name)).size]);
}
console.log(`${index.length} files exported to ${OUT}/ (${Object.keys(KIND).map((k) => `${byKind(k).length} ${k}`).join(", ")}); ` +
  `${skipped.scratch} scratch + ${skipped.split} working files skipped, ${dupes} duplicates folded`);
for (const [name, bytes] of made) console.log(`  ${join(OUT, name)}  ${mb(bytes)} MB`);
