// Every piece of media the project has made — video, sound and images —
// gathered into one place, indexed, and zipped for handing over.
//
//   node tools/export-media.mjs            # -> press/export/
//
// Writes press/export/{video,sound,images}/..., an index (MEDIA.md and
// media.json: every file's size, duration or pixel size, and where it
// came from) and zips per group — video, sound, and images three ways
// (press kit, in-game, measurements). press/export is ignored: every
// file in it is a copy.
//
// SIZED TO BE SENT. A zip is at most --max-mb (28 by default: the chat
// upload limit is 30 MiB), so a big group becomes numbered parts, and
// every part is a whole zip that opens on its own — not a split archive
// that needs all its pieces and a desktop tool. A single video bigger
// than that cannot be packed at all, so it travels as a share copy:
// two-pass H.264 at the bitrate that fits, beside the untouched
// original, and the index says which is which.
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
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const MAX = Number(argOf("max-mb", 28)) * 1e6;
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

// ------------------------------------------------------- share copies
const shares = [];
for (const e of index) {
  if (e.kind !== "video" || e.bytes <= MAX) continue;
  if (!ff || !e.seconds) { console.log(`  ${e.file}: ${(e.bytes / 1e6).toFixed(1)} MB and no encoder/duration to shrink it — left out of the zips`); continue; }
  const src = join(OUT, e.file);
  const dest = join(OUT, "video-share", basename(e.file).replace(/\.[^.]+$/, "-share.mp4"));
  mkdirSync(dirname(dest), { recursive: true });
  // The bitrate that lands at 94% of the cap, less 192 kb/s of audio.
  const vbps = Math.max(500e3, Math.floor((MAX * 0.94 * 8) / e.seconds - 192e3));
  const log = join(OUT, ".x264pass");
  const common = ["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-c:v", "libx264", "-preset", "slow", "-b:v", String(vbps), "-pix_fmt", "yuv420p", "-passlogfile", log];
  execFileSync(ff, [...common, "-pass", "1", "-an", "-f", "null", "/dev/null"], { stdio: "ignore" });
  execFileSync(ff, [...common, "-pass", "2", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", dest], { stdio: "ignore" });
  for (const f of readdirSync(OUT)) if (f.startsWith(".x264pass")) rmSync(join(OUT, f));
  e.share = relative(OUT, dest);
  e.shareBytes = statSync(dest).size;
  e.shareKbps = Math.round(vbps / 1000);
  shares.push(e);
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
    lines.push(`| \`${e.file}\` | ${mb(e.bytes)} MB${e.share ? ` (zipped as \`${e.share}\`, ${mb(e.shareBytes)} MB at ${e.shareKbps} kb/s)` : ""} | ${human(e)} | \`${e.source}\` |`);
  lines.push("");
}
writeFileSync(join(OUT, "MEDIA.md"), lines.join("\n"));
writeFileSync(join(OUT, "media.json"), JSON.stringify(index, null, 2) + "\n");

// --------------------------------------------------------------- zips
// Stored, not deflated: every one of these formats is compressed already,
// and deflating an MP4 buys nothing but time. Packed first-fit by size
// into parts under the cap, the index riding in every part.
const groups = [
  ["video", (e) => e.kind === "video"],
  ["sound", (e) => e.kind === "sound"],
  ["images-press-kit", (e) => e.kind === "images" && e.group === "press-kit"],
  ["images-in-game", (e) => e.kind === "images" && e.group === "in-game"],
  ["images-measurements", (e) => e.kind === "images" && e.group === "measurements"],
];
const indexBytes = statSync(join(OUT, "MEDIA.md")).size;
const made = [];
const left = [];
for (const [name, test] of groups) {
  const items = index.filter(test).map((e) => (e.share ? { file: e.share, bytes: e.shareBytes } : { file: e.file, bytes: e.bytes }));
  const room = MAX - indexBytes - 4096;
  const bins = [];
  for (const it of items.sort((x, y) => y.bytes - x.bytes)) {
    if (it.bytes + 200 > room) { left.push(it.file); continue; }
    const bin = bins.find((b) => b.bytes + it.bytes + 200 <= room);
    if (bin) { bin.files.push(it.file); bin.bytes += it.bytes + 200; }
    else bins.push({ files: [it.file], bytes: it.bytes + 200 });
  }
  bins.forEach((b, i) => {
    const zip = `night-racer-${name}${bins.length > 1 ? `-${i + 1}of${bins.length}` : ""}.zip`;
    execFileSync("zip", ["-q", "-0", zip, "MEDIA.md", ...b.files.sort()], { cwd: OUT });
    made.push([zip, statSync(join(OUT, zip)).size, b.files.length]);
  });
}
console.log(`${index.length} files exported to ${OUT}/ (${Object.keys(KIND).map((k) => `${byKind(k).length} ${k}`).join(", ")}); ` +
  `${skipped.scratch} scratch + ${skipped.split} working files skipped, ${dupes} duplicates folded`);
for (const e of shares) console.log(`  share copy  ${e.share}  ${mb(e.shareBytes)} MB (${e.shareKbps} kb/s) for ${e.file} ${mb(e.bytes)} MB`);
for (const [name, bytes, n] of made) console.log(`  ${join(OUT, name)}  ${mb(bytes)} MB, ${n} files`);
if (left.length) console.log(`  too big for any zip under ${mb(MAX)} MB: ${left.join(", ")}`);
