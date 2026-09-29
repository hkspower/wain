#!/usr/bin/env node
/**
 * lib/salem-chat.ts in isolation, no browser, no build:
 *   node tests/salem-chat.test.mjs
 *
 * Written after an independent review of the سالم reversal found two real
 * gaps: the socket's own open/close/error events only fire for a connection
 * the network actually resolved, so a handshake accepted and then left
 * silent (a proxy that swallows the request, a malformed init payload
 * dropped without an error) settled none of them — `status` sat at
 * "connecting" forever with no way out but a reload. `CONNECT_TIMEOUT_MS`
 * closed that; this is what proves it fires, and that a normal connection
 * inside the window is not falsely timed out.
 *
 * A fake `WebSocket` global and node:test's fake timers stand in for the
 * network and the clock — nothing here reaches api.elevenlabs.io, and
 * nothing waits twelve real seconds.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mock } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
const fails = [];
const ok = (n, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? "\n      " + d : ""}`); } };

const tmp = mkdtempSync(join(tmpdir(), "wain-salem-chat-"));
const entry = join(tmp, "entry.ts");
writeFileSync(entry, `export * from ${JSON.stringify(join(ROOT, "src/lib/salem-chat.ts"))};\n`);
const bundle = join(tmp, "entry.mjs");
execSync(
  `npx -y esbuild ${JSON.stringify(entry)} --bundle --format=esm ` +
    `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(bundle)} --log-level=error`,
  { cwd: ROOT, stdio: "pipe" }
);
const { startSalemChat } = await import(pathToFileURL(bundle).href);
rmSync(tmp, { recursive: true, force: true });

/** A WebSocket standing in for the network — no connection, ever attempted. */
class FakeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = FakeSocket.CONNECTING;
    this.sent = [];
    this.listeners = {};
    FakeSocket.last = this;
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  send(data) { this.sent.push(data); }
  close(code, reason) {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.emit("close", { code: code ?? 1000, reason });
  }
  emit(type, evt) { for (const fn of this.listeners[type] ?? []) fn(evt); }
}

console.log("\n── a handshake that never answers times out, not hangs ──");
{
  globalThis.WebSocket = FakeSocket;
  mock.timers.enable({ apis: ["setTimeout"] });

  const statuses = [];
  startSalemChat({ onStatus: (s) => statuses.push(s), onMessage: () => {}, onToolUnavailable: () => {} });

  ok("starts at connecting", statuses.join(",") === "connecting", statuses.join(","));
  // The socket never fires "open" — a request accepted and then left silent,
  // the exact case addEventListener("open"/"close"/"error") cannot see.
  mock.timers.tick(11999);
  ok("still connecting one tick before the deadline", statuses.join(",") === "connecting", statuses.join(","));
  mock.timers.tick(1);
  ok("becomes error exactly at the deadline, not left hanging", statuses.join(",") === "connecting,error", statuses.join(","));
  ok("the socket is told to close, not just abandoned", FakeSocket.last.readyState === FakeSocket.CLOSED);

  mock.timers.reset();
}

console.log("\n── a connection that answers in time is not falsely timed out ──");
{
  globalThis.WebSocket = FakeSocket;
  mock.timers.enable({ apis: ["setTimeout"] });

  const statuses = [];
  startSalemChat({ onStatus: (s) => statuses.push(s), onMessage: () => {}, onToolUnavailable: () => {} });
  const sock = FakeSocket.last;

  sock.readyState = FakeSocket.OPEN;
  sock.emit("open", {});
  const sent = JSON.parse(sock.sent[0] ?? "{}");
  ok("the init message is sent on open", sock.sent.length === 1, JSON.stringify(sock.sent));
  ok("and asks for a text-only session", sent.conversation_config_override?.conversation?.text_only === true, JSON.stringify(sent));

  sock.emit("message", { data: JSON.stringify({ type: "conversation_initiation_metadata" }) });
  ok("status reaches connected", statuses.join(",") === "connecting,connected", statuses.join(","));

  // The timer that would have declared this a timeout is still armed unless
  // it was cleared on connect — advancing well past the deadline proves it.
  mock.timers.tick(20000);
  ok("connecting past the old deadline does not retroactively time out", statuses.join(",") === "connecting,connected", statuses.join(","));

  mock.timers.reset();
}

console.log(fails.length ? `\n${fails.length} failed` : "\nكل شي تمام");
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
