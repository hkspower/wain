// The hub's /admin sign-in, attacked.
//
//   npm run test:hubadmin        (starts its own hubs on spare ports)
//
// The operator panel used to answer anyone who could reach the hub. What
// has to be true now, each one tried rather than read off the code:
//
//   closed      without a session: the page is the sign-in form, and every
//               /api/v1/admin route answers 401; no admin route grants CORS
//   no hints    a wrong password and an unknown name fail the same way
//   cookie      HttpOnly, SameSite=Strict, Path=/, and only what a browser
//               needs; the token is never in a body or the audit log
//   csrf        every write needs the session's token and a same-origin (or
//               absent) Origin, or the browser's own Sec-Fetch-Site saying
//               same-origin; cross-origin sign-in is refused
//   roles       viewer reads, operator also manages proposals, owner also
//               manages accounts and reads the audit log; nothing more
//   last owner  cannot be demoted, disabled or deleted; nobody deletes
//               themselves
//   revocation  disabling an account, changing its role or its password ends
//               its sessions; sign-out ends the session; idle sessions expire;
//               a change made with the CLI while the hub runs is picked up
//   lockout     5 wrong passwords lock the account, 20 failures lock the
//               address, even for the right password, with Retry-After
//   at rest     no plaintext password anywhere; account files are 0600
//   untouched   the game's own endpoints answer exactly as before
//   a browser   and it all still works for the person it is for: a real
//               Chromium signs in, sees the dashboard fill, queues a part,
//               adds an account, changes its password and signs out, under
//               the panel's own CSP, with nothing in the console
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createAdminAuth } from "../server/admin-auth.mjs";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return !!c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), "grn-hubadmin-"));
const hubs = [];

const PW = { owner: "owner-pass-0001", op: "operator-pass-02", view: "viewer-pass-003" };

async function seed(prefix) {
  const accountsPath = join(dir, `${prefix}-admins.json`);
  const auditPath = join(dir, `${prefix}-audit.json`);
  const auth = createAdminAuth({ accountsPath, auditPath });
  for (const [username, role, password] of [["owner1", "owner", PW.owner], ["op1", "operator", PW.op], ["view1", "viewer", PW.view]]) {
    const r = await auth.createAccount({ username, password, role, by: "test" });
    if (r.error) throw new Error(r.error);
  }
  auth.flush();
  return { accountsPath, auditPath };
}

async function startHub(port, env) {
  const hub = spawn(process.execPath, ["server/hub-server.mjs"], {
    env: { ...process.env, HUB_PORT: String(port), HUB_LEDGER: join(dir, `ledger-${port}.json`), HUB_PART_PROPOSALS: join(dir, `parts-${port}.json`), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  hub.stdout.on("data", (d) => { log += d; });
  hub.stderr.on("data", (d) => { log += d; });
  hubs.push({ hub, log: () => log });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/v1/status`)).ok) return base; } catch {}
    await sleep(100);
  }
  throw new Error(`hub on ${port} did not start:\n${log}`);
}

function finish() {
  for (const h of hubs) try { h.hub.kill(); } catch {}
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  if (fail.length) {
    console.log(`\n${fail.length} problem(s):`);
    for (const f of fail) console.log("  - " + f);
    if (process.env.HUB_LOG) for (const h of hubs) console.error(h.log());
    process.exit(1);
  }
  console.log("\nthe admin panel lets in exactly who it should, and no one else");
  process.exit(0);
}
process.on("uncaughtException", (e) => { fail.push(`crashed: ${e.stack}`); finish(); });

/** Sign in; returns {cookie, csrf, res}. */
async function signIn(base, username, password, { form = false, origin } = {}) {
  const headers = form ? { "Content-Type": "application/x-www-form-urlencoded" } : { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  const body = form ? new URLSearchParams({ username, password }).toString() : JSON.stringify({ username, password });
  const res = await fetch(`${base}/admin/login`, { method: "POST", headers, body, redirect: "manual" });
  const set = res.headers.get("set-cookie") ?? "";
  const cookie = set.split(";")[0];
  let csrf = null;
  if (!form && res.ok) csrf = (await res.json()).csrf;
  return { res, set, cookie, csrf };
}

function as(base, s) {
  return (path, method = "GET", body, extra = {}) =>
    fetch(`${base}${path}`, {
      method,
      redirect: "manual",
      headers: {
        Cookie: s.cookie,
        ...(method !== "GET" ? { "X-CSRF-Token": s.csrf } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extra,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
}

const PART = { id: "paint-test-navy", cat: "paint", name: "Test Navy", ar: "كحلي تجريبي", price: 900, desc: "a test proposal" };

// =====================================================================
// Hub A: the main run.
const A = await seed("a");
const base = await startHub(8931, { HUB_ADMINS: A.accountsPath, HUB_ADMIN_AUDIT: A.auditPath });

// --- closed without a session
{
  const page = await fetch(`${base}/admin`);
  const html = await page.text();
  check(page.status === 200 && html.includes('action="/admin/login"'), "GET /admin without a session should be the sign-in form");
  check(!html.includes("Pending proposals"), "the dashboard leaked to a signed-out visitor");
  const csp = page.headers.get("content-security-policy") ?? "";
  check(/script-src 'nonce-[A-Za-z0-9+/=]+'/.test(csp) && csp.includes("frame-ancestors 'none'"), `weak CSP on /admin: ${csp}`);
  check(page.headers.get("x-frame-options") === "DENY", "/admin can be framed");
  check(page.headers.get("cache-control") === "no-store", "/admin is cacheable");
  for (const [m, p] of [["GET", "/api/v1/admin/parts"], ["POST", "/api/v1/admin/parts"], ["DELETE", "/api/v1/admin/parts/1"], ["GET", "/api/v1/admin/accounts"], ["GET", "/api/v1/admin/audit"], ["GET", "/api/v1/admin/me"]]) {
    const r = await fetch(`${base}${p}`, { method: m, headers: { "Content-Type": "application/json" }, body: m === "POST" ? JSON.stringify(PART) : undefined });
    check(r.status === 401, `${m} ${p} without a session answered ${r.status}, not 401`);
    check(!r.headers.get("access-control-allow-origin"), `${m} ${p} grants CORS`);
  }
  const pre = await fetch(`${base}/api/v1/admin/parts`, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
  check(!pre.headers.get("access-control-allow-origin"), "a cross-origin preflight to an admin route got a CORS grant");
  console.log("closed: sign-in page, 401 on every admin route, no CORS, strict headers");
}

// --- no hints, and the cookie
{
  const t0 = Date.now();
  const wrong = await signIn(base, "owner1", "not-the-password");
  const t1 = Date.now();
  const nobody = await signIn(base, "nobody-here", "not-the-password");
  const t2 = Date.now();
  const wj = await wrong.res.json(), nj = await nobody.res.json();
  check(wrong.res.status === 401 && nobody.res.status === 401, "a failed sign-in should be 401");
  check(wj.error === nj.error, `a wrong password and an unknown name answer differently: "${wj.error}" / "${nj.error}"`);
  check(t2 - t1 > (t1 - t0) * 0.3, `an unknown name answers much faster than a wrong password (${t2 - t1} vs ${t1 - t0} ms): it should be hashed too`);
  check(!wrong.set && !nobody.set, "a failed sign-in set a cookie");

  const ok = await signIn(base, "owner1", PW.owner, { form: true });
  check(ok.res.status === 303 && ok.res.headers.get("location") === "/admin", `a form sign-in should redirect to /admin, got ${ok.res.status}`);
  check(/HttpOnly/i.test(ok.set) && /SameSite=Strict/i.test(ok.set) && /Path=\//.test(ok.set), `weak session cookie: ${ok.set}`);
  check(!/Secure/i.test(ok.set), "Secure was set on a plain-http hub with no proxy (the browser would drop it)");
  const dash = await fetch(`${base}/admin`, { headers: { Cookie: ok.cookie } });
  const html = await dash.text();
  check(html.includes("owner1") && html.includes("Operator accounts") && html.includes("Audit log"), "the owner's dashboard is missing its accounts or audit panel");
  check(!/onclick=/i.test(html), "the dashboard uses inline event handlers, which its own CSP blocks");
  const evil = await signIn(base, "owner1", PW.owner, { origin: "https://evil.example" });
  check(evil.res.status === 403 && !evil.set, "a cross-origin sign-in was accepted");
  console.log("no hints, a strict cookie, cross-origin sign-in refused");
}

const owner = await signIn(base, "owner1", PW.owner);
const op = await signIn(base, "op1", PW.op);
const view = await signIn(base, "view1", PW.view);
check(owner.csrf && op.csrf && view.csrf, "a JSON sign-in should return the session's CSRF token");
const O = as(base, owner), P = as(base, op), V = as(base, view);

// --- csrf
{
  const noTok = await fetch(`${base}/api/v1/admin/parts`, { method: "POST", headers: { Cookie: op.cookie, "Content-Type": "application/json" }, body: JSON.stringify(PART) });
  check(noTok.status === 403, `a write with no CSRF token answered ${noTok.status}`);
  const badTok = await P("/api/v1/admin/parts", "POST", PART, { "X-CSRF-Token": "x".repeat(43) });
  check(badTok.status === 403, `a write with the wrong CSRF token answered ${badTok.status}`);
  const otherTok = await P("/api/v1/admin/parts", "POST", PART, { "X-CSRF-Token": view.csrf });
  check(otherTok.status === 403, "another session's CSRF token was accepted");
  const evil = await P("/api/v1/admin/parts", "POST", PART, { Origin: "https://evil.example" });
  check(evil.status === 403, `a write from a foreign Origin answered ${evil.status}`);
  const nul = await P("/api/v1/admin/parts", "POST", PART, { Origin: "null" });
  check(nul.status === 403, `a write from Origin: null (a sandboxed frame) answered ${nul.status}`);
  for (const site of ["cross-site", "same-site"]) {
    const r = await P("/api/v1/admin/parts", "POST", PART, { "Sec-Fetch-Site": site, Origin: base });
    check(r.status === 403, `a write the browser marked ${site} answered ${r.status}`);
  }
  const ss = await signIn(base, "owner1", PW.owner, { origin: "null" });
  check(ss.res.status === 403, `a sign-in from Origin: null answered ${ss.res.status}`);
  // What Chromium sends from the panel itself: trusted, whatever Origin says.
  const own = await P("/api/v1/admin/parts", "POST", { ...PART, id: "paint-test-own" }, { "Sec-Fetch-Site": "same-origin", Origin: "null" });
  check(own.status === 200, `a write the browser marked same-origin was refused (${own.status})`);
  if (own.status === 200) await P(`/api/v1/admin/parts/${(await own.json()).proposal.proposalId}`, "DELETE");
  console.log("csrf: no token, a wrong token, another session's token, a foreign or null Origin and a cross-site fetch are all refused");
}

// --- roles
{
  check((await V("/api/v1/admin/parts")).status === 200, "a viewer cannot read proposals");
  check((await V("/api/v1/admin/parts", "POST", PART)).status === 403, "a viewer queued a proposal");
  check((await V("/api/v1/admin/accounts")).status === 403, "a viewer listed accounts");
  check((await V("/api/v1/admin/audit")).status === 403, "a viewer read the audit log");
  const q = await P("/api/v1/admin/parts", "POST", PART);
  check(q.status === 200, `an operator could not queue a proposal (${q.status})`);
  const qid = (await q.json()).proposal?.proposalId;
  check((await P("/api/v1/admin/accounts")).status === 403, "an operator listed accounts");
  check((await P("/api/v1/admin/accounts", "POST", { username: "sneaky", password: "sneaky-pass-0001", role: "owner" })).status === 403, "an operator created an account");
  check((await P(`/api/v1/admin/accounts/op1`, "PATCH", { role: "owner" })).status === 403, "an operator promoted themselves");
  check((await P("/api/v1/admin/audit")).status === 403, "an operator read the audit log");
  check((await P(`/api/v1/admin/parts/${qid}`, "DELETE")).status === 200, "an operator could not reject a proposal");
  const vpage = await (await fetch(`${base}/admin`, { headers: { Cookie: view.cookie } })).text();
  check(!vpage.includes("Propose a new part") && !vpage.includes("Operator accounts"), "a viewer's dashboard shows controls it cannot use");
  console.log("roles: viewer reads; operator also manages proposals; only the owner manages accounts and reads the audit");
}

// --- accounts, last owner, revocation
{
  const list = await (await O("/api/v1/admin/accounts")).json();
  check(Array.isArray(list.accounts) && list.accounts.length === 3, "the owner should see three accounts");
  check(!JSON.stringify(list).match(/salt|hash|password/i), "the account list leaks password material");
  check((await O("/api/v1/admin/accounts", "POST", { username: "new1", password: "short", role: "viewer" })).status === 400, "a short password was accepted");
  check((await O("/api/v1/admin/accounts", "POST", { username: "new1", password: "new1-is-in-here!", role: "viewer" })).status === 400, "a password containing the username was accepted");
  check((await O("/api/v1/admin/accounts", "POST", { username: "<script>", password: "a-fine-password-1", role: "viewer" })).status === 400, "a username with markup was accepted");
  check((await O("/api/v1/admin/accounts", "POST", { username: "new1", password: "a-fine-password-1", role: "superuser" })).status === 400, "an unknown role was accepted");
  check((await O("/api/v1/admin/accounts", "POST", { username: "new1", password: "a-fine-password-1", role: "viewer" })).status === 200, "the owner could not add an account");
  check((await O("/api/v1/admin/accounts", "POST", { username: "NEW1", password: "a-fine-password-2", role: "viewer" })).status === 400, "a duplicate (differently cased) username was accepted");

  check((await O("/api/v1/admin/accounts/owner1", "PATCH", { role: "viewer" })).status === 409, "the last owner demoted themselves");
  check((await O("/api/v1/admin/accounts/owner1", "PATCH", { disabled: true })).status === 409, "the last owner disabled themselves");
  check((await O("/api/v1/admin/accounts/owner1", "DELETE")).status === 409, "the owner deleted their own account");

  // Role change ends the viewer's session; disabling ends the operator's.
  check((await O("/api/v1/admin/accounts/view1", "PATCH", { role: "operator" })).status === 200, "the owner could not change a role");
  check((await V("/api/v1/admin/parts")).status === 401, "a session survived its account's role change");
  check((await O("/api/v1/admin/accounts/op1", "PATCH", { disabled: true })).status === 200, "the owner could not disable an account");
  check((await P("/api/v1/admin/parts")).status === 401, "a session survived its account being disabled");
  const disabled = await signIn(base, "op1", PW.op);
  check(disabled.res.status === 401, "a disabled account could sign in");
  check((await O("/api/v1/admin/accounts/op1", "PATCH", { disabled: false })).status === 200, "the owner could not re-enable an account");
  console.log("accounts: validated, the last owner protected, sessions ended on role change and disable");
}

// --- password change and sign-out
{
  const second = await signIn(base, "owner1", PW.owner);
  const O2 = as(base, second);
  check((await O("/api/v1/admin/password", "POST", { current: "wrong-current-pw", next: "owner-pass-0002" })).status === 403, "a password change with the wrong current password was accepted");
  check((await O("/api/v1/admin/password", "POST", { current: PW.owner, next: "owner-pass-0002" })).status === 200, "the owner could not change their password");
  check((await O("/api/v1/admin/me")).status === 200, "a password change signed out the session that made it");
  check((await O2("/api/v1/admin/me")).status === 401, "a password change left the account's other sessions signed in");
  check((await signIn(base, "owner1", PW.owner)).res.status === 401, "the old password still works");
  const fresh = await signIn(base, "owner1", "owner-pass-0002");
  check(fresh.res.status === 200, "the new password does not work");
  const F = as(base, fresh);
  const outNoTok = await fetch(`${base}/admin/logout`, { method: "POST", headers: { Cookie: fresh.cookie }, redirect: "manual" });
  check((await F("/api/v1/admin/me")).status === 200, "sign-out without the CSRF token ended the session (a cross-site page could sign you out)");
  check(/Max-Age=0/.test(outNoTok.headers.get("set-cookie") ?? ""), "sign-out did not clear the cookie");
  const out = await fetch(`${base}/admin/logout`, { method: "POST", headers: { Cookie: fresh.cookie, "X-CSRF-Token": fresh.csrf, Accept: "application/json" } });
  check(out.status === 200, "sign-out failed");
  check((await F("/api/v1/admin/me")).status === 401, "the session survived sign-out");
  console.log("password change ends the other sessions; sign-out ends the session");
}

// --- the CLI, while the hub runs
{
  const s = await signIn(base, "new1", "a-fine-password-1");
  const N = as(base, s);
  check((await N("/api/v1/admin/me")).status === 200, "new1 could not sign in");
  const r = spawnSync(process.execPath, ["server/admin-cli.mjs", "disable", "new1"], { env: { ...process.env, HUB_ADMINS: A.accountsPath, HUB_ADMIN_AUDIT: A.auditPath }, encoding: "utf8" });
  check(r.status === 0, `the CLI could not disable an account: ${r.stderr}`);
  await sleep(2300);
  check((await N("/api/v1/admin/me")).status === 401, "a session survived the CLI disabling its account");
  console.log("a change made with the CLI reaches the running hub within two seconds");
}

// --- at rest, and the audit log
{
  const fresh = await signIn(base, "owner1", "owner-pass-0002");
  const audit = await (await as(base, fresh)("/api/v1/admin/audit?limit=500")).json();
  const acts = new Set(audit.entries.map((e) => `${e.action}:${e.ok}`));
  for (const want of ["login:true", "login:false", "part.propose:true", "part.reject:true", "account.create:true", "account.update:true", "logout:true"]) {
    check(acts.has(want), `the audit log has no ${want} entry`);
  }
  await sleep(2500); // the audit is flushed on a 2 s interval
  for (const f of [A.accountsPath, A.auditPath]) {
    const text = readFileSync(f, "utf8");
    for (const pw of [...Object.values(PW), "owner-pass-0002", "a-fine-password-1"]) check(!text.includes(pw), `${f} holds a plaintext password`);
    for (const s of [owner, op, view]) check(!text.includes(s.cookie.split("=")[1]) && !text.includes(s.csrf), `${f} holds a session token`);
    check((statSync(f).mode & 0o077) === 0, `${f} is readable by others (${(statSync(f).mode & 0o777).toString(8)})`);
  }
  console.log("at rest: no plaintext password or token in either file, both 0600, and the audit records who did what");
}

// --- the game's endpoints are untouched
{
  const st = await fetch(`${base}/api/v1/status`);
  check(st.status === 200 && st.headers.get("access-control-allow-origin") === "*", "the public status endpoint changed");
  check((await fetch(`${base}/api/v1/leaderboard`)).status === 200, "the public leaderboard changed");
  console.log("the game's own endpoints answer as before");
}

// =====================================================================
// Hub B: lockout and idle expiry, on a fresh hub (a locked address would
// lock this test out of hub A).
const B = await seed("b");
const baseB = await startHub(8932, { HUB_ADMINS: B.accountsPath, HUB_ADMIN_AUDIT: B.auditPath, HUB_ADMIN_IDLE_MIN: "0.05" });
{
  const s = await signIn(baseB, "view1", PW.view);
  await sleep(3500);
  check((await as(baseB, s)("/api/v1/admin/me")).status === 401, "an idle session did not expire");

  for (let i = 0; i < 5; i++) await signIn(baseB, "op1", `wrong-${i}-password`);
  const locked = await signIn(baseB, "op1", PW.op);
  check(locked.res.status === 429 && locked.res.headers.get("retry-after"), `5 wrong passwords did not lock the account (got ${locked.res.status})`);
  check(!locked.set, "a locked account was given a cookie");
  check((await signIn(baseB, "owner1", PW.owner)).res.status === 200, "locking one account locked the others");

  for (let i = 0; i < 20; i++) await signIn(baseB, `ghost${i}`, "wrong-password-xx");
  const ipLocked = await signIn(baseB, "owner1", PW.owner);
  check(ipLocked.res.status === 429, `20 failures from one address did not lock it (got ${ipLocked.res.status})`);
  console.log("lockout: an account after 5 wrong passwords, an address after 20; idle sessions expire");
}

// =====================================================================
// Hub C: no accounts yet.
const baseC = await startHub(8933, { HUB_ADMINS: join(dir, "none.json"), HUB_ADMIN_AUDIT: join(dir, "none-audit.json") });
{
  const page = await (await fetch(`${baseC}/admin`)).text();
  check(page.includes("No operator accounts yet") && page.includes("hub:admin") && !page.includes("<form"), "with no accounts /admin should explain the CLI, not offer a sign-up");
  check((await signIn(baseC, "owner1", PW.owner)).res.status === 401, "a sign-in succeeded with no accounts");
  console.log("with no accounts: a set-up notice and no sign-up form");
}

// =====================================================================
// Hub D: the panel in a real browser. Every check above is HTTP spoken by
// hand; this is the one that would have caught a policy that makes the
// browser itself look forged.
{
  const exe = [
    process.env.CHROME_PATH,
    process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
    process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].filter(Boolean).find((p) => existsSync(p));
  if (!check(!!exe, "no Chromium to drive the panel with (set CHROME_PATH)")) finish();
  const D = await seed("d");
  const baseD = await startHub(8934, { HUB_ADMINS: D.accountsPath, HUB_ADMIN_AUDIT: D.auditPath });
  const browser = await chromium.launch({ executablePath: exe });
  try {
    const console_ = [];
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // The one error a browser is meant to log: the wrong password's 401.
    page.on("console", (m) => { if (m.type() === "error" && !m.location().url.endsWith("/admin/login")) console_.push(m.text()); });
    page.on("pageerror", (e) => console_.push(e.message));

    await page.goto(`${baseD}/admin`);
    await page.fill('input[name="username"]', "owner1");
    await page.fill('input[name="password"]', "not-the-password");
    await page.click('button[type="submit"]');
    check((await page.innerText("body")).includes("Wrong username or password."), "a wrong password in the browser did not say so");
    check((await page.inputValue('input[name="username"]')) === "owner1", "a failed sign-in forgot the username");

    await page.fill('input[name="password"]', PW.owner);
    await page.click('button[type="submit"]');
    await page.waitForSelector("#sub");
    const filled = await page.waitForFunction(() => /uptime/.test(document.getElementById("sub")?.textContent ?? ""), null, { timeout: 15000 }).then(() => true, () => false);
    check(filled, `the dashboard did not fill in the browser: "${await page.textContent("#sub").catch(() => "")}"`);
    const auditRows = await page.waitForFunction(() => document.querySelectorAll("#audit tbody tr td").length > 1, null, { timeout: 10000 }).then(() => true, () => false);
    check(auditRows, "the owner's audit table stayed empty in the browser");

    // A write, through the panel's own fetch.
    await page.fill('#partForm [name="id"]', "paint-browser-blue");
    await page.selectOption('#partForm [name="cat"]', "paint");
    await page.fill('#partForm [name="name"]', "Browser Blue");
    await page.fill('#partForm [name="ar"]', "أزرق المتصفح");
    await page.fill('#partForm [name="price"]', "900");
    await page.fill('#partForm [name="desc"]', "queued from a real browser");
    await page.click('#partForm button[type="submit"]');
    const queued = await page.waitForFunction(() => document.getElementById("proposals").innerText.includes("paint-browser-blue"), null, { timeout: 10000 }).then(() => true, () => false);
    check(queued, `queuing a part from the browser failed: "${await page.textContent("#partErr").catch(() => "")}"`);

    await page.fill('#acctForm [name="username"]', "browser1");
    await page.fill('#acctForm [name="password"]', "a-browser-made-pw");
    await page.selectOption('#acctForm [name="role"]', "viewer");
    await page.click('#acctForm button[type="submit"]');
    const added = await page.waitForFunction(() => document.getElementById("accounts").innerText.includes("browser1"), null, { timeout: 10000 }).then(() => true, () => false);
    check(added, `adding an account from the browser failed: "${await page.textContent("#acctErr").catch(() => "")}"`);

    await page.click('[data-act="open-password"]');
    await page.fill('#pwForm [name="current"]', PW.owner);
    await page.fill('#pwForm [name="next"]', "owner-pass-0003");
    await page.fill('#pwForm [name="again"]', "owner-pass-0003");
    await page.click('#pwForm button[type="submit"]');
    const changed = await page.waitForFunction(() => /password changed/.test(document.getElementById("sub").textContent), null, { timeout: 10000 }).then(() => true, () => false);
    check(changed, `changing the password from the browser failed: "${await page.textContent("#pwErr").catch(() => "")}"`);

    const cookie = (await ctx.cookies()).find((c) => c.name === "grn_admin");
    await page.click('form[action="/admin/logout"] button');
    const signedOut = await page.waitForSelector('form[action="/admin/login"]', { timeout: 10000 }).then(() => true, () => false);
    check(signedOut, "signing out in the browser did not land on the sign-in form");
    const after = await fetch(`${baseD}/api/v1/admin/me`, { headers: { Cookie: `grn_admin=${cookie?.value}` } });
    check(after.status === 401, "the browser's session survived its own sign-out");

    // A viewer gets the read-only panel, and it fills too.
    const vctx = await browser.newContext();
    const vpage = await vctx.newPage();
    vpage.on("console", (m) => { if (m.type() === "error") console_.push(`viewer: ${m.text()}`); });
    await vpage.goto(`${baseD}/admin`);
    await vpage.fill('input[name="username"]', "view1");
    await vpage.fill('input[name="password"]', PW.view);
    await vpage.click('button[type="submit"]');
    await vpage.waitForSelector("#proposals");
    const vfilled = await vpage.waitForFunction(() => document.getElementById("proposals").innerText.includes("paint-browser-blue"), null, { timeout: 10000 }).then(() => true, () => false);
    check(vfilled && !(await vpage.$("#partForm")) && !(await vpage.$("#accounts")), "the viewer's panel did not fill, or offered controls it cannot use");

    check(console_.length === 0, `the browser console complained:\n    ${console_.join("\n    ")}`);
    console.log("a browser: sign-in, a filled dashboard, a part queued, an account added, a password changed, sign-out; nothing in the console");
  } finally {
    await browser.close();
  }
}

finish();
