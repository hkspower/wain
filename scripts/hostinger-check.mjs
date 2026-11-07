#!/usr/bin/env node
// Is the token route to Hostinger usable from this session? One read-only
// call, and an answer that names which of the three things is missing —
// because «it failed» from here has three different fixes, made in three
// different places.
//
//   no token      → environment variables: HOSTINGER_API_TOKEN
//   gateway 403   → environment network: allow developers.hostinger.com
//   API 401       → hPanel: the token expired or was revoked; make a new one
//
// `npm run hosting:check -- vps` asks the VPS API instead, which is what
// the `hostinger-vps` connector calls. Same token, same host, same three
// failures — but a token can be fine for websites and the account still
// hold no VPS, and «0 machines» is worth seeing as an answer, not an error.
//
// curl rather than fetch: Node's fetch ignores HTTPS_PROXY, and every
// request out of this container has to go through it. The token reaches
// curl on stdin (`-H @-`), not in argv, so it is never in a process listing.
import { spawnSync } from "node:child_process";

const VPS = process.argv[2] === "vps";
const URL = VPS
  ? "https://developers.hostinger.com/api/vps/v1/virtual-machines"
  : "https://developers.hostinger.com/api/hosting/v1/websites?per_page=5";
const token = process.env.HOSTINGER_API_TOKEN?.trim();

if (!token) {
  console.log("✗ HOSTINGER_API_TOKEN is not set — hosa (OAuth) is the only route this session.");
  process.exit(1);
}

const r = spawnSync(
  "curl",
  ["-sS", "--max-time", "20", "-H", "@-", "-H", "Accept: application/json",
   "-w", "\n%{http_code}", URL],
  { input: `Authorization: Bearer ${token}\n`, encoding: "utf8" },
);

if (/CONNECT tunnel failed, response 403/.test(r.stderr)) {
  console.log("✗ the sandbox gateway refuses developers.hostinger.com — add it under Allowed domains.");
  process.exit(1);
}
const lines = (r.stdout ?? "").trimEnd().split("\n");
const status = Number(lines.pop());
if (status === 401 || status === 403) {
  console.log(`✗ Hostinger answered ${status} — the token is wrong, expired or revoked; make a new one in hPanel.`);
  process.exit(1);
}
if (status !== 200) {
  console.log(`✗ unexpected answer: ${status || "no response"} ${r.stderr.trim()}`);
  process.exit(1);
}
const body = JSON.parse(lines.join("\n"));
if (VPS) {
  // This endpoint answers a bare array; the websites one wraps it in `data`.
  const vms = Array.isArray(body) ? body : (body.data ?? []);
  console.log(`✓ VPS route works — ${vms.length} machine(s): ` +
    vms.map((v) => `${v.hostname ?? v.id} (${v.state ?? "?"})`).join(", "));
} else {
  const sites = body.data ?? [];
  console.log(`✓ token route works — ${sites.length} website(s) readable: ${sites.map((s) => s.domain).join(", ")}`);
}
