// Operator accounts for the hub's /admin panel: who may sign in, what each
// may do, and a record of what they did.
//
// Plain node:crypto, no dependency — the hub ships with one package (ws)
// and this keeps it that way. Used by server/hub-server.mjs (the login
// panel and every /api/v1/admin route) and by server/admin-cli.mjs (the
// first owner, and recovery when nobody can sign in).
//
// WHAT IT PROMISES
//
//   Passwords   scrypt (N=2^15, r=8, p=1, 64-byte key) with a 16-byte salt
//               per account, compared in constant time. Never stored,
//               logged or returned.
//   No hints    a wrong password, an unknown name and a disabled account
//               all fail the same way, in about the same time: an unknown
//               name is still hashed, against a dummy.
//   Lockout     5 wrong passwords for one account locks it for 15 minutes;
//               20 failures from one address in 15 minutes locks the
//               address. Both maps are bounded.
//   Sessions    a 32-byte random token in an HttpOnly cookie, stored here
//               only as its SHA-256. Idle 30 minutes, absolute 12 hours.
//               Disabling an account, changing its role or its password
//               ends its sessions. Each session carries its own CSRF token.
//   Roles       viewer   reads the dashboard
//               operator also queues and rejects part proposals
//               owner    also manages accounts and reads the audit log
//               The last enabled owner cannot be removed, disabled or
//               demoted, so the panel cannot lock everyone out of itself.
//   Audit       sign-ins (both ways), sign-outs, account changes and
//               proposal changes, with who, when and from where. Bounded
//               at 2000 entries, written atomically like the ledger.
import { scrypt as scryptCb, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

export const ROLES = ["viewer", "operator", "owner"];
const RANK = { viewer: 0, operator: 1, owner: 2 };

/** What each action needs. The hub asks `can(role, action)`; nothing else
 *  in it knows which role is which. */
export const NEEDS = {
  "dashboard.read": "viewer",
  "parts.read": "viewer",
  "parts.write": "operator",
  "accounts.read": "owner",
  "accounts.write": "owner",
  "audit.read": "owner",
  "self.password": "viewer",
};
export function can(role, action) {
  const need = NEEDS[action];
  return need !== undefined && role in RANK && RANK[role] >= RANK[need];
}

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256; // scrypt cost is fixed, but a 1 MB "password" still has to be read and hashed

function scrypt(password, salt) {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, KEYLEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)))
  );
}

const b64u = (buf) => buf.toString("base64url");
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export function normUsername(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

export function checkPassword(password, username = "") {
  if (typeof password !== "string") return "password required";
  if (password.length < PASSWORD_MIN) return `password must be at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `password must be at most ${PASSWORD_MAX} characters`;
  if (username && password.toLowerCase().includes(username)) return "password must not contain the username";
  return null;
}

function atomicWrite(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  // 0600: these hashes are slow to attack, not impossible.
  writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * @param {object} opt
 * @param {string} opt.accountsPath
 * @param {string} opt.auditPath
 * @param {() => number} [opt.now]
 * @param {number} [opt.idleMs]
 * @param {number} [opt.maxAgeMs]
 */
export function createAdminAuth(opt) {
  const now = opt.now ?? Date.now;
  const IDLE_MS = opt.idleMs ?? 30 * 60 * 1000;
  const MAX_AGE_MS = opt.maxAgeMs ?? 12 * 60 * 60 * 1000;
  const USER_LOCK = { fails: 5, ms: 15 * 60 * 1000 };
  const IP_LOCK = { fails: 20, windowMs: 15 * 60 * 1000, ms: 15 * 60 * 1000 };
  const MAX_TRACKED = 10000;
  const MAX_SESSIONS = 1000;
  const MAX_SESSIONS_PER_USER = 20;
  const MAX_AUDIT = 2000;

  /** username -> { username, role, salt, hash, disabled, createdAt, createdBy, lastLoginAt } */
  let accounts = new Map();
  let accountsMtime = 0;
  let lastStat = 0;
  /** sha256(token) -> { username, csrf, createdAt, lastSeen, ip } */
  const sessions = new Map();
  const userFails = new Map(); // username -> { count, lockedUntil }
  const ipFails = new Map(); // ip -> { count, since, lockedUntil }
  let audit = [];
  let auditDirty = false;
  // Compared against when the name is unknown, so a miss costs a hash too.
  const dummy = { salt: randomBytes(16).toString("hex"), hash: randomBytes(KEYLEN).toString("hex") };

  function loadAccounts() {
    try {
      const raw = JSON.parse(readFileSync(opt.accountsPath, "utf8"));
      const next = new Map();
      for (const a of raw.accounts ?? []) {
        if (!a?.username || !ROLES.includes(a.role) || !a.salt || !a.hash) continue;
        next.set(normUsername(a.username), { ...a, username: normUsername(a.username) });
      }
      accounts = next;
      accountsMtime = statSync(opt.accountsPath).mtimeMs;
    } catch (err) {
      if (err.code !== "ENOENT") console.warn(`[admin] could not read accounts: ${err.message}`);
    }
  }
  function saveAccounts() {
    atomicWrite(opt.accountsPath, { accounts: [...accounts.values()] });
    try { accountsMtime = statSync(opt.accountsPath).mtimeMs; } catch {}
  }
  /** The CLI may change the file while the hub runs: pick that up, at
   *  most every 2 s, and end the sessions it invalidated. */
  function refresh() {
    const t = now();
    if (t - lastStat < 2000) return;
    lastStat = t;
    try {
      const m = statSync(opt.accountsPath).mtimeMs;
      if (m !== accountsMtime) {
        loadAccounts();
        for (const [k, s] of sessions) {
          const a = accounts.get(s.username);
          if (!a || a.disabled || a.hash !== s.hashAtLogin || a.role !== s.roleAtLogin) sessions.delete(k);
        }
      }
    } catch {}
  }
  function loadAudit() {
    try {
      const raw = JSON.parse(readFileSync(opt.auditPath, "utf8"));
      audit = Array.isArray(raw.entries) ? raw.entries.slice(-MAX_AUDIT) : [];
    } catch (err) {
      if (err.code !== "ENOENT") console.warn(`[admin] could not read audit log: ${err.message}`);
    }
  }
  function flushAudit() {
    if (!auditDirty) return;
    auditDirty = false;
    try {
      atomicWrite(opt.auditPath, { entries: audit });
    } catch (err) {
      console.warn(`[admin] could not write audit log: ${err.message}`);
      auditDirty = true;
    }
  }
  function record(entry) {
    audit.push({ at: new Date(now()).toISOString(), ...entry });
    if (audit.length > MAX_AUDIT) audit = audit.slice(-MAX_AUDIT);
    auditDirty = true;
  }

  function bound(map) {
    if (map.size <= MAX_TRACKED) return;
    // Drop the oldest-inserted tenth: a flood of fresh names or
    // addresses must not grow this without limit.
    let n = Math.ceil(map.size / 10);
    for (const k of map.keys()) {
      if (n-- <= 0) break;
      map.delete(k);
    }
  }

  function view(a) {
    return {
      username: a.username,
      role: a.role,
      disabled: !!a.disabled,
      createdAt: a.createdAt,
      createdBy: a.createdBy,
      lastLoginAt: a.lastLoginAt ?? null,
    };
  }

  function enabledOwners() {
    return [...accounts.values()].filter((a) => a.role === "owner" && !a.disabled).length;
  }

  function endSessionsOf(username, exceptKey = null) {
    for (const [k, s] of sessions) if (s.username === username && k !== exceptKey) sessions.delete(k);
  }

  async function hashPassword(password) {
    const salt = randomBytes(16);
    const key = await scrypt(password, salt);
    return { salt: salt.toString("hex"), hash: key.toString("hex") };
  }

  async function matches(password, salt, hash) {
    const key = await scrypt(password, Buffer.from(salt, "hex"));
    const want = Buffer.from(hash, "hex");
    return want.length === key.length && timingSafeEqual(key, want);
  }

  loadAccounts();
  loadAudit();

  return {
    get size() {
      refresh();
      return accounts.size;
    },
    hasAccounts() {
      refresh();
      return accounts.size > 0;
    },
    flush: flushAudit,
    record,

    async createAccount({ username, password, role, by = "cli", ip = null }) {
      refresh();
      const u = normUsername(username);
      if (!USERNAME_RE.test(u)) return { error: "username: 3-32 characters, a-z 0-9 . _ -, starting with a letter or digit" };
      if (!ROLES.includes(role)) return { error: `role must be one of ${ROLES.join(", ")}` };
      if (accounts.has(u)) return { error: "that username is taken" };
      const bad = checkPassword(password, u);
      if (bad) return { error: bad };
      const { salt, hash } = await hashPassword(password);
      const a = { username: u, role, salt, hash, disabled: false, createdAt: new Date(now()).toISOString(), createdBy: by };
      accounts.set(u, a);
      saveAccounts();
      record({ actor: by, action: "account.create", target: u, detail: role, ip, ok: true });
      return { account: view(a) };
    },

    async updateAccount(username, changes, { by, ip = null, sessionKey = null } = {}) {
      refresh();
      const u = normUsername(username);
      const a = accounts.get(u);
      if (!a) return { error: "no such account", status: 404 };
      const next = { ...a };
      if (changes.role !== undefined) {
        if (!ROLES.includes(changes.role)) return { error: `role must be one of ${ROLES.join(", ")}` };
        next.role = changes.role;
      }
      if (changes.disabled !== undefined) next.disabled = !!changes.disabled;
      if (changes.password !== undefined) {
        const bad = checkPassword(changes.password, u);
        if (bad) return { error: bad };
        Object.assign(next, await hashPassword(changes.password));
      }
      // The last enabled owner stays an enabled owner.
      const wasOwner = a.role === "owner" && !a.disabled;
      const stillOwner = next.role === "owner" && !next.disabled;
      if (wasOwner && !stillOwner && enabledOwners() <= 1) {
        return { error: "this is the last enabled owner — make another owner first", status: 409 };
      }
      accounts.set(u, next);
      saveAccounts();
      // A changed role, a disabled account or a new password ends that
      // account's other sessions; the caller's own survives its own
      // password change.
      if (next.role !== a.role || next.disabled || next.hash !== a.hash) endSessionsOf(u, sessionKey);
      for (const sess of sessions.values()) {
        if (sess.username === u) { sess.hashAtLogin = next.hash; sess.roleAtLogin = next.role; }
      }
      const what = Object.keys(changes).map((k) => (k === "password" ? "password" : `${k}=${changes[k]}`)).join(" ");
      record({ actor: by, action: "account.update", target: u, detail: what, ip, ok: true });
      return { account: view(next) };
    },

    deleteAccount(username, { by, ip = null } = {}) {
      refresh();
      const u = normUsername(username);
      const a = accounts.get(u);
      if (!a) return { error: "no such account", status: 404 };
      if (a.role === "owner" && !a.disabled && enabledOwners() <= 1) {
        return { error: "this is the last enabled owner — make another owner first", status: 409 };
      }
      accounts.delete(u);
      saveAccounts();
      endSessionsOf(u);
      record({ actor: by, action: "account.delete", target: u, ip, ok: true });
      return { deleted: true };
    },

    listAccounts() {
      refresh();
      return [...accounts.values()].map(view).sort((x, y) => x.username.localeCompare(y.username));
    },

    /**
     * A sign-in attempt. Every failure looks the same to the caller;
     * `locked` is the one difference, and it is said only once a lock is
     * already in force (Retry-After), which an attacker learns by being
     * locked anyway.
     */
    async login(username, password, ip) {
      refresh();
      const t = now();
      const u = normUsername(username);
      const ipRec = ipFails.get(ip);
      const userRec = userFails.get(u);
      const lockedUntil = Math.max(ipRec?.lockedUntil ?? 0, userRec?.lockedUntil ?? 0);
      if (lockedUntil > t) {
        record({ actor: u || "?", action: "login", ip, ok: false, detail: "locked" });
        return { ok: false, locked: true, retryAfterSec: Math.ceil((lockedUntil - t) / 1000) };
      }
      const a = accounts.get(u);
      const pw = typeof password === "string" && password.length <= PASSWORD_MAX ? password : "";
      const good = await matches(pw, a?.salt ?? dummy.salt, a?.hash ?? dummy.hash);
      if (!a || a.disabled || !good || !pw) {
        const ur = userFails.get(u) ?? { count: 0, lockedUntil: 0 };
        ur.count++;
        if (ur.count >= USER_LOCK.fails) { ur.lockedUntil = t + USER_LOCK.ms; ur.count = 0; }
        userFails.set(u, ur);
        bound(userFails);
        const ir = ipFails.get(ip) ?? { count: 0, since: t, lockedUntil: 0 };
        if (t - ir.since > IP_LOCK.windowMs) { ir.count = 0; ir.since = t; }
        ir.count++;
        if (ir.count >= IP_LOCK.fails) { ir.lockedUntil = t + IP_LOCK.ms; ir.count = 0; ir.since = t; }
        ipFails.set(ip, ir);
        bound(ipFails);
        record({ actor: u || "?", action: "login", ip, ok: false });
        return { ok: false };
      }
      userFails.delete(u);
      const token = b64u(randomBytes(32));
      const key = sha256(token);
      const s = { username: u, csrf: b64u(randomBytes(32)), createdAt: t, lastSeen: t, ip, hashAtLogin: a.hash, roleAtLogin: a.role };
      // Bounded: per account, then overall, oldest first.
      const mine = [...sessions.entries()].filter(([, v]) => v.username === u);
      if (mine.length >= MAX_SESSIONS_PER_USER) sessions.delete(mine[0][0]);
      if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
      sessions.set(key, s);
      accounts.set(u, { ...a, lastLoginAt: new Date(t).toISOString() });
      saveAccounts();
      record({ actor: u, action: "login", ip, ok: true });
      return { ok: true, token, csrf: s.csrf, role: a.role, username: u };
    },

    /** The signed-in operator behind a cookie token, or null. Slides the
     *  idle window. */
    session(token) {
      if (!token || typeof token !== "string" || token.length > 200) return null;
      refresh();
      const key = sha256(token);
      const s = sessions.get(key);
      if (!s) return null;
      const t = now();
      const a = accounts.get(s.username);
      if (!a || a.disabled || t - s.lastSeen > IDLE_MS || t - s.createdAt > MAX_AGE_MS) {
        sessions.delete(key);
        return null;
      }
      s.lastSeen = t;
      return { key, username: s.username, role: a.role, csrf: s.csrf };
    },

    logout(token, ip = null) {
      if (!token) return;
      const key = sha256(String(token));
      const s = sessions.get(key);
      if (s) {
        sessions.delete(key);
        record({ actor: s.username, action: "logout", ip, ok: true });
      }
    },

    async changeOwnPassword(username, current, next, { sessionKey, ip = null } = {}) {
      refresh();
      const u = normUsername(username);
      const a = accounts.get(u);
      if (!a) return { error: "no such account", status: 404 };
      if (!(await matches(typeof current === "string" ? current : "", a.salt, a.hash))) {
        record({ actor: u, action: "password.change", ip, ok: false });
        return { error: "current password is wrong", status: 403 };
      }
      return this.updateAccount(u, { password: next }, { by: u, ip, sessionKey });
    },

    listAudit(limit = 200) {
      return audit.slice(-Math.max(1, Math.min(limit, MAX_AUDIT))).reverse();
    },

    /** For tests and the CLI: how many live sessions an account has. */
    sessionCount(username) {
      const u = normUsername(username);
      return [...sessions.values()].filter((s) => s.username === u).length;
    },
  };
}
