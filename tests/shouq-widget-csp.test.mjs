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
import { existsSync, readFileSync, statSync } from "node:fs";
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

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };

async function run({ withPolicy }) {
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
      let type = "binary";
      // Audio is {"user_audio_chunk": "<base64>"} — no `type` field — so the
      // first key names it; everything else carries a `type`.
      try {
        const j = JSON.parse(typeof m === "string" ? m : m.toString());
        type = j.type ?? Object.keys(j)[0] ?? "?";
      } catch { /* binary */ }
      sent.push(type);
      if (type === "conversation_initiation_client_data")
        ws.send(JSON.stringify({ type: "conversation_initiation_metadata", conversation_initiation_metadata_event: { conversation_id: "c_test", agent_output_audio_format: "pcm_16000", user_input_audio_format: "pcm_16000" } }));
    });
  });
  await ctx.addInitScript(() => {
    window.__violations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__violations.push(`${e.violatedDirective} ${e.blockedURI.slice(0, 100)}`));
  });
  const page = await ctx.newPage();
  const hangup = { ready: "not reached", live: "not reached" };
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
    const accept = widget.getByRole("button", { name: /قبول/ }).first();
    if (await accept.count()) await accept.click({ timeout: 5000 });
    await page.waitForTimeout(5000);
    hangup.live = await hangupFree(page);
  } catch (e) {
    console.log(`  · the call did not get as far as the widget: ${String(e.message).split("\n")[0]}`);
  }
  const header = await page.locator("#wain-ai-panel header").textContent();
  const violations = await page.evaluate(() => window.__violations);
  await browser.close();
  server.close();
  return { header, chunks: sent.filter((t) => t === "user_audio_chunk").length, sent, violations, hangup };
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
ok("audio leaves the page — a granted microphone is HEARD", shipped.chunks > 20, `${shipped.chunks} chunks; script-src needs blob: for the widget's AudioWorklet`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
