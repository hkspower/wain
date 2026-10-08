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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
requireFreshBuild(ROOT);

let passed = 0, failed = 0;
const ok = (name, cond, detail = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
  if (cond) passed++;
  else failed++;
};

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

async function run({ withPolicy, init = null, outputFormat = "pcm_16000", viewport = { width: 390, height: 844 } }) {
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
  await ctx.route(/api(\.us)?\.elevenlabs\.io/, (r) => {
    if (/\/widget/.test(r.request().url()))
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(WIDGET_CONFIG) });
    return r.abort("failed");
  });
  const askedBefore = resamplerAsked;
  const sent = [];
  await ctx.routeWebSocket(/elevenlabs\.io/, (ws) => {
    ws.onMessage((m) => {
      let type = "binary";
      // Audio is {"user_audio_chunk": "<base64>"} — no `type` field — so the
      // first key names it; everything else carries a `type`.
      try {
        const j = JSON.parse(typeof m === "string" ? m : m.toString());
        type = j.type ?? Object.keys(j)[0] ?? "?";
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
  return { header, chunks: sent.filter((t) => t === "user_audio_chunk").length, sent, violations, hangup, resampler: resamplerAsked - askedBefore, called, terms };
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

jsdelivr.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
