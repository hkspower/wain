#!/usr/bin/env node
// Tests the panel against a stub upstream — no token, no network, no spend.
import http from "node:http";
import assert from "node:assert/strict";
import { createPanel, summary } from "./server.mjs";

const VM = {
  id: 2058651, hostname: "srv2058651.hstgr.cloud", plan: "KVM 4", state: "running",
  actions_lock: "unlocked", cpus: 4, memory: 16384, disk: 204800, billing_secret: "x",
  ipv4: [{ id: 1, address: "187.7.78.123", ptr: "x" }], template: { id: 1210, name: "Ubuntu 24.04" },
  created_at: "2026-10-13T12:18:51Z", ns1: "153.92.2.6", ssh_keys: ["secret"],
};

const calls = [];
const stub = http.createServer((req, res) => {
  calls.push(`${req.method} ${req.url} ${req.headers.authorization}`);
  if (req.url === "/virtual-machines") return res.end(JSON.stringify([VM]));
  if (req.url === "/virtual-machines/2058651") return res.end(JSON.stringify(VM));
  if (req.url === "/virtual-machines/2058651/restart") { res.writeHead(202); return res.end("{}"); }
  if (req.url === "/virtual-machines/999/start") { res.writeHead(404); return res.end(JSON.stringify({ message: "nope" })); }
  res.writeHead(500); res.end("{}");
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${stub.address().port}`;

const handler = createPanel({ token: "tok-123", apiBase: base });
const panel = http.createServer((req, res) => handler(req, res).catch(() => { res.writeHead(502); res.end("{}"); }));
await new Promise((r) => panel.listen(0, "127.0.0.1", r));
const p = `http://127.0.0.1:${panel.address().port}`;

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log("ok  ", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n     ", e.message); }
}

await check("constructor refuses an empty token", () => {
  assert.throws(() => createPanel({ token: "  " }), /not set/);
});

await check("page is served with a CSP and no-store", async () => {
  const r = await fetch(`${p}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(await r.text(), /لوحة الخوادم/);
});

await check("list returns only the safe fields and sends the bearer token", async () => {
  const r = await fetch(`${p}/api/vms`);
  const body = await r.json();
  assert.equal(body.vms.length, 1);
  const vm = body.vms[0];
  assert.equal(vm.hostname, "srv2058651.hstgr.cloud");
  assert.deepEqual(vm.ipv4, ["187.7.78.123"]);
  assert.equal("billing_secret" in vm, false);
  assert.equal("ssh_keys" in vm, false);
  assert.equal("ns1" in vm, false);
  assert.ok(calls.includes("GET /virtual-machines Bearer tok-123"));
  assert.equal(JSON.stringify(body).includes("tok-123"), false, "token must never reach the browser");
});

await check("detail returns the summary for one VM", async () => {
  const vm = await (await fetch(`${p}/api/vms/2058651`)).json();
  assert.deepEqual(vm, summary(VM));
});

await check("restart is proxied as POST and reports 202", async () => {
  const r = await fetch(`${p}/api/vms/2058651/restart`, { method: "POST" });
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { ok: true, action: "restart" });
  assert.ok(calls.includes("POST /virtual-machines/2058651/restart Bearer tok-123"));
});

await check("upstream error passes its status through", async () => {
  const r = await fetch(`${p}/api/vms/999/start`, { method: "POST" });
  assert.equal(r.status, 404);
});

await check("GET on an action is refused (no state change by link)", async () => {
  const r = await fetch(`${p}/api/vms/2058651/stop`);
  assert.equal(r.status, 405);
});

await check("destructive recreate is not exposed", async () => {
  const r = await fetch(`${p}/api/vms/2058651/recreate`, { method: "POST" });
  assert.equal(r.status, 404);
});

await check("non-numeric id is rejected before reaching upstream", async () => {
  const before = calls.length;
  const r = await fetch(`${p}/api/vms/..%2Fsecret`);
  assert.equal(r.status, 404);
  assert.equal(calls.length, before);
});

panel.close(); stub.close();
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
