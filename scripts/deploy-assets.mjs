// Mirror public/ to the asset host — nr.mawsoool.com, document root Nr/.
//
//   npm run deploy:assets -- --dry-run          what would be uploaded
//   npm run deploy:assets -- --only=radio       one family, e.g. to probe
//   npm run deploy:assets                       everything that changed
//   npm run deploy:assets -- --force            everything, changed or not
//   npm run deploy:assets -- --htaccess-only    just the host's rules
//   npm run deploy:assets -- --verify           HEAD every file on the host
//
// WHERE THE FILE LIST COMES FROM
//
// scripts/lib/assets.mjs already declares every asset family in the
// repository and which of them ship to the browser (`ships: true`).
// This walks exactly those — public/cars, game, models, music, radio,
// sfx, textures, voices — rather than carrying a second list that would
// drift the first time a family was added. README.md and dotfiles in
// those folders are documentation and scratch, not assets, and stay
// home; so do the two scratch names .gitignore knows from tests/audio.
//
// CREDENTIALS
//
// Hostinger's upload API hands out a short-lived TUS endpoint for one
// website: a URL and two auth keys. They come from the hosting
// connector at run time and are read from the environment —
//
//   NR_UPLOAD_URL         the TUS base URL for the mawsoool.com website
//   NR_UPLOAD_AUTH        sent as X-Auth
//   NR_UPLOAD_AUTH_REST   sent as X-Auth-Rest
//
// — and never from a file in this repository. Export them in the shell
// for one run. They expire; a 401 means "get a fresh set", not a bug.
//
// WHAT IS UPLOADED, AND WHEN
//
// Every file's sha256 is recorded in scripts/lib/nr-assets.lock.json
// after it lands, and a file whose hash has not changed is skipped. The
// lock is committed so the deployed state is visible in history and a
// second machine does not re-upload 36 MB to learn nothing changed.
// `--verify` asks the host itself — a HEAD per file, comparing
// Content-Length — which is the cheap remote truth the lock is a cache
// of.
//
// THE RULE THIS SCRIPT EXISTS TO MAKE VISIBLE
//
// Any change under public/ — `npm run sync:models`, a new voice line —
// needs this run BEFORE the web build that references it. The host
// otherwise serves the previous build.json and .glbs while the game
// expects the new set, and models.ts falls back to the procedural
// shells in silence — the exact failure tests/assets.mjs exists to
// catch, one origin over.
//
// PROTOCOL
//
// TUS 1.0.0, as the upload API documents it: POST creates the upload
// (201), PATCH sends the bytes (204, and the Upload-Offset header comes
// back equal to the size). A PATCH that dies midway is resumed from the
// offset HEAD reports, which is what TUS is for. Directories: the first
// run into a folder that does not exist yet tells us whether the API
// creates it — see NOTE_DIRS below and record what you find.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { SHIPPED } from "./lib/assets.mjs";
import { NR_HTACCESS } from "./lib/nr-htaccess.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => {
  const hit = args.find((a) => a.startsWith(`${n}=`));
  return hit ? hit.slice(n.length + 1) : null;
};
const DRY = flag("--dry-run");
const FORCE = flag("--force");
const VERIFY = flag("--verify");
const HTACCESS_ONLY = flag("--htaccess-only");
const ONLY = (opt("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const REMOTE_DIR = (process.env.NR_REMOTE_DIR || "Nr").replace(/^\/+|\/+$/g, "");
const PUBLIC_BASE = (process.env.NR_PUBLIC_BASE || "https://nr.mawsoool.com").replace(/\/+$/, "");
const LOCK_PATH = "scripts/lib/nr-assets.lock.json";
const CONCURRENCY = 3;

// NOTE_DIRS: whether the TUS endpoint creates intermediate directories
// (Nr/models/…) on its own has to be learnt from the first upload into
// a fresh folder — run `--only=radio` (two small files) before the full
// set and record the answer here.
const SKIP_NAMES = new Set(["README.md", "__probe.wav", "manifest.json.testbak"]);

// ---------------------------------------------------------------- files
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || SKIP_NAMES.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push({ path: p, size: st.size });
  }
  return out;
}

const families = SHIPPED.filter((f) => !ONLY.length || ONLY.includes(f.path.replace(/^public\//, "")));
if (ONLY.length && !families.length) {
  console.error(`--only named no shipped family; shipped: ${SHIPPED.map((f) => f.path.replace(/^public\//, "")).join(", ")}`);
  process.exit(2);
}

/** Every file to mirror: local path, remote path under REMOTE_DIR, size, sha256. */
const files = HTACCESS_ONLY
  ? []
  : families.flatMap((fam) =>
      walk(fam.path).map((f) => {
        const rel = relative("public", f.path).split(sep).join("/");
        return { ...f, rel, remote: `${REMOTE_DIR}/${rel}`, sha: sha256(readFileSync(f.path)) };
      })
    );
const htaccess = {
  path: null,
  rel: ".htaccess",
  remote: `${REMOTE_DIR}/.htaccess`,
  size: Buffer.byteLength(NR_HTACCESS),
  sha: sha256(Buffer.from(NR_HTACCESS)),
  bytes: Buffer.from(NR_HTACCESS),
};
if (!ONLY.length || HTACCESS_ONLY) files.push(htaccess);

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// ----------------------------------------------------------------- lock
let lock = {};
try { lock = JSON.parse(readFileSync(LOCK_PATH, "utf8")); } catch {}
const saveLock = () => writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + "\n");

const kb = (n) => `${(n / 1024).toFixed(0).padStart(5)} kB`;
const wanted = files.filter((f) => FORCE || lock[f.rel]?.sha !== f.sha);
const total = files.reduce((s, f) => s + f.size, 0);
console.log(
  `${families.length} famil${families.length === 1 ? "y" : "ies"}, ${files.length} files, ` +
    `${(total / 1024 / 1024).toFixed(1)} MB → ${PUBLIC_BASE}/  (${REMOTE_DIR}/ on the host)`
);
console.log(`${wanted.length} to upload${FORCE ? " (forced)" : ""}, ${files.length - wanted.length} unchanged since the lock`);

// --------------------------------------------------------------- verify
if (VERIFY) {
  let bad = 0;
  for (const f of files) {
    if (f.rel === ".htaccess") continue; // denied by its own rule; a 403 is the correct answer
    const url = `${PUBLIC_BASE}/${f.rel}`;
    try {
      const r = await fetch(url, { method: "HEAD" });
      const len = Number(r.headers.get("content-length"));
      const ok = r.ok && len === f.size;
      if (!ok) bad++;
      console.log(`${ok ? "ok  " : "BAD "} ${r.status} ${String(len).padStart(9)}/${String(f.size).padEnd(9)} ${f.rel}`);
    } catch (err) {
      bad++;
      console.log(`BAD  --- ${f.rel}: ${err.message}`);
    }
  }
  console.log(bad ? `\n${bad} file${bad === 1 ? "" : "s"} differ from the host` : "\nthe host has every file at its size");
  process.exit(bad ? 1 : 0);
}

// -------------------------------------------------------------- dry run
if (DRY) {
  for (const f of files) {
    const status = wanted.includes(f) ? "upload " : "same   ";
    console.log(`${status} ${kb(f.size)}  ${f.remote}`);
  }
  console.log("\ndry run — nothing sent, lock untouched");
  process.exit(0);
}

// --------------------------------------------------------------- upload
const URL_BASE = process.env.NR_UPLOAD_URL?.replace(/\/+$/, "");
const AUTH = process.env.NR_UPLOAD_AUTH;
const AUTH_REST = process.env.NR_UPLOAD_AUTH_REST;
if (wanted.length && (!URL_BASE || !AUTH || !AUTH_REST)) {
  console.error(
    "\nNR_UPLOAD_URL, NR_UPLOAD_AUTH and NR_UPLOAD_AUTH_REST are required to upload.\n" +
      "They come from Hostinger's upload-URL API for the mawsoool.com website and\n" +
      "expire; export them in this shell for one run. See .env.example."
  );
  process.exit(2);
}
const HDR = { "X-Auth": AUTH, "X-Auth-Rest": AUTH_REST, "Tus-Resumable": "1.0.0" };

async function tus(f) {
  const bytes = f.bytes ?? readFileSync(f.path);
  const url = `${URL_BASE}/${f.remote}?override=true`;
  const create = await fetch(url, {
    method: "POST",
    headers: { ...HDR, "Upload-Length": String(bytes.length), "Upload-Offset": "0" },
  });
  if (create.status !== 201) throw new Error(`create ${create.status} ${await create.text().catch(() => "")}`.trim());
  let offset = 0;
  for (let attempt = 0; attempt < 3 && offset < bytes.length; attempt++) {
    const patch = await fetch(url, {
      method: "PATCH",
      headers: {
        ...HDR,
        "Content-Type": "application/offset+octet-stream",
        "Upload-Offset": String(offset),
      },
      body: bytes.subarray(offset),
    }).catch((err) => ({ status: 0, headers: new Headers(), text: async () => err.message }));
    if (patch.status === 204) {
      offset = Number(patch.headers.get("upload-offset") ?? bytes.length);
      if (offset >= bytes.length) return;
    }
    // Ask the server where it got to and resume from there.
    const head = await fetch(url, { method: "HEAD", headers: HDR }).catch(() => null);
    const got = head ? Number(head.headers.get("upload-offset")) : NaN;
    if (Number.isFinite(got) && got > offset) offset = got;
    else if (patch.status !== 204) throw new Error(`patch ${patch.status} ${await patch.text().catch(() => "")}`.trim());
  }
  if (offset < bytes.length) throw new Error(`stalled at ${offset}/${bytes.length}`);
}

let failed = 0;
let sent = 0;
const queue = [...wanted];
const worker = async () => {
  for (let f = queue.shift(); f; f = queue.shift()) {
    try {
      await tus(f);
      lock[f.rel] = { sha: f.sha, size: f.size, uploadedAt: new Date().toISOString() };
      saveLock();
      sent += f.size;
      console.log(`uploaded ${kb(f.size)}  ${f.remote}`);
    } catch (err) {
      failed++;
      console.log(`FAILED   ${kb(f.size)}  ${f.remote} — ${err.message}`);
    }
  }
};
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(
  `\n${wanted.length - failed} uploaded (${(sent / 1024 / 1024).toFixed(1)} MB), ` +
    `${files.length - wanted.length} unchanged, ${failed} failed`
);
if (!failed && files.length) {
  const pick = (fam) => files.find((f) => f.rel.startsWith(`${fam}/`) && !f.rel.endsWith(".htaccess"));
  const show = ["models/build.json", pick("models")?.rel, pick("music")?.rel, pick("voices")?.rel, pick("sfx")?.rel, pick("cars")?.rel]
    .filter((x, i, a) => x && a.indexOf(x) === i);
  console.log("\ncheck the host is answering as intended:");
  for (const rel of show) console.log(`  curl -sI ${PUBLIC_BASE}/${rel}`);
  console.log(`  curl -sI -X OPTIONS -H "Origin: https://wainkw.com" -H "Access-Control-Request-Method: GET" ${PUBLIC_BASE}/music/cruise.mp3`);
  console.log(`  npm run deploy:assets -- --verify`);
}
process.exit(failed ? 1 : 0);
