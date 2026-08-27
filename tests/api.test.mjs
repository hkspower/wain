#!/usr/bin/env node
/**
 * server/api.php, against a real PHP server:  npm run test:api
 *
 * This file replaces one that lived only on wainkw.com — no copy in the
 * repository, no review, no tests. That is how five of its actions ended up
 * open to the internet over a database of orders. A rewrite that fixed those
 * holes and was itself never run would be the same mistake with newer code.
 *
 * So: PHP's own dev server, a scratch SQLite file, and every rule asserted
 * from the outside as a caller would meet it. The negative cases matter more
 * than the positive ones here — "an anonymous caller CANNOT do this" is the
 * entire point of the change, and it is the kind of claim that is very easy to
 * make and never check.
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4215;
const ORIGIN = "https://www.wainkw.com";
const TOKEN = "a-long-enough-admin-token-for-tests-0123456789";

// public_html/api.php, with the token file one level above it — the layout the
// rewrite assumes, and the reason the token is not fetchable over HTTP.
const dir = mkdtempSync(join(tmpdir(), "wain-api-"));
const web = join(dir, "public_html");
mkdirSync(web);
copyFileSync(join(ROOT, "server/api.php"), join(web, "api.php"));
const hash = execFileSync("php", ["-r", `echo password_hash(${JSON.stringify(TOKEN)}, PASSWORD_DEFAULT);`], { encoding: "utf8" });
writeFileSync(join(dir, "wain-admin.token"), hash);

const php = spawn("php", ["-S", `127.0.0.1:${PORT}`, "-t", web], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1200));

let pass = 0;
const fails = [];
const ok = (n, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? "\n      " + d : ""}`); } };

const BASE = `http://127.0.0.1:${PORT}/api.php`;
/** A call as the public site makes it: same-origin, no token. */
async function call(action, { method = "GET", body = null, token = null, origin = ORIGIN, query = "" } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (token) headers["X-Wain-Admin"] = token;
  let url = `${BASE}?a=${action}${query}`;
  const init = { method, headers };
  if (body !== null) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify({ a: action, ...body });
  }
  const res = await fetch(url, init);
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json, cors: res.headers.get("access-control-allow-origin") };
}

try {
  console.log("\n── it still answers, and says what it is ──");
  {
    const r = await call("ping");
    ok("ping works without a token", r.status === 200 && r.json?.ok === true, JSON.stringify(r.json));
    ok("and reports v3", r.json?.v === 3, String(r.json?.v));
  }

  console.log("\n── the public can still place an order ──");
  {
    const key = "orders:test-" + Date.now();
    const w = await call("set", { method: "POST", body: { k: key, v: '{"total":1500}' } });
    ok("an anonymous POST creates an orders: key", w.status === 200 && w.json?.ok === true, JSON.stringify(w.json));
    const r = await call("get", { query: `&k=${encodeURIComponent(key)}` });
    ok("and can read it back by exact key", r.json?.value === '{"total":1500}', JSON.stringify(r.json));
    globalThis.__key = key;
  }

  console.log("\n── but cannot rewrite one that already exists ──");
  {
    // The old upsert let anyone change an order's total after it was placed.
    const again = await call("set", { method: "POST", body: { k: globalThis.__key, v: '{"total":1}' } });
    ok("a second anonymous write is refused", again.status === 409, `${again.status} ${JSON.stringify(again.json)}`);
    ok("with a reason that names the fix", again.json?.error === "exists", JSON.stringify(again.json));
    const r = await call("get", { query: `&k=${encodeURIComponent(globalThis.__key)}` });
    ok("and the original value is untouched", r.json?.value === '{"total":1500}', JSON.stringify(r.json));
    const admin = await call("set", { method: "POST", token: TOKEN, body: { k: globalThis.__key, v: '{"total":1500,"status":"ready"}' } });
    ok("the shop, with the token, can update it", admin.status === 200, JSON.stringify(admin.json));
  }

  console.log("\n── and cannot write outside its own namespaces ──");
  {
    const r = await call("set", { method: "POST", body: { k: "menu:kuwait-towers", v: "x" } });
    ok("an anonymous write to menu: is refused", r.status === 403, `${r.status} ${JSON.stringify(r.json)}`);
    const r2 = await call("set", { method: "POST", body: { k: "bizidx", v: "x" } });
    ok("so is one to the business index", r2.status === 403, String(r2.status));
    const r3 = await call("set", { method: "POST", token: TOKEN, body: { k: "menu:kuwait-towers", v: "x" } });
    ok("the token opens it", r3.status === 200, JSON.stringify(r3.json));
  }

  console.log("\n── enumeration is closed ──");
  {
    // list?p=orders: used to hand every order key to anyone who asked.
    const r = await call("list", { query: "&p=orders:" });
    ok("an anonymous list is refused", r.status === 401, `${r.status} ${JSON.stringify(r.json)}`);
    ok("and returns no keys at all", r.json?.keys === undefined, JSON.stringify(r.json));
    const a = await call("list", { token: TOKEN, query: "&p=orders:" });
    ok("with the token it works", a.status === 200 && Array.isArray(a.json?.keys), JSON.stringify(a.json).slice(0, 80));
  }

  console.log("\n── deleting needs the token, and needs POST ──");
  {
    const g = await call("del", { query: `&k=${encodeURIComponent(globalThis.__key)}` });
    ok("del over GET is refused outright", g.status === 405, `${g.status} ${JSON.stringify(g.json)}`);
    const p = await call("del", { method: "POST", body: { k: globalThis.__key } });
    ok("del over POST without a token is refused", p.status === 401, String(p.status));
    const still = await call("get", { query: `&k=${encodeURIComponent(globalThis.__key)}` });
    ok("the key is still there after both attempts", still.status === 200, String(still.status));
    const a = await call("del", { method: "POST", token: TOKEN, body: { k: globalThis.__key } });
    ok("the token deletes it", a.status === 200 && a.json?.deleted === true, JSON.stringify(a.json));
  }

  console.log("\n── every admin action rejects an anonymous caller ──");
  {
    for (const [action, method] of [["stats","GET"],["search","GET"],["export","GET"],
                                    ["bulk","POST"],["import","POST"],["purge","POST"]]) {
      const r = await call(action, { method, body: method === "POST" ? {} : null, query: action === "search" ? "&q=x" : "" });
      ok(`${action} is refused`, r.status === 401, `${r.status} ${JSON.stringify(r.json)}`);
    }
  }

  console.log("\n── a wrong token is not a near miss ──");
  {
    const r = await call("stats", { token: "wrong-but-long-enough-to-pass-length" });
    ok("it is rejected", r.status === 401, String(r.status));
    ok("and named as invalid, not as too short", r.json?.error === "token-invalid", JSON.stringify(r.json));
    const short = await call("stats", { token: "short" });
    ok("a short token is named as short", short.json?.error === "token-short (24+)", JSON.stringify(short.json));
  }

  console.log("\n── another website cannot drive it from a browser ──");
  {
    const r = await call("ping", { origin: "https://evil.example" });
    ok("a foreign Origin is refused", r.status === 403, `${r.status} ${JSON.stringify(r.json)}`);
    const good = await call("ping", { origin: ORIGIN });
    ok("the site's own Origin is echoed back", good.cors === ORIGIN, String(good.cors));
    const none = await call("ping", { origin: null });
    ok("a caller with no Origin (curl, the server itself) still works", none.status === 200, String(none.status));
    ok("and gets no CORS header", none.cors === null, String(none.cors));
  }

  console.log("\n── the event log no longer stores an address ──");
  {
    await call("event", { method: "POST", body: { type: "test", data: { x: 1 } } });
    const r = await call("get", { token: TOKEN, query: "&k=events%3Alog" });
    const log = JSON.parse(r.json?.value ?? "[]");
    const last = log[log.length - 1];
    ok("the entry is written", last?.type === "test", JSON.stringify(last));
    ok("it carries no ip field", last && !("ip" in last), JSON.stringify(last));
    ok("but does distinguish callers by a hash", typeof last?.who === "string" && last.who.length === 12, JSON.stringify(last?.who));
    ok("which is not the address itself", last?.who !== "127.0.0.1", String(last?.who));
  }

  console.log("\n── an absent token file disables admin rather than granting it ──");
  {
    // The old code wrote a hash of whatever the next caller presented when the
    // file was missing, so deleting one file was a way in.
    rmSync(join(dir, "wain-admin.token"));
    const r = await call("stats", { token: "any-long-token-a-stranger-might-try" });
    ok("admin is refused", r.status === 503, `${r.status} ${JSON.stringify(r.json)}`);
    ok("and it says the server has no token set", r.json?.error === "token-unset", JSON.stringify(r.json));
    const after = await call("list", { token: "any-long-token-a-stranger-might-try", query: "&p=orders:" });
    ok("the stranger's token was not adopted", after.status === 503, String(after.status));
    writeFileSync(join(dir, "wain-admin.token"), hash);
  }

  console.log("\n── the public actions still work with no token file either ──");
  {
    const r = await call("ping");
    ok("ping is unaffected", r.status === 200, String(r.status));
    const w = await call("set", { method: "POST", body: { k: "rsvp:x" + Date.now(), v: "1" } });
    ok("and so is placing an rsvp", w.status === 200, JSON.stringify(w.json));
  }
} finally {
  php.kill();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
