/**
 * Does she HEAR the caller, under the policy the site actually ships?
 *   npm run test:widget-csp
 *
 * The bug this exists for looked like nothing at all. With the microphone
 * granted, the widget's socket open and the header reading «متصل», the
 * production Content-Security-Policy still stopped the widget from loading its
 * AudioWorklet — a blob: script, checked against script-src — so the browser
 * captured nothing and not one audio chunk was ever sent. No console error, no
 * securitypolicyviolation event, no thrown promise. Every other suite here
 * stubs the widget (shouq-agent) or never sets a CSP (every server in here), so
 * each of them passed throughout.
 *
 * So this runs the REAL published widget bundle, under the CSP and
 * Permissions-Policy read out of public/.htaccess, with a fake microphone and a
 * mock ElevenLabs socket, and counts the `user_audio_chunk` messages that
 * leave the page. Two things are measured, and the second is the control that
 * makes the first mean something: chunks flow under the policy, and they flow
 * with the policy removed (so a mock that stopped answering cannot pass or fail
 * this on its own).
 *
 * Needs a fresh `out/`, which carries the widget itself (vendor-widget.mjs).
 * ElevenLabs itself is never contacted — every request to it is routed here.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { requireFreshBuild } from "./stale-build.mjs";
import { makeSection } from "./harness/check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
requireFreshBuild(ROOT);

let passed = 0, failed = 0;
const ok = (name, cond, detail = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
  if (cond) passed++;
  else failed++;
};
// For the parts added since: a step that throws is a red in its own part, and
// the parts after it still run (harness/check.mjs).
const section = makeSection(ok);

/* The policy the site ships, read from the file that ships it. */
const htaccess = readFileSync(join(ROOT, "public/.htaccess"), "utf8");
const CSP = htaccess.match(/Content-Security-Policy "([^"]+)"/)?.[1];
const PERMISSIONS = htaccess.match(/Permissions-Policy "([^"]+)"/)?.[1];
if (!CSP || !PERMISSIONS) {
  console.error("public/.htaccess has no Content-Security-Policy / Permissions-Policy");
  process.exit(1);
}

/* The widget the site ships — served from out/ by the server below, the very
   file a visitor gets (vendor-widget.mjs copies it there at build). It came
   off unpkg until 2 October, so this suite used to `npm pack` the pinned
   version and route the CDN to it; now nothing is routed, and the SRI
   integrity on the tag is exercised for real: wrong bytes would be refused. */
const WIDGET_PATH = readFileSync(join(ROOT, "src/lib/widget-src.g.ts"), "utf8")
  .match(/WAIN_AI_WIDGET_PATH = "([^"]+)"/)?.[1];
if (!WIDGET_PATH || !existsSync(join(OUT, WIDGET_PATH))) {
  console.error(`out/ does not carry the call widget (${WIDGET_PATH ?? "no path in widget-src.g.ts"}) — run npm run build`);
  process.exit(1);
}

/* What the agent's widget config looks like (agents_get_widget, 30 Sept;
   the conversation-id line off since 2 October). */
const WIDGET_CONFIG = {"agent_id": "agent_1701m1gcrccrethae9y3nyv1e116", "widget_config": {"variant": "full", "placement": "bottom-right", "expandable": "never", "avatar": {"type": "orb", "color_1": "#2792dc", "color_2": "#9ce6e6"}, "feedback_mode": "during", "end_feedback": {"type": "rating"}, "bg_color": "#ffffff", "text_color": "#000000", "btn_color": "#000000", "btn_text_color": "#ffffff", "border_color": "#e1e1e1", "focus_color": "#000000", "shareable_page_show_terms": true, "terms_text": "#### Terms and conditions\n\nBy clicking \"Agree,\" and each time I interact with this AI agent, I consent to the recording, storage, and sharing of my communications with third-party service providers, and as described in the Privacy Policy.", "show_avatar_when_collapsed": false, "disable_banner": false, "markdown_link_allowed_hosts": [], "mic_muting_enabled": true, "transcript_enabled": true, "text_input_enabled": true, "conversation_mode_toggle_enabled": false, "default_expanded": false, "always_expanded": false, "dismissible": false, "show_agent_status": false, "show_conversation_id": false, "strip_audio_tags": true, "text_contents": {"main_label": "هل تحتاج إلى مساعدة؟", "start_call": "بدء مكالمة", "start_chat": "رسالة", "new_call": "مكالمة جديدة", "end_call": "إنهاء", "mute_microphone": "كتم الميكروفون", "accept_terms": "قبول", "dismiss_terms": "إلغاء", "listening_status": "يستمع", "speaking_status": "تحدث للمقاطعة", "connecting_status": "جارٍ الاتصال", "error_occurred": "حدث خطأ"}, "styles": {}, "show_resize_button": true, "language": "ar", "language_presets": {}, "text_only": false, "supports_text_only": true, "first_message": "هلا والله! أنا شوق من «وين». قول لي شنو جوّك اليوم — بحر، قهوة، ولا طلعة مع العيال؟", "file_input_config": {"enabled": true, "max_files_in_memory": 10, "max_files_per_conversation": 10}}};

/* The consent sheet the live agent shows — its Arabic terms, with a heading
   («قبل ما تبدأ»), from the copy of the live agent kept in the repository —
   rather than the stock English paragraph above: the heading is the part a
   box too short cuts off. */
const LIVE_WIDGET = JSON.parse(readFileSync(join(ROOT, "docs/agent-live/shouq-agent-full.json"), "utf8")).platform_settings.widget;
WIDGET_CONFIG.widget_config.terms_text = LIVE_WIDGET.terms_text;
WIDGET_CONFIG.widget_config.terms_html = LIVE_WIDGET.terms_html;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };

/* The resampler the widget fetches from jsDelivr when the audio rates differ
   (public/.htaccess names that one file). Served here from the very package
   version its bundle names, so the real worklet runs under the real policy.
   A worklet's module fetch never reaches Playwright's routing (it went out to
   the network and failed on the sandbox's TLS while every other request was
   routed), so the host itself is played: an HTTPS server on this machine with
   a throwaway certificate, and the browser's resolver pointed at it. */
const RESAMPLER_URL = "https://cdn.jsdelivr.net/npm/@alexanderolsen/libsamplerate-js@2.1.2/dist/libsamplerate.worklet.js";
const RESAMPLER_FILE = join(ROOT, "node_modules/@alexanderolsen/libsamplerate-js/dist/libsamplerate.worklet.js");
const certDir = mkdtempSync(join(tmpdir(), "wain-jsdelivr-"));
execSync(
  `openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=cdn.jsdelivr.net" ` +
    `-keyout ${join(certDir, "key.pem")} -out ${join(certDir, "cert.pem")}`,
  { stdio: "pipe" }
);
let resamplerAsked = 0;
const jsdelivr = createHttpsServer(
  { key: readFileSync(join(certDir, "key.pem")), cert: readFileSync(join(certDir, "cert.pem")) },
  (req, res) => {
    if (`https://cdn.jsdelivr.net${req.url}` !== RESAMPLER_URL || !existsSync(RESAMPLER_FILE)) { res.writeHead(404); return res.end(); }
    resamplerAsked++;
    res.writeHead(200, { "content-type": "text/javascript", "access-control-allow-origin": "*" });
    res.end(readFileSync(RESAMPLER_FILE));
  }
);
await new Promise((r) => jsdelivr.listen(0, "127.0.0.1", r));
rmSync(certDir, { recursive: true, force: true });
const JSDELIVR_ARGS = [
  `--host-resolver-rules=MAP cdn.jsdelivr.net 127.0.0.1:${jsdelivr.address().port}`,
  "--ignore-certificate-errors",
  "--no-proxy-server",
];

async function run({ withPolicy, init = null, outputFormat = "pcm_16000", viewport = { width: 390, height: 844 }, config = WIDGET_CONFIG }) {
  const server = createServer((req, res) => {
    let file = join(OUT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) { res.writeHead(404); return res.end("nf"); }
    const headers = { "content-type": TYPES[extname(file)] || "application/octet-stream" };
    if (withPolicy) { headers["Content-Security-Policy"] = CSP; headers["Permissions-Policy"] = PERMISSIONS; }
    res.writeHead(200, headers);
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", ...JSDELIVR_ARGS],
  });
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, locale: "ar-KW", permissions: ["microphone"] });
  // Which road the call took: the WebRTC transport asks this host for a room
  // token and then dials LiveKit; the WebSocket one asks for neither. The token
  // is answered, so a run that takes that road goes on to dial and is seen to.
  const rtc = { configs: 0, tokens: 0, livekit: [] };
  await ctx.route(/api(\.us)?\.elevenlabs\.io/, (r) => {
    const url = r.request().url();
    if (/\/widget/.test(url)) {
      rtc.configs++;
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(config) });
    }
    if (/\/conversation\/token/.test(url)) {
      rtc.tokens++;
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ token: "tok_test" }) });
    }
    return r.abort("failed");
  });
  await ctx.route(/livekit\.rtc\.elevenlabs\.io/, (r) => {
    rtc.livekit.push(r.request().url().slice(0, 60));
    return r.abort("failed");
  });
  const askedBefore = resamplerAsked;
  const sent = [];
  const contexts = [];
  const sockets = [];
  await ctx.routeWebSocket(/elevenlabs\.io/, (ws) => {
    sockets.push(ws.url().slice(0, 60));
    ws.onMessage((m) => {
      let type = "binary";
      // Audio is {"user_audio_chunk": "<base64>"} — no `type` field — so the
      // first key names it; everything else carries a `type`.
      try {
        const j = JSON.parse(typeof m === "string" ? m : m.toString());
        type = j.type ?? Object.keys(j)[0] ?? "?";
        if (type === "contextual_update") contexts.push(String(j.text ?? ""));
      } catch { /* binary */ }
      sent.push(type);
      if (type === "conversation_initiation_client_data")
        ws.send(JSON.stringify({ type: "conversation_initiation_metadata", conversation_initiation_metadata_event: { conversation_id: "c_test", agent_output_audio_format: outputFormat, user_input_audio_format: "pcm_16000" } }));
    });
  });
  await ctx.addInitScript(() => {
    window.__violations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__violations.push(`${e.violatedDirective} ${e.blockedURI.slice(0, 100)}`));
    window.__called = false;
    window.addEventListener("elevenlabs-convai:call", () => { window.__called = true; });
  });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const hangup = { ready: "not reached", live: "not reached" };
  let terms = "not reached";
  // /find: the one page with a call button since 1 October.
  await page.goto(`http://127.0.0.1:${port}/find/`, { waitUntil: "networkidle" });
  await page.locator('button[aria-controls="wain-ai-panel"]').first().click();
  // Soft: a widget that never arrives — refused by its integrity, say — must
  // fail the assertions below, not throw and leave nothing reported.
  try {
    await page.waitForSelector("#wain-ai-panel elevenlabs-convai", { state: "attached", timeout: 15000 });
    await page.waitForTimeout(2500);
    hangup.ready = await hangupFree(page);
    const widget = page.locator("#wain-ai-panel elevenlabs-convai");
    await widget.getByRole("button", { name: /بدء مكالمة/ }).first().click({ timeout: 5000 });
    await page.waitForTimeout(1200);
    terms = await consentInside(page);
    const accept = widget.getByRole("button", { name: /قبول/ }).first();
    if (await accept.count()) await accept.click({ timeout: 5000 });
    await page.waitForTimeout(5000);
    hangup.live = await hangupFree(page);
  } catch (e) {
    console.log(`  · the call did not get as far as the widget: ${String(e.message).split("\n")[0]}`);
  }
  const header = await page.locator("#wain-ai-panel header").textContent();
  const violations = await page.evaluate(() => window.__violations);
  const called = await page.evaluate(() => window.__called);
  await browser.close();
  server.close();
  return { header, chunks: sent.filter((t) => t === "user_audio_chunk").length, sent, contexts, violations, hangup, resampler: resamplerAsked - askedBefore, called, terms, sockets, rtc };
}

/**
 * Is the consent sheet whole inside the box it is drawn in? The widget draws
 * it inside our slot (a transform makes the slot its containing block, and the
 * slot clips), and the slot waited for Start at a compact 11rem: the sheet's
 * heading and the first lines of the terms were cut off above it (8 October).
 */
async function consentInside(page) {
  return page.evaluate(() => {
    const slot = document.querySelector(".wain-ai-slot")?.getBoundingClientRect();
    const root = document.querySelector("#wain-ai-panel elevenlabs-convai")?.shadowRoot;
    if (!slot || !root) return "no widget";
    const parts = [...root.querySelectorAll("h1, h2, h3, h4, h5, p")]
      .filter((e) => /قبل ما تبدأ|لمّا تضغط/.test(e.textContent ?? ""));
    if (!parts.length) return "no consent sheet";
    for (const e of parts) {
      const r = e.getBoundingClientRect();
      if (r.top < slot.top - 1 || r.bottom > slot.bottom + 1)
        return `cut: «${(e.textContent ?? "").trim().slice(0, 14)}» at ${Math.round(r.top)}–${Math.round(r.bottom)}, box ${Math.round(slot.top)}–${Math.round(slot.bottom)}`;
    }
    return "whole";
  });
}

/**
 * Is our hang-up button the thing under its own centre? The widget draws its
 * UI with `position: fixed`, and until 7 October that put its «بدء مكالمة»
 * card, then its whole chat panel, over the sheet — hang-up included. Only the
 * real bundle shows it: the test stubs render inline.
 */
async function hangupFree(page) {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll("#wain-ai-panel button")].find((x) => /إنهاء المكالمة/.test(x.textContent ?? ""));
    if (!b) return "no hang-up button";
    // Its top edge as well as its middle: the live chat panel overlapped the
    // top of the button and left the middle clear, so a centre-only probe
    // passed with the bug in place.
    const r = b.getBoundingClientRect();
    for (const y of [r.y + 6, r.y + r.height / 2]) {
      const el = document.elementFromPoint(r.x + r.width / 2, y);
      if (!b.contains(el)) return `covered by <${el?.tagName.toLowerCase()}> at ${Math.round(y)}px`;
    }
    return "free";
  });
}

/**
 * The account out of credits, through the real widget (7 October). The refusal
 * arrives as the socket's close reason; the widget writes it into its own panel
 * and tells the page nothing, and the sheet reads it from there. The other side
 * of that check is the one only the real bundle can show: a caller's own words
 * about credits, typed into the widget's chat, sit in the same shadow root and
 * must not end the call (review of 7 October — the first check read all of it).
 */
const REASON = "[quota_exceeded] You've run out of credits. Add credits or upgrade your plan to start a new conversation.";
const PHRASE = "I've run out of credits on my phone, where can I top up near Salmiya?";
async function runCredits({ mode }) {
  const server = createServer((req, res) => {
    let file = join(OUT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) { res.writeHead(404); return res.end("nf"); }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "Content-Security-Policy": CSP, "Permissions-Policy": PERMISSIONS });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ar-KW", permissions: ["microphone"] });
  await ctx.route(/api(\.us)?\.elevenlabs\.io/, (r) => {
    if (/\/widget/.test(r.request().url()))
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(WIDGET_CONFIG) });
    return r.abort("failed");
  });
  const sent = [];
  await ctx.routeWebSocket(/elevenlabs\.io/, (ws) => {
    ws.onMessage((m) => {
      let j = {};
      try { j = JSON.parse(typeof m === "string" ? m : m.toString()); } catch { /* binary */ }
      const type = j.type ?? Object.keys(j)[0] ?? "?";
      sent.push(type);
      if (type === "conversation_initiation_client_data") {
        if (mode === "refuse") setTimeout(() => ws.close({ code: 3000, reason: REASON }), 200);
        else ws.send(JSON.stringify({ type: "conversation_initiation_metadata", conversation_initiation_metadata_event: { conversation_id: "c_test", agent_output_audio_format: "pcm_16000", user_input_audio_format: "pcm_16000" } }));
      }
      if (type === "user_message")
        setTimeout(() => ws.send(JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: "تقدر تشحن من أي جمعية.", event_id: 2 } })), 200);
    });
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/find/`, { waitUntil: "networkidle" });
  await page.locator('button[aria-controls="wain-ai-panel"]').first().click();
  const widget = page.locator("#wain-ai-panel elevenlabs-convai");
  let boxFont = null;
  try {
    await page.waitForSelector("#wain-ai-panel elevenlabs-convai", { state: "attached", timeout: 15000 });
    await page.waitForTimeout(2500);
    await widget.getByRole("button", { name: mode === "refuse" ? /بدء مكالمة/ : /رسالة/ }).first().click({ timeout: 5000 });
    await page.waitForTimeout(1200);
    const accept = widget.getByRole("button", { name: /قبول/ }).first();
    if (await accept.count()) await accept.click({ timeout: 5000 });
    if (mode === "typed") {
      await page.waitForTimeout(800);
      const box = widget.locator("textarea").first();
      // What the box is set in under a finger: iPhone Safari zooms the page into
      // any field under 16px when it takes focus, and leaves it zoomed.
      boxFont = await box.evaluate((el) => getComputedStyle(el).fontSize, null, { timeout: 5000 }).catch(() => "no box");
      await box.fill(PHRASE, { timeout: 5000 });
      await box.press("Enter");
    }
    await page.waitForTimeout(4000);
  } catch (e) {
    console.log(`  · the ${mode} run did not get as far as it meant to: ${String(e.message).split("\n")[0]}`);
  }
  const alert = await page.locator('#wain-ai-panel [role="alert"]').textContent({ timeout: 1000 }).catch(() => "");
  const result = {
    said: (alert ?? "").includes("دليل وين"),
    widgets: await page.locator("#wain-ai-panel elevenlabs-convai").count(),
    flag: await page.evaluate(() => localStorage.getItem("wain:agent-off")),
    sent,
    boxFont,
  };
  await browser.close();
  server.close();
  return result;
}

console.log(`\n── the real widget (${WIDGET_PATH}), a fake microphone, a mock socket ──`);
const bare = await run({ withPolicy: false });
ok("control: with no policy the widget opens the call and the header says connected", /متصل/.test(bare.header), bare.header);
ok("control: with no policy audio leaves the page", bare.chunks > 20, `${bare.chunks} chunks`);

console.log("\n── the same, under the Content-Security-Policy that ships ──");
const shipped = await run({ withPolicy: true });
ok("the header says connected (it said so throughout the bug)", /متصل/.test(shipped.header), shipped.header);
ok("the socket opened and sent its initiation", shipped.sent.includes("conversation_initiation_client_data"));
ok("the widget triggers no Content-Security-Policy violation at all", shipped.violations.length === 0, shipped.violations.join("; "));
ok("the widget stays in its box: hang-up is uncovered before Start", shipped.hangup.ready === "free", shipped.hangup.ready);
ok("and once the call is live", shipped.hangup.live === "free", shipped.hangup.live);
ok("the consent sheet is whole inside its box — heading and terms (390px)", shipped.terms === "whole", shipped.terms);
const narrow = await run({ withPolicy: true, viewport: { width: 320, height: 568 } });
ok("and on a 320px phone", narrow.terms === "whole", narrow.terms);
ok("audio leaves the page — a granted microphone is HEARD", shipped.chunks > 20, `${shipped.chunks} chunks; script-src needs blob: for the widget's AudioWorklet`);

/* The resampler, where the widget needs it (8 October). It loads one when the
   rate it plays at differs from the device's: every call in Safari before 18.6,
   which does not report the sampleRate constraint (BCD), and in Firefox, which
   never does — and on an iPhone on Bluetooth audio, where the context it warms
   on the first touch runs at the route's rate (AirPods: 44.1 kHz) against her
   48 kHz. The file comes from jsDelivr, at a URL fixed in its bundle, and the
   policy refused it: the widget's audio setup threw as the call started, so
   not one chunk left the page while the sheet said «متصل». Chromium raises no
   securitypolicyviolation for a refused worklet, which is why the checks are
   the file being fetched at all and the audio leaving, not a violation count:
   «no violation» passed under the old policy too (8 October). */
console.log("\n── Safari before 18.6 (no sampleRate constraint): the widget needs its resampler ──");
const oldSafari = await run({
  withPolicy: true,
  init: () => {
    const real = MediaDevices.prototype.getSupportedConstraints;
    MediaDevices.prototype.getSupportedConstraints = function () {
      const c = real.call(this);
      delete c.sampleRate;
      return c;
    };
  },
});
ok("the resampler is fetched (it is what this case needs)", oldSafari.resampler > 0, `${oldSafari.resampler} requests`);
ok("and audio leaves the page", oldSafari.chunks > 20, `${oldSafari.chunks} chunks`);

console.log("\n── an iPhone on AirPods: a 44.1 kHz route against her 48 kHz ──");
const airpods = await run({
  withPolicy: true,
  outputFormat: "pcm_48000",
  init: () => {
    Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: () => "iPhone" });
    const Real = window.AudioContext;
    // A context made with no rate takes the route's, as WebKit's does.
    window.AudioContext = class extends Real {
      constructor(o) { super(o && o.sampleRate ? o : { ...(o || {}), sampleRate: 44100 }); }
    };
  },
});
ok("the resampler is fetched (it is what this case needs)", airpods.resampler > 0, `${airpods.resampler} requests`);
ok("and audio leaves the page", airpods.chunks > 20, `${airpods.chunks} chunks`);

/* Safari with «Block All Cookies»: every read of storage throws. The widget
   reads it, unguarded, to name the caller after the terms and before the call
   starts — so «قبول» did nothing at all (8 October, read out of 0.19.0). */
console.log("\n── Safari with «Block All Cookies»: storage throws ──");
const blocked = await run({
  withPolicy: true,
  init: () => {
    for (const name of ["localStorage", "sessionStorage"])
      Object.defineProperty(window, name, {
        configurable: true,
        get() { throw new DOMException("The operation is insecure.", "SecurityError"); },
      });
  },
});
ok("pressing Start starts the call", blocked.called, JSON.stringify({ called: blocked.called, sent: blocked.sent.slice(0, 4) }));
ok("and audio leaves the page", blocked.chunks > 20, `${blocked.chunks} chunks`);

console.log("\n── out of credits, through the real widget ──");
const refused = await runCredits({ mode: "refuse" });
ok("a refusal for credits is read out of the widget and said on the sheet", refused.said, JSON.stringify({ ...refused, sent: refused.sent.slice(0, 6) }));
ok("the widget is taken off the sheet", refused.widgets === 0, `${refused.widgets} widgets`);
ok("and the device remembers it", refused.flag !== null);
const typed = await runCredits({ mode: "typed" });
ok("control: the caller's words reached the conversation", typed.sent.includes("user_message"), typed.sent.join(","));
ok("a caller who types about their own credits is not a refusal", !typed.said);
ok("the call goes on", typed.widgets === 1, `${typed.widgets} widgets`);
ok("and the device does not switch her off", typed.flag === null, String(typed.flag));
// The widget sets its own text box, inside its shadow root, at 14px; the call
// gives it a 16px floor on a touch screen (WainAiCall), as the site's own
// fields have — or an iPhone zooms the call sheet in on the first tap into it.
ok("the widget's text box is 16px under a finger, so an iPhone does not zoom into it",
  parseFloat(typed.boxFont) >= 16, String(typed.boxFont));

/**
 * The job a caller brings from the agent before (lib/agent-job.ts) goes into
 * the call as a contextual update — background the agent reads and never
 * answers. Through the real widget, because the widget decides: it passes the
 * page's event on only with `allow-events` on the element, and only while a
 * conversation is open (14 October, read out of 0.19.0).
 */
console.log("\n── the job from the agent before goes into the call ──");
const seedJob = (by) => `(() => {
  if (sessionStorage.getItem("__seeded")) return;
  sessionStorage.setItem("__seeded", "1");
  sessionStorage.setItem("wain:job:v1", JSON.stringify({ v: 1, by: ${JSON.stringify(by)}, asked: "قهوة هادية",
    shown: ["mubarakiya-tea-houses"], ranked: ["mubarakiya-tea-houses"], picked: "mubarakiya-tea-houses", at: Date.now() }));
})()`;
const handed = await run({ withPolicy: true, init: seedJob("salem-chat") });
ok("control: the call opened", handed.sent.includes("conversation_initiation_client_data"), handed.sent.slice(0, 4).join(","));
ok("the call is told the job once its line is open", handed.contexts.length === 1, `${handed.contexts.length} updates; sent: ${handed.sent.slice(0, 8).join(",")}`);
ok("naming who had it and what was asked", /سالم/.test(handed.contexts[0] ?? "") && /قهوة هادية/.test(handed.contexts[0] ?? ""), handed.contexts[0] ?? "");
ok("and the place picked there, by name", /اختار منها/.test(handed.contexts[0] ?? ""), handed.contexts[0] ?? "");
const own = await run({ withPolicy: true, init: seedJob("shouq-call") });
// An absence needs its call to have opened, or a run that never reached the
// widget passes it (run() reports and carries on).
ok("control: her own call opened", own.sent.includes("conversation_initiation_client_data"), own.sent.slice(0, 4).join(","));
ok("her own last job is not handed back to her as news", own.contexts.length === 0, own.contexts.join(" | "));

/**
 * The widget ends a call without telling the page (8 October). The agent's
 * end_call, the server's limit on a call's length and the caller's own إنهاء
 * inside the widget all end the session: 0.19.0 dispatches no end event, and
 * its startSession overwrites any callback the page passed in. What it does in
 * every case is take its red إنهاء away, bring back its بدء مكالمة and keep its
 * rating on screen. The sheet read none of that — it kept saying «متصل» and its
 * clock kept running over a call that had ended. Measured on the real bundle,
 * the start control returns within about 60ms of the end.
 *
 * `how` is the way the call ends. `redial` presses the widget's own Start
 * afterwards, which must make the sheet live again. That is a guard for the
 * fix, not a red-first check: it passed before the fix and must still pass.
 *
 * `refused` is a line that never opens: the socket closes before the server's
 * metadata. The widget had drawn its إنهاء while connecting and takes it away
 * again, which is exactly what an end looks like from the sheet — so it said
 * «انتهت المكالمة · ٠٠:٠٠» over a call that never happened.
 *
 * `drop` is a line that opened and then went down with an error: the server
 * closes the socket with a code that is not the ordinary 1000. The widget
 * brings its Start back exactly as it does for an end and writes the server's
 * reason, in English, into its own panel — and the sheet said «انتهت
 * المكالمة», as if somebody had hung up (measured 10 November: «حدث خطأ
 * Internal server error» in the widget under a sheet that said the call ended).
 * The length limit writes into the same block, so the block alone cannot tell
 * the two apart; `max` above stays an end. `late-quota` is the refusal for
 * credits arriving on a line that had opened: that one keeps its own words.
 *
 * The headline — the large line under her face — is read beside the header:
 * it went on saying «على الخط — كلّمها عادي» under a header that said the call
 * had ended.
 *
 * `stale` puts error text in the widget while the call is still up, where the
 * widget writes its own: a file the caller attached and the provider refused
 * lands in that class mid-call («Failed to fetch», measured), and so does a
 * failed tool when the widget shows tool status. It is planted here rather
 * than produced, because this agent's widget clears an attachment as the call
 * ends. Error text that was already there is not the end's.
 */
async function runEnd({ how, redial = false, stale = false }) {
  const server = createServer((req, res) => {
    let file = join(OUT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) { res.writeHead(404); return res.end("nf"); }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "Content-Security-Policy": CSP, "Permissions-Policy": PERMISSIONS });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ar-KW", permissions: ["microphone"] });
  await ctx.route(/api(\.us)?\.elevenlabs\.io/, (r) => {
    if (/\/widget/.test(r.request().url()))
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(WIDGET_CONFIG) });
    return r.abort("failed");
  });
  // Kept, not only answered: the end has to go down the socket the call is on.
  let sock = null;
  let opened = false;
  await ctx.routeWebSocket(/elevenlabs\.io/, (ws) => {
    sock = ws;
    ws.onMessage((m) => {
      let j = {};
      try { j = JSON.parse(typeof m === "string" ? m : m.toString()); } catch { /* binary audio */ }
      if (j.type !== "conversation_initiation_client_data") return;
      opened = true;
      if (how === "refused") setTimeout(() => { try { ws.close({ code: 1008, reason: "Agent not available" }); } catch { /* gone */ } }, 300);
      else ws.send(JSON.stringify({ type: "conversation_initiation_metadata", conversation_initiation_metadata_event: { conversation_id: "c_test", agent_output_audio_format: "pcm_16000", user_input_audio_format: "pcm_16000" } }));
    });
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/find/`, { waitUntil: "networkidle" });
  await page.locator('button[aria-controls="wain-ai-panel"]').first().click();
  const widget = page.locator("#wain-ai-panel elevenlabs-convai");
  // The sheet's own line under her name, whitespace folded.
  const line = () => page.locator("#wain-ai-panel header").textContent({ timeout: 1000 }).then((t) => t.replace(/\s+/g, " ").trim(), () => "");
  // The large line under her face. While the call is up it is the sheet's only
  // p.font-display; the ended screen's own is drawn in another phase.
  const head = () => page.locator("#wain-ai-panel p.font-display").first().textContent({ timeout: 1000 }).then((t) => t.replace(/\s+/g, " ").trim(), () => "");
  const r = { live: "", ended: "", endedLater: "", widgets: -1, redialed: "", alert: "", opened: false, headLive: "", headEnded: "", headRedialed: "", again: -1 };
  try {
    await page.waitForSelector("#wain-ai-panel elevenlabs-convai", { state: "attached", timeout: 15000 });
    await page.waitForTimeout(2500);
    await widget.getByRole("button", { name: /بدء مكالمة/ }).first().click({ timeout: 5000 });
    await page.waitForTimeout(1200);
    const accept = widget.getByRole("button", { name: /قبول/ }).first();
    if (await accept.count()) await accept.click({ timeout: 5000 });
    await page.waitForTimeout(3000);
    r.live = await line();
    r.headLive = await head();
    r.opened = opened;
    if (stale) {
      r.planted = await page.evaluate(() => {
        const root = document.querySelector("#wain-ai-panel elevenlabs-convai")?.shadowRoot;
        if (!root) return false;
        const said = document.createElement("span");
        said.className = "text-xs text-base-error";
        said.textContent = "Failed to fetch";
        root.appendChild(said);
        return true;
      });
      await page.waitForTimeout(400);
    }
    const alert = async () => (await page.locator('#wain-ai-panel [role="alert"]').textContent({ timeout: 1000 }).catch(() => "")) ?? "";
    // A refused line has nothing to end: what the sheet says by now is it.
    if (how === "refused") r.alert = await alert();
    else {
      if (how === "agent")
        sock.send(JSON.stringify({ type: "agent_tool_response", agent_tool_response: { tool_name: "end_call", tool_call_id: "t-end", tool_type: "system", is_error: false, event_id: 9 } }));
      else if (how === "max")
        sock.send(JSON.stringify({ type: "error", error_event: { error_type: "max_duration_exceeded", message: "limit" } }));
      else if (how === "drop")
        sock.close({ code: 1011, reason: "Internal server error" });
      else if (how === "late-quota")
        sock.close({ code: 3000, reason: REASON });
      else
        await widget.getByRole("button", { name: /إنهاء/ }).first().click({ timeout: 5000 });
      await page.waitForTimeout(2000);
      r.ended = await line();
      r.headEnded = await head();
      r.alert = await alert();
      r.again = await page.locator("#wain-ai-panel").getByRole("button", { name: "اتصل مرة ثانية" }).count();
      r.errorsLeft = await page.evaluate(() =>
        [...(document.querySelector("#wain-ai-panel elevenlabs-convai")?.shadowRoot?.querySelectorAll(".text-base-error") ?? [])]
          .map((n) => n.textContent ?? "").filter(Boolean)).catch(() => []);
      await page.waitForTimeout(2500);
      r.endedLater = await line();
      r.widgets = await page.locator("#wain-ai-panel elevenlabs-convai").count();
    }
    if (redial) {
      await widget.getByRole("button", { name: /بدء مكالمة/ }).first().click({ timeout: 5000 });
      await page.waitForTimeout(1200);
      const again = widget.getByRole("button", { name: /قبول/ }).first();
      if (await again.count()) await again.click({ timeout: 5000 });
      await page.waitForTimeout(3000);
      r.redialed = await line();
      r.headRedialed = await head();
    }
  } catch (e) {
    console.log(`  · the ${how} end did not get as far as it meant to: ${String(e.message).split("\n")[0]}`);
  }
  await browser.close();
  server.close();
  return r;
}

console.log("\n── the widget ends a call on its own, and the sheet follows ──");
for (const [how, label] of [
  ["agent", "the agent's end_call"],
  ["max", "the server's limit on a call's length"],
  ["caller", "the caller's own إنهاء in the widget"],
]) {
  const e = await runEnd({ how, redial: how === "agent" });
  ok(`${label}: the sheet was live before it`, e.live.includes("متصل"), e.live);
  ok(`${label}: the sheet says the call ended, not متصل`, e.ended.includes("انتهت المكالمة") && !e.ended.includes("متصل"), e.ended);
  ok(`${label}: the clock stops at the end`, e.ended !== "" && e.ended === e.endedLater, `${e.ended} → ${e.endedLater}`);
  ok(`${label}: the widget stays on the sheet, with its rating`, e.widgets === 1, `${e.widgets} widgets`);
  // The headline could only have gone on saying it if it said it before.
  ok(`${label}: control: the line under her face said she was on the line`, e.headLive.includes("على الخط"), e.headLive);
  ok(`${label}: and says the call ended once it has, not «على الخط»`,
    e.headEnded.includes("انتهت المكالمة") && !e.headEnded.includes("على الخط"), e.headEnded);
  if (how === "agent") {
    ok("a redial from the widget's own Start makes the sheet live again", e.redialed.includes("متصل"), e.redialed);
    ok("and the line under her face is on the line again", e.headRedialed.includes("على الخط"), e.headRedialed);
  }
}

console.log("\n── a line refused before it opens is not a call that ended ──");
{
  const e = await runEnd({ how: "refused" });
  ok("control: the line was asked for", e.opened);
  ok("the sheet says the line could not be reached, in the failure line the other unreachable calls get",
    e.alert.includes("ما قدرنا نوصلك بشوق"), e.alert || e.live);
  ok("and not that a call of ٠٠:٠٠ ended", !e.live.includes("انتهت المكالمة"), e.live);
}

/**
 * Hung up while the line is still opening: after Start and «قبول», before the
 * server has answered. Hanging up removes the widget, and the widget's own
 * cleanup ends only a conversation it has already stored — which it does after
 * the session starts. So the session opened with no sheet: measured on this
 * bundle with the server three seconds slow, 141 audio chunks left the page
 * after the hang-up and a show_places the server sent moved the page. The
 * server here answers three seconds late and then asks for the screen.
 */
async function runHangUpWhileConnecting() {
  const server = createServer((req, res) => {
    let file = join(OUT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) { res.writeHead(404); return res.end("nf"); }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "Content-Security-Policy": CSP, "Permissions-Policy": PERMISSIONS });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ar-KW", permissions: ["microphone"] });
  await ctx.route(/api(\.us)?\.elevenlabs\.io/, (r) => {
    if (/\/widget/.test(r.request().url()))
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(WIDGET_CONFIG) });
    return r.abort("failed");
  });
  const t = { opened: false, hungUpAt: 0, clickedAt: 0, answeredAt: 0, closed: false, after: [] };
  await ctx.routeWebSocket(/elevenlabs\.io/, (ws) => {
    // The page closing the socket is the line going down.
    ws.onClose(() => { t.closed = true; });
    ws.onMessage((m) => {
      let j = {};
      try { j = JSON.parse(typeof m === "string" ? m : m.toString()); } catch { /* binary audio */ }
      const type = j.type ?? Object.keys(j)[0] ?? "?";
      if (t.hungUpAt) t.after.push(type);
      if (type !== "conversation_initiation_client_data") return;
      t.opened = true;
      setTimeout(() => {
        try {
          ws.send(JSON.stringify({ type: "conversation_initiation_metadata", conversation_initiation_metadata_event: { conversation_id: "c_test", agent_output_audio_format: "pcm_16000", user_input_audio_format: "pcm_16000" } }));
          t.answeredAt = Date.now();
        } catch { /* the page has gone */ }
        setTimeout(() => {
          try {
            ws.send(JSON.stringify({ type: "client_tool_call", client_tool_call: { tool_call_id: "late-1", tool_name: "show_places", parameters: { query: "بحر" } } }));
          } catch { /* the page has gone */ }
        }, 300);
      }, 3000);
    });
  });
  const page = await ctx.newPage();
  const r = { header: "", url: "", closed: false };
  try {
    await page.goto(`http://127.0.0.1:${port}/find/`, { waitUntil: "networkidle" });
    await page.locator('button[aria-controls="wain-ai-panel"]').first().click();
    const widget = page.locator("#wain-ai-panel elevenlabs-convai");
    await page.waitForSelector("#wain-ai-panel elevenlabs-convai", { state: "attached", timeout: 15000 });
    await page.waitForTimeout(2500);
    await widget.getByRole("button", { name: /بدء مكالمة/ }).first().click({ timeout: 5000 });
    await page.waitForTimeout(1200);
    const accept = widget.getByRole("button", { name: /قبول/ }).first();
    if (await accept.count()) await accept.click({ timeout: 5000 });
    for (let i = 0; i < 80 && !t.opened; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(300);
    t.hungUpAt = Date.now();
    await page.locator("#wain-ai-panel button", { hasText: "إنهاء المكالمة" }).first().click({ timeout: 5000 });
    // When the click LANDED. It may wait on the button for seconds, and a
    // hang-up that lands after the line has opened is an ordinary one: the
    // control has to say which this run was.
    t.clickedAt = Date.now();
    await page.waitForTimeout(5500);
    r.header = (await page.locator("#wain-ai-panel header").textContent({ timeout: 1000 }).catch(() => "")) ?? "";
    r.url = decodeURIComponent(page.url());
  } catch (e) {
    console.log(`  · the early hang-up did not get as far as it meant to: ${String(e.message).split("\n")[0]}`);
  }
  // Read before the browser goes: Playwright reports a page-side close to a
  // routed socket when the page itself is closed, so read afterwards this was
  // true for a session that streamed to the end.
  r.closed = t.closed;
  await browser.close();
  server.close();
  return { ...t, ...r };
}

console.log("\n── hung up while the line is still opening, the line goes down too ──");
{
  const e = await runHangUpWhileConnecting();
  ok("control: the caller hung up before the server answered", e.opened && e.clickedAt > 0 && e.answeredAt > e.clickedAt,
    JSON.stringify({ opened: e.opened, answeredAfterHangUp: e.answeredAt - e.clickedAt }));
  ok("the sheet says the call ended", e.header.includes("انتهت المكالمة"), e.header);
  ok("the page closes the socket once the line opens", e.closed, e.after.slice(0, 8).join(","));
  // Not zero: a chunk can leave between the line opening and the end that
  // follows it a tick later. Before, it was every chunk for as long as the
  // session ran.
  const chunks = e.after.filter((x) => x === "user_audio_chunk").length;
  ok("no stream of microphone audio after the hang-up", chunks <= 2, `${chunks} audio chunk(s) after the hang-up`);
  ok("and her tools do not act for a caller who has gone",
    !e.after.includes("client_tool_result") && !e.url.includes("بحر"), `${e.url} · ${e.after.filter((x) => x !== "user_audio_chunk").join(",")}`);
}

/**
 * A page on /find with the call dialled and the real widget on it, for the
 * parts below: the server, the browser and the two routes every run above sets
 * up by hand. `config` is what the widget's own config request is answered
 * with — null fails it, as an unreachable host does — and `onSocket` is handed
 * each socket the call opens.
 */
async function sheet({ config = WIDGET_CONFIG, onSocket = () => {}, init = null } = {}) {
  const server = createServer((req, res) => {
    let file = join(OUT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) { res.writeHead(404); return res.end("nf"); }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "Content-Security-Policy": CSP, "Permissions-Policy": PERMISSIONS });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ar-KW", permissions: ["microphone"] });
  const asked = { configs: 0 };
  await ctx.route(/api(\.us)?\.elevenlabs\.io/, (r) => {
    if (/\/widget/.test(r.request().url())) {
      asked.configs++;
      if (config) return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(config) });
    }
    return r.abort("failed");
  });
  await ctx.routeWebSocket(/elevenlabs\.io/, onSocket);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/find/`, { waitUntil: "networkidle" });
  await page.locator('button[aria-controls="wain-ai-panel"]').first().click();
  return {
    page,
    asked,
    widget: page.locator("#wain-ai-panel elevenlabs-convai"),
    close: async () => { await browser.close(); server.close(); },
  };
}
const METADATA = JSON.stringify({ type: "conversation_initiation_metadata", conversation_initiation_metadata_event: { conversation_id: "c_test", agent_output_audio_format: "pcm_16000", user_input_audio_format: "pcm_16000" } });

/**
 * «متصل» belongs to a line that has opened. The sheet said it — with the two
 * rising notes and a running clock — at the widget's call event, which the
 * widget dispatches BEFORE it asks the SDK for a session (read out of 0.19.0:
 * the event, then startSession). On a quick line nobody sees the gap; on a
 * slow one the caller is told she is on the line, speaks, and is heard by
 * nothing. The SDK's onConnect is the line opening, and the widget leaves that
 * callback to the page. The server here answers a second and a half late, and
 * the sheet is read inside that wait.
 *
 * The tones are counted where they are made: every tone on the site is one
 * oscillator, and the «she is on the line» pair starts at 587 Hz.
 */
const HOLD_MS = 1500;
async function runSlowLine() {
  const t = { asked: 0, answered: 0 };
  const s = await sheet({
    init: () => {
      window.__tones = [];
      window.__called = 0;
      window.addEventListener("elevenlabs-convai:call", () => { window.__called++; });
      const make = BaseAudioContext.prototype.createOscillator;
      BaseAudioContext.prototype.createOscillator = function () {
        const osc = make.call(this);
        window.__tones.push(osc);
        return osc;
      };
    },
    onSocket: (ws) => {
      ws.onMessage((m) => {
        let j = {};
        try { j = JSON.parse(typeof m === "string" ? m : m.toString()); } catch { /* binary audio */ }
        if (j.type !== "conversation_initiation_client_data") return;
        t.asked = Date.now();
        setTimeout(() => {
          try { ws.send(METADATA); t.answered = Date.now(); } catch { /* the page has gone */ }
        }, HOLD_MS);
      });
    },
  });
  const read = () => s.page.evaluate(() => {
    const fold = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    return {
      header: fold(document.querySelector("#wain-ai-panel header")),
      headline: fold(document.querySelector("#wain-ai-panel p.font-display")),
      panel: fold(document.querySelector("#wain-ai-panel")),
      chimes: window.__tones.filter((o) => Math.round(o.frequency.value) === 587).length,
      called: window.__called,
    };
  });
  const r = { during: null, sampledAt: 0, after: null };
  try {
    await s.page.waitForSelector("#wain-ai-panel elevenlabs-convai", { state: "attached", timeout: 15000 });
    await s.page.waitForTimeout(2500);
    await s.widget.getByRole("button", { name: /بدء مكالمة/ }).first().click({ timeout: 5000 });
    await s.page.waitForTimeout(1200);
    const accept = s.widget.getByRole("button", { name: /قبول/ }).first();
    if (await accept.count()) await accept.click({ timeout: 5000 });
    // The line has been asked for and the server is sitting on its answer.
    for (let i = 0; i < 100 && !t.asked; i++) await s.page.waitForTimeout(50);
    await s.page.waitForTimeout(400);
    r.during = await read();
    r.sampledAt = Date.now();
    for (let i = 0; i < 80 && !t.answered; i++) await s.page.waitForTimeout(100);
    await s.page.waitForTimeout(1500);
    r.after = await read();
  } catch (e) {
    console.log(`  · the slow line did not get as far as it meant to: ${String(e.message).split("\n")[0]}`);
  }
  await s.close();
  return { ...t, ...r };
}

await section("«متصل», the chime and the clock wait for the line to open, not for Start", async () => {
  const CLOCK = /[٠-٩]{2}:[٠-٩]{2}/;
  const e = await runSlowLine();
  const d = e.during ?? { header: "(unread)", headline: "", panel: "", chimes: -1, called: 0 };
  const a = e.after ?? { header: "(unread)", headline: "", panel: "", chimes: -1, called: 0 };
  // The sample has to sit between Start and the server's answer, or what it
  // read proves nothing about that wait.
  ok("control: Start was pressed, the line was asked for, and the sheet was read before the server answered",
    d.called === 1 && e.asked > 0 && e.sampledAt > 0 && (e.answered === 0 || e.sampledAt < e.answered),
    JSON.stringify({ called: d.called, asked: e.asked > 0, readBeforeAnswerMs: e.answered ? e.answered - e.sampledAt : null }));
  ok("while the line is opening the header does not say «متصل»", !d.header.includes("متصل"), d.header);
  ok("it says she is being reached, in the line the ring already uses", d.header.includes("نوصّلك بشوق"), d.header);
  ok("no clock runs over a line that has not opened", !CLOCK.test(d.header), d.header);
  ok("the two notes that say she is on the line have not sounded", d.chimes === 0, `${d.chimes} chime(s)`);
  ok("and the caller is not told to talk yet — not «على الخط», no examples",
    !d.headline.includes("على الخط") && !d.panel.includes("قهوة هادية"), `${d.headline} · ${d.panel.slice(0, 120)}`);
  ok("the «press Start» prompt is over all the same — Start was pressed", !d.header.includes("جاهزة") && !d.panel.includes("اضغط «بدء مكالمة»"), d.panel.slice(0, 160));
  ok("once the line opens the header says «متصل»", a.header.includes("متصل"), a.header);
  ok("the clock runs", CLOCK.test(a.header), a.header);
  ok("the notes sound, once", a.chimes === 1, `${a.chimes} chime(s)`);
  ok("and she is on the line", a.headline.includes("على الخط") && a.panel.includes("قهوة هادية"), a.headline);
});

await section("a line that opened and then dropped with an error is not a call that ended", async () => {
  const e = await runEnd({ how: "drop" });
  ok("control: the call was up before the line dropped", e.live.includes("متصل"), e.live);
  ok("the sheet says the line was lost, in the failure line the unreachable calls get",
    e.alert.includes("ما قدرنا نوصلك بشوق"), e.alert || e.ended);
  ok("and not that the call ended, as a hang-up does", !e.ended.includes("انتهت المكالمة"), e.ended);
  ok("with «اتصل مرة ثانية» to try again", e.again === 1, `${e.again} button(s)`);
  // The widget's error class is not only for a line going down. Error text it
  // wrote while the call was up is still there when she ends the call herself,
  // and that end is an end.
  const s = await runEnd({ how: "agent", stale: true });
  ok("control: error text from earlier in the call is in the widget when she ends it",
    s.planted === true && (s.errorsLeft ?? []).includes("Failed to fetch"), JSON.stringify({ planted: s.planted, left: s.errorsLeft }));
  ok("her own end is still an end, with the widget and its rating left on the sheet",
    s.ended.includes("انتهت المكالمة") && s.alert === "" && s.widgets === 1, `${s.ended} · ${s.alert} · ${s.widgets} widget(s)`);
  // The same block of the widget holds the refusal for credits, and that one
  // has its own sentence and its own memory (the next call is the free one).
  const q = await runEnd({ how: "late-quota" });
  ok("control: that call was up too", q.live.includes("متصل"), q.live);
  ok("a refusal for credits on an open line keeps its own words",
    q.alert.includes("دليل وين") && !q.alert.includes("ما قدرنا نوصلك"), q.alert || q.ended);
});

/**
 * The widget never gets its config — offline, the provider unreachable, the
 * agent removed. It draws nothing at all (0.19.0 renders null without a
 * config, and says why only in the console), so there is no «بدء مكالمة» to
 * press, and the sheet went on saying «جاهزة — اضغط «بدء مكالمة»», then
 * pointed at the button again after fifteen seconds, for ever: hanging up was
 * the only way out (measured 10 November). The wait is the sheet's own
 * fifteen seconds; nothing here can shorten it.
 */
async function runUnpressed({ config }) {
  const s = await sheet({ config });
  const r = { buttons: -1, ready: "", alert: "", nudged: false, widgets: -1, again: -1, configs: 0 };
  const fold = (t) => (t ?? "").replace(/\s+/g, " ").trim();
  try {
    await s.page.waitForSelector("#wain-ai-panel elevenlabs-convai", { state: "attached", timeout: 15000 });
    await s.page.waitForTimeout(2500);
    r.buttons = await s.page.evaluate(() => document.querySelector("#wain-ai-panel elevenlabs-convai")?.shadowRoot?.querySelectorAll("button").length ?? -1);
    r.ready = fold(await s.page.locator("#wain-ai-panel header").textContent({ timeout: 1000 }).catch(() => ""));
    // Whichever comes: the failure, or the nudge at the button.
    await s.page.waitForFunction(
      () => !!document.querySelector('#wain-ai-panel [role="alert"]') ||
        (document.querySelector("#wain-ai-panel")?.textContent ?? "").includes("للحين ما بدأت المكالمة"),
      null, { timeout: 20000 }
    ).catch(() => {});
    await s.page.waitForTimeout(800);
    r.alert = fold(await s.page.locator('#wain-ai-panel [role="alert"]').textContent({ timeout: 1000 }).catch(() => ""));
    r.nudged = fold(await s.page.locator("#wain-ai-panel").textContent({ timeout: 1000 }).catch(() => "")).includes("للحين ما بدأت المكالمة");
    r.widgets = await s.page.locator("#wain-ai-panel elevenlabs-convai").count();
    r.again = await s.page.locator("#wain-ai-panel").getByRole("button", { name: "اتصل مرة ثانية" }).count();
  } catch (e) {
    console.log(`  · the unpressed call did not get as far as it meant to: ${String(e.message).split("\n")[0]}`);
  }
  r.configs = s.asked.configs;
  await s.close();
  return r;
}

await section("a widget that never gets its config is a call that could not be reached, not a button to wait for", async () => {
  const e = await runUnpressed({ config: null });
  ok("control: the widget asked for its config, was refused, and drew nothing to press",
    e.configs > 0 && e.buttons === 0 && e.ready.includes("جاهزة"), JSON.stringify({ configs: e.configs, buttons: e.buttons, ready: e.ready }));
  ok("after its wait the sheet says the line could not be reached", e.alert.includes("ما قدرنا نوصلك بشوق"), e.alert || "(no alert)");
  ok("and does not point again at a button that is not there", !e.nudged);
  ok("with «اتصل مرة ثانية» to try again", e.again === 1, `${e.again} button(s)`);
  // The other side: a widget that did draw its Start, and a caller who has not
  // pressed it yet, is still only pointed at it. The call is not failed.
  const c = await runUnpressed({ config: WIDGET_CONFIG });
  ok("control: with its config the widget draws «بدء مكالمة»", c.buttons > 0, `${c.buttons} button(s)`);
  ok("an unpressed Start is still only pointed at, after the same wait", c.nudged, c.alert || "(no nudge)");
  ok("and that call is not failed — no alert, the widget still on the sheet", c.alert === "" && c.widgets === 1, `${c.alert} · ${c.widgets} widget(s)`);
});

/**
 * The transport is the page's, not the dashboard's. The widget takes WebRTC
 * when its config says `use_rtc`, and a `use-rtc` attribute on the element
 * outranks the config (read out of 0.19.0: the attribute, else the config,
 * else off). WebRTC asks for a room token and dials wss://livekit.rtc.…, which
 * connect-src does not name — so one switch in the agent's dashboard would
 * have failed every call from the site, as a line the sheet could not reach
 * and nothing anywhere saying why. This policy and every run above were measured
 * on the WebSocket; the element says so now. The config served here asks for
 * WebRTC, and the token is answered, so a widget that obeyed it is seen
 * dialling. What is read is the token and the dial, not the refusal: a routed
 * socket is a stand-in the policy never sees, so no violation is raised for it
 * here (the run without the attribute dialled LiveKit and recorded none).
 */
await section("a WebRTC switch in the agent's dashboard does not move the call", async () => {
  const asksRtc = { ...WIDGET_CONFIG, widget_config: { ...WIDGET_CONFIG.widget_config, use_rtc: true } };
  const r = await run({ withPolicy: true, config: asksRtc });
  const took = JSON.stringify({ sockets: r.sockets, tokens: r.rtc.tokens, livekit: r.rtc.livekit, violations: r.violations, sent: r.sent.slice(0, 3) });
  ok("control: the widget was handed a config that asks for WebRTC", r.rtc.configs > 0 && r.called, `${r.rtc.configs} config(s) served; Start pressed: ${r.called}`);
  ok("the call still opens on the WebSocket the policy allows",
    r.sent.includes("conversation_initiation_client_data") && r.sockets.some((u) => u.startsWith("wss://api.us.elevenlabs.io/")), took);
  ok("nothing asks for a LiveKit room — no token, no socket, no request, no refusal by the policy",
    r.rtc.tokens === 0 && r.rtc.livekit.length === 0 && !r.sockets.some((u) => /livekit/.test(u)) && !r.violations.some((v) => /livekit/.test(v)), took);
  ok("and audio leaves the page", r.chunks > 20, `${r.chunks} chunks`);
});

/**
 * Who the widget says is calling. Left to itself it names the caller: it
 * reads `elevenlabs_convai_user_id` from localStorage, and on a device's first
 * call computes one with FingerprintJS, keeps it there and sends it as the
 * session's `user_id` — a device identifier, the same on every later call,
 * on a site whose privacy page says no tracking tool is used. Given a
 * `user-id` on the element it does none of that. So the page gives it one,
 * made for this call alone. Two calls in one tab, because the second is where
 * a kept id shows: before, it carried the first call's.
 */
async function runTwoCalls() {
  const server = createServer((req, res) => {
    let file = join(OUT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) { res.writeHead(404); return res.end("nf"); }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "Content-Security-Policy": CSP, "Permissions-Policy": PERMISSIONS });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ar-KW", permissions: ["microphone"] });
  await ctx.route(/api(\.us)?\.elevenlabs\.io/, (r) => {
    if (/\/widget/.test(r.request().url()))
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(WIDGET_CONFIG) });
    return r.abort("failed");
  });
  // The `user_id` each session opened with, in order; null where it sent none.
  const sentIds = [];
  await ctx.routeWebSocket(/elevenlabs\.io/, (ws) => {
    ws.onMessage((m) => {
      let j = {};
      try { j = JSON.parse(typeof m === "string" ? m : m.toString()); } catch { /* binary audio */ }
      if (j.type !== "conversation_initiation_client_data") return;
      sentIds.push(j.user_id ?? null);
      ws.send(JSON.stringify({ type: "conversation_initiation_metadata", conversation_initiation_metadata_event: { conversation_id: `c_test_${sentIds.length}`, agent_output_audio_format: "pcm_16000", user_input_audio_format: "pcm_16000" } }));
    });
  });
  const page = await ctx.newPage();
  // The id on each call's element, as the page set it; null where it set none.
  const r = { given: [], kept: "unread", storage: "unread" };
  const widget = page.locator("#wain-ai-panel elevenlabs-convai");
  const start = async (n) => {
    await page.waitForSelector("#wain-ai-panel elevenlabs-convai", { state: "attached", timeout: 15000 });
    await page.waitForTimeout(2500);
    r.given.push(await widget.getAttribute("user-id", { timeout: 2000 }));
    await widget.getByRole("button", { name: /بدء مكالمة/ }).first().click({ timeout: 5000 });
    await page.waitForTimeout(1200);
    const accept = widget.getByRole("button", { name: /قبول/ }).first();
    if (await accept.count()) await accept.click({ timeout: 5000 });
    for (let i = 0; i < 80 && sentIds.length < n; i++) await page.waitForTimeout(100);
  };
  try {
    await page.goto(`http://127.0.0.1:${port}/find/`, { waitUntil: "networkidle" });
    await page.locator('button[aria-controls="wain-ai-panel"]').first().click();
    await start(1);
    await page.locator("#wain-ai-panel button", { hasText: "إنهاء المكالمة" }).first().click({ timeout: 5000 });
    await page.locator("#wain-ai-panel").getByRole("button", { name: "اتصل مرة ثانية" }).click({ timeout: 5000 });
    // The first call's widget goes with the redial; the wait in start() is for
    // the second's.
    await page.waitForFunction(() => !document.querySelector("#wain-ai-panel elevenlabs-convai"), null, { timeout: 3000 }).catch(() => {});
    await start(2);
  } catch (e) {
    console.log(`  · the two calls did not get as far as they meant to: ${String(e.message).split("\n")[0]}`);
  }
  r.kept = await page.evaluate(() => localStorage.getItem("elevenlabs_convai_user_id")).catch((e) => `unread: ${e.message}`);
  // That the widget COULD have kept one here: this browser's storage works.
  r.storage = await page.evaluate(() => {
    localStorage.setItem("wain:test-probe", "1");
    const v = localStorage.getItem("wain:test-probe");
    localStorage.removeItem("wain:test-probe");
    return v;
  }).catch((e) => `unread: ${e.message}`);
  await browser.close();
  server.close();
  return { ...r, sentIds };
}

await section("the caller is named for one call only, and nothing is kept to name them again", async () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const t = await runTwoCalls();
  const seen = JSON.stringify({ given: t.given, sent: t.sentIds, kept: t.kept });
  ok("control: two calls opened, one after the other, and each named its caller",
    t.sentIds.length === 2 && t.sentIds.every(Boolean), seen);
  ok("each session opens with the id the page gave its widget, a random one",
    t.sentIds.length === 2 && t.sentIds.every((id, i) => id === t.given[i] && UUID.test(id ?? "")), seen);
  ok("the second call carries a different id from the first", t.sentIds.length === 2 && t.sentIds[0] !== t.sentIds[1], seen);
  ok("control: this browser's storage works, so an id could have been kept", t.storage === "1", String(t.storage));
  ok("and the widget keeps no caller id on the device", t.kept === null, String(t.kept));
});

jsdelivr.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
