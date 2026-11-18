#!/usr/bin/env node
// VPS panel — a local control panel for Hostinger VPS instances.
//
// Serves one page (index.html) and a small JSON API that proxies to the
// Hostinger VPS API with the token from the environment. The token never
// reaches the browser, the repository, or the static site export: this is a
// server-side process, run on the operator's own machine.
//
//   HOSTINGER_API_TOKEN   required — hPanel → API
//   VPS_PANEL_PORT        optional — default 8787
//   VPS_API_BASE          optional — default https://developers.hostinger.com/api/vps/v1
//                         (overridden by tests to point at a stub)
//
// Binds 127.0.0.1 only. Destructive actions are limited to start / stop /
// restart; recreating a VPS (wipes the disk) is deliberately not exposed here.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = (process.env.VPS_API_BASE || "https://developers.hostinger.com/api/vps/v1").replace(/\/$/, "");
const ACTIONS = new Set(["start", "stop", "restart"]);
const ID_RE = /^\d{1,12}$/;

export function createPanel({ token, apiBase = API_BASE, fetchImpl = fetch } = {}) {
  if (!token || !token.trim()) throw new Error("HOSTINGER_API_TOKEN is not set");

  async function upstream(method, p) {
    const res = await fetchImpl(`${apiBase}${p}`, {
      method,
      headers: { Authorization: `Bearer ${token.trim()}`, Accept: "application/json" },
    });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 500) }; }
    return { status: res.status, body };
  }

  return async function handle(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (status, obj) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(obj));
    };

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await readFile(path.join(HERE, "index.html"));
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        // Inline script is allowed because the page is single-file and localhost-only;
        // every API value is written with textContent, never innerHTML.
        "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
      });
      return res.end(html);
    }

    if (url.pathname === "/api/vms" && req.method === "GET") {
      const r = await upstream("GET", "/virtual-machines");
      return send(r.status < 300 ? 200 : r.status, Array.isArray(r.body) ? { vms: r.body.map(summary) } : r.body);
    }

    const m = url.pathname.match(/^\/api\/vms\/(\d+)(?:\/(start|stop|restart))?$/);
    if (m) {
      const [, id, action] = m;
      if (!ID_RE.test(id)) return send(400, { error: "bad_id" });
      if (!action && req.method === "GET") {
        const r = await upstream("GET", `/virtual-machines/${id}`);
        return send(r.status < 300 ? 200 : r.status, r.status < 300 ? summary(r.body) : r.body);
      }
      if (action && req.method === "POST" && ACTIONS.has(action)) {
        const r = await upstream("POST", `/virtual-machines/${id}/${action}`);
        return send(r.status < 300 ? 202 : r.status, r.status < 300 ? { ok: true, action } : r.body);
      }
      return send(405, { error: "method_not_allowed" });
    }

    send(404, { error: "not_found" });
  };
}

// Only the fields the panel shows — never IPs' owners, keys or billing ids.
export function summary(vm) {
  return {
    id: vm.id,
    hostname: vm.hostname,
    plan: vm.plan,
    state: vm.state,
    actions_lock: vm.actions_lock,
    cpus: vm.cpus,
    memory_mb: vm.memory,
    disk_mb: vm.disk,
    ipv4: (vm.ipv4 || []).map((a) => a.address),
    template: vm.template?.name ?? null,
    created_at: vm.created_at,
  };
}

// Run directly, not when imported by the tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const token = process.env.HOSTINGER_API_TOKEN;
  if (!token?.trim()) {
    process.stderr.write("vps-panel: HOSTINGER_API_TOKEN is not set — add it to the environment and start again.\n");
    process.exit(1);
  }
  const port = Number(process.env.VPS_PANEL_PORT || 8787);
  const handler = createPanel({ token });
  http.createServer((req, res) => {
    handler(req, res).catch((err) => {
      process.stderr.write(`vps-panel: ${err.message}\n`);
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "upstream_failed" }));
    });
  }).listen(port, "127.0.0.1", () => {
    process.stdout.write(`VPS panel: http://127.0.0.1:${port}\n`);
  });
}
