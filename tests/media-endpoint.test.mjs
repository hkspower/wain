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
import { createHash } from "node:crypto";
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
  origin = ORIGIN, type = "image/png", headers: extra = {},
} = {}) {
  const form = new FormData();
  if (id !== undefined) form.set("draftId", id);
  if (kind !== undefined) form.set("kind", kind);
  if (index !== undefined) form.set("index", String(index));
  if (bytes !== null) form.set("file", new Blob([bytes], { type }), filename);
  const headers = { ...extra };
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

  /* The key the view tests send, 39 characters. A key under 32 characters is refused
     as weak before it is ever compared (the weak section below), so this fixture
     has to be longer than that: the 14-byte "test-admin-key" the view tests used
     before would now answer 503 weak to every assertion in this section. */
  const ADMIN_KEY = "test-admin-key-0123456789abcdefghijklmn";
  const viewAs = async (headers, draft = id1) => {
    const r = await fetch(`${BASE}?action=view&draftId=${draft}&kind=logo&index=0`, { headers });
    return { status: r.status, json: await r.json().catch(() => null) };
  };

  console.log("\n── the admin view, with a key too short to trust ──");
  {
    const WEAK_COUNTER = join(pendingDir, `.rate-${createHash("sha256").update("127.0.0.1").digest("hex")}.json`);
    const weakN = () => { try { return JSON.parse(readFileSync(WEAK_COUNTER, "utf8")).n; } catch { return 0; } };

    writeFileSync(adminKeyFile, "");
    const empty = await viewAs({ "X-Media-Key": "" });
    ok("an empty key file is still 503 not_configured",
       empty.status === 503 && empty.json?.error === "not_configured", JSON.stringify(empty));
    const beforeUnset = weakN();
    const unsetWrong = await viewAs({ "X-Media-Key": "not-the-key" });
    ok("with no key on the server a wrong key is 503 not_configured, and counted like any guess",
       unsetWrong.status === 503 && unsetWrong.json?.error === "not_configured" && weakN() === beforeUnset + 1,
       `${JSON.stringify(unsetWrong)} ${beforeUnset} -> ${weakN()}`);

    writeFileSync(adminKeyFile, "0123456789abcdef");   // 16 characters
    const short = await viewAs({ "X-Media-Key": "0123456789abcdef" });
    ok("a 16-character key is 503 weak, even when the right key is sent",
       short.status === 503 && short.json?.error === "weak", JSON.stringify(short));
    const beforeShort = weakN();
    const shortWrong = await viewAs({ "X-Media-Key": "not-the-key" });
    ok("and 503 weak for a wrong key too: the length is checked before any comparison",
       shortWrong.status === 503 && shortWrong.json?.error === "weak", JSON.stringify(shortWrong));
    ok("and that wrong key is counted while the key is weak, as wain-api counts one under a weak secret",
       weakN() === beforeShort + 1, `${beforeShort} -> ${weakN()}`);
    const CAP = Number((readFileSync(new URL("../scripts/publish/media-endpoint.php", import.meta.url), "utf8")
      .match(/const RATE_PER_MIN = (\d+);/) ?? [])[1]);
    writeFileSync(WEAK_COUNTER, JSON.stringify({ start: Math.floor(Date.now() / 1000), n: CAP }));
    const tw = Date.now();
    const over = await viewAs({ "X-Media-Key": "not-the-key" });
    const overMs = Date.now() - tw;
    ok("past the cap, a wrong key under a weak key is 429 rate_limited after the quarter-second wait",
       over.status === 429 && over.json?.error === "rate_limited" && overMs >= 200, `${JSON.stringify(over)} ${overMs} ms`);
    rmSync(WEAK_COUNTER, { force: true });

    const k31 = "0123456789abcdef0123456789abcde";   // 31 characters
    writeFileSync(adminKeyFile, k31);
    const thirtyOne = await viewAs({ "X-Media-Key": k31 });
    ok("a 31-character key is still refused as weak",
       thirtyOne.status === 503 && thirtyOne.json?.error === "weak", JSON.stringify(thirtyOne));

    const k32 = "0123456789abcdef0123456789abcdef";   // 32 characters: the floor itself
    writeFileSync(adminKeyFile, k32);
    const thirtyTwo = await viewAs({ "X-Media-Key": "not-the-key" });
    ok("a 32-character key reaches the comparison: a wrong key is 403 bad_key",
       thirtyTwo.status === 403 && thirtyTwo.json?.error === "bad_key", JSON.stringify(thirtyTwo));
    const thirtyTwoRight = await viewAs({ "X-Media-Key": k32 });
    ok("and the same key, sent right, is served", thirtyTwoRight.status === 200, String(thirtyTwoRight.status));

    /* Sixteen Arabic letters are 32 bytes and 16 characters, so the floor refuses
       them; thirty-two letters are 32 characters and reach the comparison. */
    writeFileSync(adminKeyFile, "ب".repeat(16));
    const arShort = await viewAs({ "X-Media-Key": "not-the-key" });
    ok("16 Arabic letters (32 bytes) are 16 characters: refused as weak",
       arShort.status === 503 && arShort.json?.error === "weak", JSON.stringify(arShort));
    writeFileSync(adminKeyFile, "ب".repeat(32));
    const arLong = await viewAs({ "X-Media-Key": "not-the-key" });
    ok("32 Arabic letters are 32 characters: a wrong key reaches the comparison",
       arLong.status === 403 && arLong.json?.error === "bad_key", JSON.stringify(arLong));
    writeFileSync(adminKeyFile, k32);

    /* `version` is the report an owner reads, so it must say what the view will do:
       a key the view answers 503 weak to is reported as weak, not as present. */
    const reportedKey = () => JSON.parse(
      execFileSync("php", [join(api, "media.php"), "version"], { encoding: "utf8" })).adminKey;
    writeFileSync(adminKeyFile, "0123456789abcdef");
    ok("version reports a 16-character key as weak, the state the view refuses",
       reportedKey() === "weak", String(reportedKey()));
    writeFileSync(adminKeyFile, k32);
    ok("version reports a 32-character key as present", reportedKey() === "present", String(reportedKey()));
    writeFileSync(adminKeyFile, "");
    ok("and an empty file is still EMPTY, the installer's own state", reportedKey() === "EMPTY", String(reportedKey()));
  }

  writeFileSync(adminKeyFile, ADMIN_KEY);

  console.log("\n── the admin view, configured ──");
  {
    const wrong = await fetch(`${BASE}?action=view&draftId=${id1}&kind=logo&index=0`,
      { headers: { "X-Media-Key": "not-the-key" } });
    ok("the wrong key is 403 bad_key", wrong.status === 403, String(wrong.status));

    const right = await fetch(`${BASE}?action=view&draftId=${id1}&kind=logo&index=0`,
      { headers: { "X-Media-Key": ADMIN_KEY } });
    ok("the right key serves the file", right.status === 200, String(right.status));
    ok("with the same bytes that were uploaded",
       Buffer.from(await right.arrayBuffer()).equals(PNG_1PX));
    ok("as a real image content type", (right.headers.get("content-type") ?? "").startsWith("image/"),
       right.headers.get("content-type"));

    const missing = await fetch(`${BASE}?action=view&draftId=${draftId()}&kind=logo&index=0`,
      { headers: { "X-Media-Key": ADMIN_KEY } });
    ok("a draft id nobody uploaded to is 404, not an error", missing.status === 404, String(missing.status));

    const traversalView = await fetch(`${BASE}?action=view&draftId=..%2F..%2Fetc&kind=logo&index=0`,
      { headers: { "X-Media-Key": ADMIN_KEY } });
    ok("the view endpoint refuses a traversal draft id the same way the upload does",
       traversalView.status === 400, String(traversalView.status));
  }

  console.log("\n── the admin view, throttled per visitor ──");
  {
    const sha = (s) => createHash("sha256").update(s).digest("hex");
    const trusted = join(storage, "trusted-proxies.txt");
    const bucketOf = (ip) => join(pendingDir, `.rate-${sha(ip)}.json`);
    const nOf = (f) => { try { return JSON.parse(readFileSync(f, "utf8")).n; } catch { return null; } };
    /* The cap is read from the endpoint's own source, so this section cannot pass
       against a number the endpoint no longer uses. */
    const cap = Number((readFileSync(new URL("../scripts/publish/media-endpoint.php", import.meta.url), "utf8")
      .match(/const RATE_PER_MIN = (\d+);/) ?? [])[1]);
    const VISITOR = "192.0.2.10";
    const wrongFor = (ip) => ({ "X-Media-Key": "not-the-key", "X-Forwarded-For": ip });
    const rightFor = (ip) => ({ "X-Media-Key": ADMIN_KEY, "X-Forwarded-For": ip });

    /* Every connection in this file comes from 127.0.0.1. Listing that address as a
       proxy lets the X-Forwarded-For header name a different visitor for each
       group of requests below, so each visitor gets a bucket of their own. The
       list is removed again before the no-list check at the end of this section. */
    writeFileSync(trusted, "127.0.0.1\n");

    ok("the cap is readable from the endpoint's source (RATE_PER_MIN)",
       Number.isInteger(cap) && cap > 0, String(cap));
    const codes = [];
    let firstMs = 0;
    for (let i = 0; i < cap; i++) {
      const t = Date.now();
      codes.push((await viewAs(wrongFor(VISITOR))).status);
      if (i === 0) firstMs = Date.now() - t;
    }
    ok(`the first ${cap} wrong keys from one visitor are 403 bad_key`,
       codes.length === cap && codes.every((c) => c === 403), JSON.stringify(codes));
    /* A guess that costs nothing is a guess the cap does not slow down: before this
       the answer came back in milliseconds, and the cap changed only its status code. */
    ok("a wrong key within the cap costs a quarter second, as the admin path's does",
       firstMs >= 200, `${firstMs} ms`);

    const past = await viewAs(wrongFor(VISITOR));
    ok("the wrong key one past the cap is 429 rate_limited",
       past.status === 429 && past.json?.error === "rate_limited", JSON.stringify(past));
    ok("every wrong key is counted in the visitor's own bucket: the cap plus one",
       nOf(bucketOf(VISITOR)) === cap + 1, `n=${nOf(bucketOf(VISITOR))}`);

    const right = await viewAs(rightFor(VISITOR));
    ok("once capped, the right key is still served to the same visitor",
       past.status === 429 && right.status === 200, `past=${past.status} right=${right.status}`);
    ok("and a right key is never counted against that bucket",
       nOf(bucketOf(VISITOR)) === cap + 1, `n=${nOf(bucketOf(VISITOR))}`);

    /* Past the cap the request ends at the key: a draft id that would be a 400
       is not looked at, so the answer is the 429 and nothing else. */
    const pastBadDraft = await viewAs(wrongFor(VISITOR), "..%2F..%2Fetc");
    ok("past the cap nothing beyond the key is looked at: a bad draft id still gets 429",
       pastBadDraft.status === 429, String(pastBadDraft.status));

    const uploadCapped = await upload({ draftId: draftId(), headers: { "X-Forwarded-For": VISITOR } });
    ok("the same visitor's uploads are refused too: one allowance a minute, shared with the view",
       uploadCapped.status === 429 && uploadCapped.json?.error === "rate_limited", JSON.stringify(uploadCapped.json));

    const other = await viewAs(wrongFor("192.0.2.11"));
    ok("another visitor is not capped by this one",
       other.status === 403 && other.json?.error === "bad_key", JSON.stringify(other));

    const bare = await viewAs({ "X-Forwarded-For": "192.0.2.12" });
    ok("a request with no key header at all is a wrong key, and is counted",
       bare.status === 403 && nOf(bucketOf("192.0.2.12")) === 1, `${bare.status} n=${nOf(bucketOf("192.0.2.12"))}`);

    rmSync(trusted);
    const before = nOf(bucketOf("127.0.0.1")) ?? 0;
    const spoof = await viewAs(wrongFor("192.0.2.13"));
    ok("with no list the header is ignored here too: the connecting address is the one counted",
       spoof.status === 403 && (nOf(bucketOf("127.0.0.1")) ?? 0) === before + 1 && nOf(bucketOf("192.0.2.13")) === null,
       `${spoof.status} before=${before} after=${nOf(bucketOf("127.0.0.1"))}`);

    /* A directory at a visitor's counter path makes the counter unopenable. The limit
       must not switch off with it: a wrong key from that visitor is refused, while the
       right key, which is never counted, is still served. */
    writeFileSync(trusted, "127.0.0.1\n");
    const BROKEN = "192.0.2.50";
    mkdirSync(bucketOf(BROKEN));
    const broken = await viewAs(wrongFor(BROKEN));
    ok("a wrong key whose counter cannot be opened is 503 limiter_unavailable, not a free guess",
       broken.status === 503 && broken.json?.error === "limiter_unavailable", JSON.stringify(broken));
    const brokenRight = await viewAs(rightFor(BROKEN));
    ok("the right key is still served from that visitor: a right key does not use its counter",
       brokenRight.status === 200, String(brokenRight.status));
    rmSync(bucketOf(BROKEN), { recursive: true, force: true });
    rmSync(trusted);
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

  console.log("\n── the log says what arrived, and nothing about whose it is ──");
  {
    /* This endpoint receives photographs of somebody's shop before anyone has
       reviewed them, so what the log leaves OUT matters more here than on the
       voice bridge. `audit:logs` checks both files promise the same things;
       these assertions are what hold this one to it. */
    const logFile = join(storage, "logs", "media.log");
    const read = () => (existsSync(logFile) ? readFileSync(logFile, "utf8") : "");

    rmSync(join(storage, "logs"), { recursive: true, force: true });
    const id = "11111111-2222-4333-8444-555555555555";
    const telling = "شعار-محل-فلان-الخاص.png";
    const r = await upload({ draftId: id, kind: "logo", filename: telling });
    ok("an accepted upload is recorded", r.status === 200 && /\bmedia ok\b/.test(read()), read().trim());

    ok("with what the bytes ARE and how big", /\btype=png\b/.test(read()) && /\bbytes=\d+\b/.test(read()),
      read().trim());
    /* The name is attacker-controlled and the visitor's; getimagesize has
       already decided what the file is, which is the only fact worth keeping. */
    ok("but never the filename the browser sent", !read().includes("شعار") && !read().includes(telling));
    ok("and never the address it came from",
      !read().includes("127.0.0.1") && /\bip=[0-9a-f]{8}\b/.test(read()), read().trim());
    ok("the draft is a short prefix, not the whole id", !read().includes(id) && /\bdraft=\w{8}\b/.test(read()),
      read().trim());

    /* The one number that answers «is the disk filling up» — nothing else on
       this account would say so until a write failed. */
    ok("the running total is on the line", /\btotal=\d+\b/.test(read()), read().trim());

    const shape = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z media \S+( \S+=\S*)*$/;
    ok("every line keeps the documented shape",
      read().trim().split("\n").every((l) => shape.test(l)), read().trim());

    // A refusal is the more interesting line: it is how anyone would learn
    // that something is being rejected in a loop.
    rmSync(join(storage, "logs"), { recursive: true, force: true });
    const bad = await upload({ draftId: id, bytes: Buffer.from("not an image at all") });
    ok("a refusal is recorded with its reason",
      bad.status === 400 && /\bmedia 400\b/.test(read()) && read().includes("why=bad_type"), read().trim());
  }

  console.log("\n── it cannot grow for ever either ──");
  {
    const logFile = join(storage, "logs", "media.log");
    const fmt = JSON.parse(
      execFileSync("php", [join(api, "media.php"), "logformat"], { encoding: "utf8" })
    );
    writeFileSync(logFile, "x".repeat(fmt.maxBytes + 1));
    await upload({ draftId: "99999999-2222-4333-8444-555555555555" });

    ok("a full log is rotated aside", existsSync(`${logFile}.1`));
    ok("and the live one starts again, small",
      readFileSync(logFile, "utf8").length < 4096, String(readFileSync(logFile, "utf8").length));

    const tail = JSON.parse(
      execFileSync("php", [join(api, "media.php"), "log", "5"], { encoding: "utf8" })
    );
    ok("`log` reads it back", tail.ok === true && Array.isArray(tail.tail) && tail.tail.length > 0,
      JSON.stringify(tail).slice(0, 160));
    ok("and says a rotation has happened", tail.rotated === true);
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

  console.log("\n── behind a proxy: the header is believed only from a proxy the operator listed ──");
  {
    /* This server sees every request from 127.0.0.1 — what a reverse proxy in
       front looks like to PHP. That address has just been rate-limited. */
    const sha = (s) => createHash("sha256").update(s).digest("hex");
    const limiter = (ip) => join(pendingDir, `.rate-${sha(ip)}.json`);
    const trusted = join(storage, "trusted-proxies.txt");
    const fwd = (xff) => upload({ draftId: draftId(), headers: { "X-Forwarded-For": xff } });

    const again = await upload({ draftId: draftId() });
    ok("control: with no header the proxy's own bucket is still capped", again.status === 429, String(again.status));
    ok("with NO list the header is not believed (off by default)",
      !existsSync(trusted) && (await fwd("203.0.113.7")).status === 429 && !existsSync(limiter("203.0.113.7")));
    writeFileSync(trusted, "172.18.0.0/16\n");
    ok("a list that does not name this peer: the header is still not believed",
      (await fwd("203.0.113.7")).status === 429 && !existsSync(limiter("203.0.113.7")));

    writeFileSync(trusted, "# the proxy\n127.0.0.1\n");
    const via = await fwd("198.51.100.1, 203.0.113.7");
    ok("once the peer is listed, a visitor behind it is not caught by the proxy's cap", via.status !== 429, JSON.stringify(via.json));
    ok("their limiter is named for the forwarded address, not the proxy or a client-typed prefix",
      existsSync(limiter("203.0.113.7")) && !existsSync(limiter("198.51.100.1")));
    const log = readFileSync(join(storage, "logs", "media.log"), "utf8");
    ok("the log carries the forwarded visitor's hash, not the raw address",
      log.includes(`ip=${sha("203.0.113.7").slice(0, 8)}`) && !log.includes("203.0.113.7"));
    rmSync(trusted);
  }

  console.log("\n── behind a proxy: an IPv6 visitor is counted per /64, and the counters are swept ──");
  {
    /* A visitor on one IPv6 /64 can use a new address for every request, so a
       counter per address is no counter at all. Both addresses below must share
       one file, filed under the /64 and under neither address. The sweep: a
       counter nobody has written for an hour is deleted. The clock for it is
       .swept, which is removed here so that this request runs one. */
    const sha = (s) => createHash("sha256").update(s).digest("hex");
    const trusted = join(storage, "trusted-proxies.txt");
    const counterOf = (key) => join(pendingDir, `.rate-${sha(key)}.json`);
    const nOf = (f) => { try { return JSON.parse(readFileSync(f, "utf8")).n; } catch { return null; } };
    const fwd = (xff) => upload({ draftId: draftId(), headers: { "X-Forwarded-For": xff } });

    writeFileSync(trusted, "127.0.0.1\n");
    await fwd("2001:db8:1:2::5");
    await fwd("2001:db8:1:2::9");
    ok("both addresses in one /64 share one counter, filed under the /64",
      nOf(counterOf("2001:db8:1:2::/64")) === 2, `n=${nOf(counterOf("2001:db8:1:2::/64"))}`);
    ok("and neither address got a counter of its own",
      !existsSync(counterOf("2001:db8:1:2::5")) && !existsSync(counterOf("2001:db8:1:2::9")));
    await fwd("2001:db8:1:3::5");
    ok("another /64 is another visitor", nOf(counterOf("2001:db8:1:3::/64")) === 1);
    rmSync(trusted);

    const stale = counterOf("198.51.100.200");
    const live = counterOf("198.51.100.201");
    writeFileSync(stale, JSON.stringify({ start: 1, n: 1 }));
    writeFileSync(live, JSON.stringify({ start: 1, n: 1 }));
    const old = new Date(Date.now() - 2 * 3600 * 1000);
    utimesSync(stale, old, old);
    rmSync(join(pendingDir, ".swept"), { force: true });
    await upload({ draftId: draftId() });
    ok("a counter untouched for an hour is swept by the next request", !existsSync(stale));
    ok("a counter written recently is kept", existsSync(live));
    ok("and the sweep stamps its clock", existsSync(join(pendingDir, ".swept")));
  }

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) process.exitCode = 1;
} finally {
  php.kill();
  rmSync(dir, { recursive: true, force: true });
}
