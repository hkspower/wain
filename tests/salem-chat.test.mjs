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
const { startSalemChat, stripFiller } = await import(pathToFileURL(bundle).href);
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
  // The server stores the source as an enum (`conversation_initiation_source`
  // in the conversations API). This client sent «wain-salem-chat» from the
  // day it was written, and not one typed conversation was ever recorded for
  // the agent while widget calls — even 0-second ones — all were. The SDK
  // this client was read out of sends «js_sdk»; the list is the API's own.
  const SOURCES = ["unknown", "android_sdk", "node_js_sdk", "react_native_sdk", "react_sdk", "js_sdk",
    "python_sdk", "widget", "swift_sdk", "flutter_sdk", "template_preview"];
  const urlSource = new URL(sock.url).searchParams.get("source");
  ok("the URL names a source the server knows", SOURCES.includes(urlSource), urlSource);
  ok("so does the init message", SOURCES.includes(sent.source_info?.source), JSON.stringify(sent.source_info));

  sock.emit("message", { data: JSON.stringify({ type: "conversation_initiation_metadata" }) });
  ok("status reaches connected", statuses.join(",") === "connecting,connected", statuses.join(","));

  // The timer that would have declared this a timeout is still armed unless
  // it was cleared on connect — advancing well past the deadline proves it.
  mock.timers.tick(20000);
  ok("connecting past the old deadline does not retroactively time out", statuses.join(",") === "connecting,connected", statuses.join(","));

  mock.timers.reset();
}

console.log("\n── client_tool_call: a registered tool runs and answers ──");
{
  globalThis.WebSocket = FakeSocket;
  const calls = [];
  startSalemChat({
    onStatus: () => {},
    onMessage: () => {},
    onToolUnavailable: () => calls.push("unavailable"),
    clientTools: {
      show_places: async (params) => {
        calls.push(["show_places", params]);
        return "spoken result";
      },
    },
  });
  const sock = FakeSocket.last;
  sock.emit("message", {
    data: JSON.stringify({
      type: "client_tool_call",
      client_tool_call: { tool_call_id: "call-1", tool_name: "show_places", parameters: { query: "قهوة" } },
    }),
  });
  // The handler is async and the dispatch chains two more `.then`s around
  // it, so a microtask or two is not enough — a macrotask boundary is the
  // reliable way to let the whole chain settle before reading `sock.sent`.
  await new Promise((r) => setTimeout(r, 0));
  ok("the handler ran with the agent's own parameters", calls.length === 1 && calls[0][1].query === "قهوة", JSON.stringify(calls));
  const reply = JSON.parse(sock.sent[0] ?? "{}");
  ok("its return value is sent back as the tool result", reply.result === "spoken result" && reply.is_error === false, JSON.stringify(reply));
  ok("the reply names the right tool_call_id", reply.tool_call_id === "call-1");
  ok("onToolUnavailable is not fired for a registered tool", !calls.includes("unavailable"));
}

console.log("\n── client_tool_call: an unregistered tool errors instead of hanging ──");
{
  globalThis.WebSocket = FakeSocket;
  let unavailable = false;
  startSalemChat({
    onStatus: () => {},
    onMessage: () => {},
    onToolUnavailable: () => { unavailable = true; },
    clientTools: { show_places: async () => "x" },
  });
  const sock = FakeSocket.last;
  sock.emit("message", {
    data: JSON.stringify({
      type: "client_tool_call",
      client_tool_call: { tool_call_id: "call-2", tool_name: "open_place", parameters: {} },
    }),
  });
  const reply = JSON.parse(sock.sent[0] ?? "{}");
  ok("an error result is sent, not silence", reply.is_error === true && reply.tool_call_id === "call-2", JSON.stringify(reply));
  ok("onToolUnavailable fires so the page can say so", unavailable === true);
}

console.log("\n── client_tool_call: no clientTools map at all behaves the same way ──");
{
  globalThis.WebSocket = FakeSocket;
  let unavailable = false;
  startSalemChat({ onStatus: () => {}, onMessage: () => {}, onToolUnavailable: () => { unavailable = true; } });
  const sock = FakeSocket.last;
  sock.emit("message", {
    data: JSON.stringify({
      type: "client_tool_call",
      client_tool_call: { tool_call_id: "call-3", tool_name: "show_places", parameters: {} },
    }),
  });
  const reply = JSON.parse(sock.sent[0] ?? "{}");
  ok("still an error result, not a throw", reply.is_error === true);
  ok("still reported as unavailable", unavailable === true);
}

console.log("\n── client_tool_call: a handler that throws is answered, not left hanging ──");
{
  globalThis.WebSocket = FakeSocket;
  startSalemChat({
    onStatus: () => {},
    onMessage: () => {},
    onToolUnavailable: () => {},
    clientTools: {
      open_place: async () => { throw new Error("bad slug"); },
    },
  });
  const sock = FakeSocket.last;
  sock.emit("message", {
    data: JSON.stringify({
      type: "client_tool_call",
      client_tool_call: { tool_call_id: "call-4", tool_name: "open_place", parameters: {} },
    }),
  });
  await new Promise((r) => setTimeout(r, 0));
  const reply = JSON.parse(sock.sent[0] ?? "{}");
  ok("the thrown message is sent back as the error result", reply.is_error === true && reply.result === "bad slug", JSON.stringify(reply));
}

console.log("\n── send() says whether the message left, and typing follows it ──");
{
  globalThis.WebSocket = FakeSocket;
  mock.timers.enable({ apis: ["setTimeout"] });
  const pend = [];
  const msgs = [];
  const handle = startSalemChat({
    onStatus: () => {},
    onMessage: (m) => msgs.push(m),
    onPending: (v) => pend.push(v),
    onToolUnavailable: () => {},
  });
  const sock = FakeSocket.last;
  ok("a socket that is not open refuses the message", handle.send("هلا") === false);
  ok("and sends nothing", sock.sent.length === 0, JSON.stringify(sock.sent));
  ok("and does not start «typing» for a reply that cannot come", pend.length === 0, pend.join(","));

  sock.readyState = FakeSocket.OPEN;
  sock.emit("open", {});
  // Without the handshake reply the 12s connect timer would close this socket
  // under the safety-timeout assertion below.
  sock.emit("message", { data: JSON.stringify({ type: "conversation_initiation_metadata" }) });
  sock.sent.length = 0;
  ok("an open socket takes it", handle.send("هلا") === true);
  const out = JSON.parse(sock.sent[0] ?? "{}");
  ok("as a user_message with the text", out.type === "user_message" && out.text === "هلا", JSON.stringify(out));
  ok("typing starts when the message leaves", pend.join(",") === "true", pend.join(","));

  sock.emit("message", { data: JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: "حياك" } }) });
  ok("and stops when her reply arrives", pend.join(",") === "true,false", pend.join(","));
  ok("the reply is delivered", msgs.length === 1 && msgs[0].text === "حياك");

  // A reply that never comes must not leave the indicator up for ever.
  handle.send("وين؟");
  ok("a second message starts it again", pend.join(",") === "true,false,true", pend.join(","));
  mock.timers.tick(44999);
  ok("still typing one tick before the safety timeout", pend.join(",") === "true,false,true", pend.join(","));
  mock.timers.tick(1);
  ok("cleared by the safety timeout when no reply ever comes", pend.join(",") === "true,false,true,false", pend.join(","));

  handle.send("ثالث");
  sock.close(1006);
  ok("and cleared when the session ends", pend[pend.length - 1] === false, pend.join(","));
  mock.timers.reset();
}

console.log("\n── a correction replaces what she said ──");
{
  globalThis.WebSocket = FakeSocket;
  const fixes = [];
  startSalemChat({
    onStatus: () => {},
    onMessage: () => {},
    onCorrection: (c) => fixes.push(c),
    onToolUnavailable: () => {},
  });
  const sock = FakeSocket.last;
  sock.emit("message", {
    data: JSON.stringify({
      type: "agent_response_correction",
      agent_response_correction_event: { original_agent_response: "أحلى وقت العصر", corrected_agent_response: "أحلى وقت عقب المغرب", event_id: 3 },
    }),
  });
  ok("the correction reaches the page, with both texts",
    fixes.length === 1 && fixes[0].original === "أحلى وقت العصر" && fixes[0].corrected === "أحلى وقت عقب المغرب", JSON.stringify(fixes));
  sock.emit("message", { data: JSON.stringify({ type: "agent_response_correction", agent_response_correction_event: { corrected_agent_response: "" } }) });
  ok("an empty correction is ignored, not drawn as a blank bubble", fixes.length === 1, JSON.stringify(fixes));
  // A client that does not pass the callback must not throw on one.
  startSalemChat({ onStatus: () => {}, onMessage: () => {}, onToolUnavailable: () => {} });
  let threw = false;
  try {
    FakeSocket.last.emit("message", { data: JSON.stringify({ type: "agent_response_correction", agent_response_correction_event: { corrected_agent_response: "x" } }) });
  } catch { threw = true; }
  ok("and a page that does not listen for corrections is unaffected", !threw);
}

console.log("\n── a failure says WHICH kind ──");
{
  globalThis.WebSocket = FakeSocket;
  mock.timers.enable({ apis: ["setTimeout"] });
  let seen = [];
  startSalemChat({ onStatus: (s, f) => seen.push([s, f]), onMessage: () => {}, onToolUnavailable: () => {} });
  mock.timers.tick(12000);
  ok("a handshake that never answers is a timeout", seen.some(([s, f]) => s === "error" && f === "timeout"), JSON.stringify(seen));

  seen = [];
  startSalemChat({ onStatus: (s, f) => seen.push([s, f]), onMessage: () => {}, onToolUnavailable: () => {} });
  FakeSocket.last.emit("error", {});
  ok("an error before the handshake completed is a refusal", seen.some(([s, f]) => s === "error" && f === "refused"), JSON.stringify(seen));

  seen = [];
  startSalemChat({ onStatus: (s, f) => seen.push([s, f]), onMessage: () => {}, onToolUnavailable: () => {} });
  const live = FakeSocket.last;
  live.readyState = FakeSocket.OPEN;
  live.emit("message", { data: JSON.stringify({ type: "conversation_initiation_metadata" }) });
  live.emit("close", { code: 1006 });
  ok("a socket that dies after connecting is a dropped line", seen.some(([s, f]) => s === "error" && f === "dropped"), JSON.stringify(seen));

  seen = [];
  startSalemChat({ onStatus: (s, f) => seen.push([s, f]), onMessage: () => {}, onToolUnavailable: () => {} });
  FakeSocket.last.emit("close", { code: 1000 });
  ok("a normal close is «disconnected», with no failure attached", seen.some(([s, f]) => s === "disconnected" && f === undefined), JSON.stringify(seen));
  mock.timers.reset();
}

console.log("\n── the phone-call filler is not a typed answer ──");
{
  ok("a leading filler is dropped from a real reply", stripFiller("ثانية وحدة….  أوكي، قهوة هادية…") === "أوكي، قهوة هادية…", stripFiller("ثانية وحدة….  أوكي، قهوة هادية…"));
  ok("a reply that is only the filler becomes empty", stripFiller("ثانية وحدة…") === "");
  ok("an ordinary reply is untouched", stripFiller("حياك الله") === "حياك الله");
  ok("«ثانية» inside a sentence is not stripped", stripFiller("استنى ثانية وحدة بس") === "استنى ثانية وحدة بس");

  globalThis.WebSocket = FakeSocket;
  mock.timers.enable({ apis: ["setTimeout"] });
  const pend = [];
  const msgs = [];
  let noReply = 0;
  const handle = startSalemChat({
    onStatus: () => {},
    onMessage: (m) => msgs.push(m),
    onPending: (v) => pend.push(v),
    onNoReply: () => noReply++,
    onToolUnavailable: () => {},
  });
  const sock = FakeSocket.last;
  sock.readyState = FakeSocket.OPEN;
  sock.emit("open", {});
  sock.emit("message", { data: JSON.stringify({ type: "conversation_initiation_metadata" }) });
  handle.send("قهوة");
  sock.emit("message", { data: JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: "ثانية وحدة…" } }) });
  ok("a filler on its own draws no bubble", msgs.length === 0, JSON.stringify(msgs));
  ok("and does not end the typing state — she is still working", pend.join(",") === "true", pend.join(","));
  sock.emit("message", { data: JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: "أبشر، كافيهات شارع الخليج." } }) });
  ok("the real answer does, and ends it", msgs.length === 1 && pend.join(",") === "true,false", pend.join(","));
  ok("an answer never reports «no reply»", noReply === 0);

  handle.send("وين؟");
  mock.timers.tick(45000);
  ok("a reply that never comes reports it once, as well as clearing the dots", noReply === 1 && pend[pend.length - 1] === false, `${noReply} ${pend.join(",")}`);
  mock.timers.reset();
}

console.log("\n── a tool turn is still her turn ──");
{
  /* What the one real conversation's transcript shows: her sentence before a
     tool arrives as an agent_response of its own, then the client_tool_call,
     then — after the tool and a second generation — the answer. The first
     reply ended «typing» and the box opened in the middle of all that. */
  globalThis.WebSocket = FakeSocket;
  mock.timers.enable({ apis: ["setTimeout"] });
  const pend = [];
  let slow = 0;
  const handle = startSalemChat({
    onStatus: () => {},
    onMessage: () => {},
    onPending: (v) => pend.push(v),
    onSlow: () => slow++,
    onToolUnavailable: () => {},
    clientTools: { show_places: async () => "ok" },
  });
  const sock = FakeSocket.last;
  sock.readyState = FakeSocket.OPEN;
  sock.emit("open", {});
  sock.emit("message", { data: JSON.stringify({ type: "conversation_initiation_metadata" }) });
  handle.send("قهوة هادية");
  sock.emit("message", { data: JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: "أبشر، أدوّر لك." } }) });
  ok("her sentence before the tool ends the typing state for a moment", pend.join(",") === "true,false", pend.join(","));
  sock.emit("message", {
    data: JSON.stringify({ type: "client_tool_call", client_tool_call: { tool_call_id: "t1", tool_name: "show_places", parameters: { query: "قهوة" } } }),
  });
  ok("the tool call puts it back: her answer is still coming", pend.join(",") === "true,false,true", pend.join(","));
  sock.emit("message", { data: JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: "هذي ثلاث قدامك." } }) });
  ok("and the answer after the tool ends it", pend.join(",") === "true,false,true,false", pend.join(","));

  /* The soft-timeout filler is the server saying «slow», three seconds in. */
  handle.send("وين؟");
  sock.emit("message", { data: JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: "ثانية وحدة…" } }) });
  ok("a filler on its own while she is working says she is slow", slow === 1, String(slow));
  sock.emit("message", { data: JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: "حياك." } }) });
  sock.emit("message", { data: JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: "ثانية وحدة…" } }) });
  ok("one with nothing asked of her says nothing", slow === 1, String(slow));
  mock.timers.reset();
}

console.log(fails.length ? `\n${fails.length} failed` : "\nكل شي تمام");
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
