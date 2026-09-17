#!/usr/bin/env node
/**
 * scripts/publish/media-endpoint.php, against a real PHP server:
 *   npm run test:media
 *
 * This is the one wain endpoint that accepts a write from a visitor's browser
 * with no authentication at all — registering a business needs to work for
 * someone who has never touched wain before, so there is no account, no
 * token, nothing to check the caller already holds. Everything that makes an
 * open upload endpoint safe to ship is in this file's assertions: the bytes
 * are sniffed rather than trusted, the draft id is constrained to a charset
 * that cannot become a path, storage sits outside anything a URL reaches, and
 * both caps — per-IP and total disk — actually trip.
 *
 * ElevenLabs's endpoint has an upstream to stub; this one does not talk to
 * anything else, so every branch here is the real code path, not a double.
 */
import { spawn, execFileSync } from "node:child_process";
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync,
  readFileSync, utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 4218;
const ORIGIN = "https://www.wainkw.com";

const dir = mkdtempSync(join(tmpdir(), "wain-media-"));
const web = join(dir, "public_html");
const api = join(web, "api");
const storage = join(dir, "storage");
mkdirSync(api, { recursive: true });
mkdirSync(storage, { recursive: true });
writeFileSync(
  join(api, "media.php"),
  readFileSync(new URL("../scripts/publish/media-endpoint.php", import.meta.url))
);
const pendingDir = join(storage, "business-pending");
const adminKeyFile = join(storage, "media-admin.key");

/* -d flags raise the server's own post_max_size/upload_max_filesize above
   MAX_BYTES — this sandbox's default php.ini (8M / 2M) sits BELOW MAX_BYTES
   (12M), so without this every "too large" test would trip PHP's own ceiling
   before reaching the endpoint's MAX_BYTES check and prove nothing about
   that check specifically. A live install needs the same raise — see
   `php media.php version`'s phpIni note, which exists for exactly this. */
const php = spawn("php",
  ["-d", "post_max_size=20M", "-d", "upload_max_filesize=20M",
   "-S", `127.0.0.1:${PORT}`, "-t", web],
  {
    stdio: "ignore",
    env: { ...process.env, WAIN_MEDIA_MAX_TOTAL_BYTES: String(200 * 1024) },
  }
);
await new Promise((r) => setTimeout(r, 700));

let pass = 0;
const fails = [];
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fails.push(n); console.log(`  ✗ ${n}${d ? "\n      " + d : ""}`); }
};

const BASE = `http://127.0.0.1:${PORT}/api/media.php`;

/* A real, decodable 1×1 PNG — getimagesize() has to succeed on it, so this
   cannot be a text file wearing a .png name. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function draftId() {
  return `d${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/* `bytes: null` means "send no file field at all" — distinct from omitting
   the key, which means "use the default PNG". A default parameter only
   fires on `undefined`, so an explicit `undefined` would silently fall back
   to the PNG and the "no file" test would never test what it claims to. */
async function upload({
  draftId: id, kind = "logo", index = 0, bytes = PNG_1PX, filename = "logo.png",
  origin = ORIGIN, type = "image/png",
} = {}) {
  const form = new FormData();
  if (id !== undefined) form.set("draftId", id);
  if (kind !== undefined) form.set("kind", kind);
  if (index !== undefined) form.set("index", String(index));
  if (bytes !== null) form.set("file", new Blob([bytes], { type }), filename);
  const headers = {};
  if (origin) headers.Origin = origin;
  const res = await fetch(BASE, { method: "POST", body: form, headers });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, cors: res.headers.get("access-control-allow-origin") };
}

function pendingFiles(id) {
  const p = join(pendingDir, id);
  return existsSync(p) ? readdirSync(p) : [];
}

try {
  console.log("\n── what it refuses before touching the disk ──");
  {
    const g = await fetch(BASE, { method: "GET" });
    ok("a bare GET is 400 unknown_action", g.status === 400, String(g.status));

    const put = await fetch(BASE, { method: "PUT" });
    ok("PUT is 405", put.status === 405, String(put.status));

    const evil = await upload({ draftId: draftId(), origin: "https://evil.example" });
    ok("an origin outside the allowlist is 403", evil.status === 403 && evil.json?.error === "origin_not_allowed",
       JSON.stringify(evil.json));

    const noFile = await upload({ draftId: draftId(), bytes: null });
    ok("no file at all is 400 file_required", noFile.status === 400 && noFile.json?.error === "file_required",
       JSON.stringify(noFile.json));

    const traversal = await upload({ draftId: "../../../etc" });
    ok("a draft id with slashes is 400 bad_draft_id",
       traversal.status === 400 && traversal.json?.error === "bad_draft_id", JSON.stringify(traversal.json));

    const shortId = await upload({ draftId: "ab" });
    ok("a too-short draft id is refused too", shortId.status === 400 && shortId.json?.error === "bad_draft_id");

    const badKind = await upload({ draftId: draftId(), kind: "banner" });
    ok("an unknown kind is 400 bad_kind", badKind.status === 400 && badKind.json?.error === "bad_kind",
       JSON.stringify(badKind.json));

    const badIndex = await upload({ draftId: draftId(), index: 12 });
    ok("index 12 is refused — MAX_PHOTOS is 12, so the highest is 11",
       badIndex.status === 400 && badIndex.json?.error === "bad_index", JSON.stringify(badIndex.json));

    const notNumber = await upload({ draftId: draftId(), index: "one" });
    ok("a non-numeric index is 400 bad_index", notNumber.status === 400 && notNumber.json?.error === "bad_index");

    const notImage = await upload({ draftId: draftId(), bytes: Buffer.from("just some text"), filename: "logo.png" });
    ok("bytes that are not a real image are 400 bad_type, whatever the filename says",
       notImage.status === 400 && notImage.json?.error === "bad_type", JSON.stringify(notImage.json));

    const big = Buffer.concat([PNG_1PX, Buffer.alloc(13 * 1024 * 1024)]);
    const tooBig = await upload({ draftId: draftId(), bytes: big });
    ok("a file over MAX_BYTES is 413 file_too_large", tooBig.status === 413 && tooBig.json?.error === "file_too_large",
       JSON.stringify(tooBig.json));
  }

  console.log("\n── a real upload ──");
  let id1;
  {
    id1 = draftId();
    const r = await upload({ draftId: id1, kind: "logo", index: 0 });
    ok("it accepts a real PNG", r.status === 200 && r.json?.ok === true, JSON.stringify(r.json));
    ok("the returned path names the file the server decided on",
       r.json?.path === `${id1}/logo-0.png`, r.json?.path);
    ok("and it echoes the origin for CORS", r.cors === ORIGIN, String(r.cors));

    const files = pendingFiles(id1);
    ok("exactly one file landed on disk", files.length === 1, JSON.stringify(files));
    ok("named the way the response said", files[0] === "logo-0.png", files[0]);
    ok("with the bytes actually written",
       readFileSync(join(pendingDir, id1, "logo-0.png")).equals(PNG_1PX));
  }

  console.log("\n── it never trusts the client's claimed extension ──");
  {
    const id = draftId();
    const r = await upload({ draftId: id, kind: "photo", index: 0, filename: "shirt.jpg", type: "image/jpeg" });
    ok("a PNG uploaded with a .jpg name is still stored as .png — the content decided",
       r.status === 200 && r.json?.path === `${id}/photo-0.png`, JSON.stringify(r.json));
  }

  console.log("\n── re-uploading the same slot replaces it, not adds to it ──");
  {
    const id = draftId();
    await upload({ draftId: id, kind: "logo", index: 0 });
    await upload({ draftId: id, kind: "logo", index: 0 });
    ok("still exactly one file in the slot", pendingFiles(id).length === 1, JSON.stringify(pendingFiles(id)));
  }

  console.log("\n── the admin view, unconfigured ──");
  {
    const r = await fetch(`${BASE}?action=view&draftId=${id1}&kind=logo&index=0`);
    ok("with no admin key on the server it is 503 not_configured",
       r.status === 503, String(r.status));
  }

  writeFileSync(adminKeyFile, "test-admin-key");

  console.log("\n── the admin view, configured ──");
  {
    const wrong = await fetch(`${BASE}?action=view&draftId=${id1}&kind=logo&index=0`,
      { headers: { "X-Media-Key": "not-the-key" } });
    ok("the wrong key is 403 bad_key", wrong.status === 403, String(wrong.status));

    const right = await fetch(`${BASE}?action=view&draftId=${id1}&kind=logo&index=0`,
      { headers: { "X-Media-Key": "test-admin-key" } });
    ok("the right key serves the file", right.status === 200, String(right.status));
    ok("with the same bytes that were uploaded",
       Buffer.from(await right.arrayBuffer()).equals(PNG_1PX));
    ok("as a real image content type", (right.headers.get("content-type") ?? "").startsWith("image/"),
       right.headers.get("content-type"));

    const missing = await fetch(`${BASE}?action=view&draftId=${draftId()}&kind=logo&index=0`,
      { headers: { "X-Media-Key": "test-admin-key" } });
    ok("a draft id nobody uploaded to is 404, not an error", missing.status === 404, String(missing.status));

    const traversalView = await fetch(`${BASE}?action=view&draftId=..%2F..%2Fetc&kind=logo&index=0`,
      { headers: { "X-Media-Key": "test-admin-key" } });
    ok("the view endpoint refuses a traversal draft id the same way the upload does",
       traversalView.status === 400, String(traversalView.status));
  }

  console.log("\n── prune ──");
  {
    const oldId = "old" + draftId();
    const freshId = "new" + draftId();
    const a = await upload({ draftId: oldId, kind: "logo", index: 0 });
    const b = await upload({ draftId: freshId, kind: "logo", index: 0 });
    if (a.status !== 200 || b.status !== 200) {
      throw new Error(`setup uploads for prune failed: ${JSON.stringify(a)} / ${JSON.stringify(b)}`);
    }
    // Back-date the old one's directory past PRUNE_AFTER_DAYS (14).
    const past = Date.now() / 1000 - 20 * 86400;
    utimesSync(join(pendingDir, oldId), past, past);

    // No HOME override needed: media.php's CLI storageDir() walks up from
    // wherever it is run, the same way serve mode does, and finds this
    // test's storage/ next to public_html the same way an install would.
    const dry = JSON.parse(
      execFileSync("php", [join(api, "media.php"), "prune", "--dry-run"], { encoding: "utf8" })
    );
    ok("dry-run names the old draft and not the fresh one",
       dry.removed.includes(oldId) && !dry.removed.includes(freshId), JSON.stringify(dry.removed));
    ok("and does not actually delete it", existsSync(join(pendingDir, oldId)));

    execFileSync("php", [join(api, "media.php"), "prune"], { encoding: "utf8" });
    ok("a real run removes the old draft directory", !existsSync(join(pendingDir, oldId)));
    ok("and leaves the fresh one alone", existsSync(join(pendingDir, freshId)));
  }

  // These two run LAST, deliberately: both leave the shared quota and the
  // per-IP rate counter used up, and every request in this file comes from
  // the same 127.0.0.1 — an upload after either section would be refused for
  // a reason that has nothing to do with what it is testing.
  console.log("\n── the quota, which bounds every visitor together ──");
  {
    // The test server was started with a 200KB quota (WAIN_MEDIA_MAX_TOTAL_BYTES),
    // and the uploads above already used some of it — filled the rest with an
    // upload just under the limit, then one more that must be refused.
    const id = draftId();
    const filler = Buffer.concat([PNG_1PX, Buffer.alloc(150 * 1024)]);
    const first = await upload({ draftId: id, kind: "photo", index: 0, bytes: filler });
    ok("an upload that still fits is accepted", first.status === 200, JSON.stringify(first.json));

    const second = await upload({ draftId: id, kind: "photo", index: 1, bytes: filler });
    ok("the one that would push the total over quota is 507",
       second.status === 507 && second.json?.error === "quota_exceeded", JSON.stringify(second.json));
  }

  console.log("\n── the rate limit, tripped for real ──");
  {
    const id = draftId();
    let last;
    for (let i = 0; i < 45; i++) {
      last = await upload({ draftId: id, kind: "photo", index: i % 11, bytes: Buffer.from("nope") });
    }
    ok("enough requests in a minute eventually gets 429",
       last.status === 429 && last.json?.error === "rate_limited", JSON.stringify(last.json));
  }

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) process.exitCode = 1;
} finally {
  php.kill();
  rmSync(dir, { recursive: true, force: true });
}
