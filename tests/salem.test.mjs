import { chromium } from 'playwright';

/**
 * شوق's typed chat at /salem: structure and client-side behaviour only.
 *
 * This suite went through two wrong versions before this one. First it
 * asserted the header named سالم and opened on a hand-written «أنا سالم»
 * greeting — the mistake `/salem` shipped with, caught by pulling the live
 * agent's real `first_message` («أنا شوق», feminine grammar throughout,
 * because the agent never changed). Corrected to assert her name plus a
 * «🔊 بصوت سالم» voice badge — still wrong, because the fix that actually
 * landed went further, asked directly to keep her voice unchanged: no
 * badge, no override, just her. Third version, asserting that. What IS
 * asserted regardless of network: her name renders immediately, there is no
 * hand-written greeting (the first line in the transcript is whatever she
 * actually sends, which this sandbox cannot see — api.elevenlabs.io is
 * refused by its own egress gateway), the input starts disabled (status
 * begins at "connecting", never "connected", before any network event
 * fires), and the page never throws.
 *
 * `show_places`/`open_place` are covered too, by stubbing `window.WebSocket`
 * itself rather than waiting for a real agent — see that section's own
 * comment for why a fake transport proves wain's own side of the wire just
 * as well as a real one would. Each result's own `ShareHangout` panel is
 * asserted alongside it — «integrate hangout», the reason it is there at all.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

async function fresh(path) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW',
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${B}${path}`, { waitUntil: 'networkidle' });
  return { ctx, p, errors };
}

console.log('\n── /salem names شوق, not سالم ──');
{
  const { ctx, p, errors } = await fresh('/salem/');
  ok('the header names شوق', await p.locator('header', { hasText: 'شوق' }).isVisible());
  ok('no voice badge — her own voice is not called out as different', !(await p.locator('header', { hasText: 'سالم' }).count()));
  ok('no hand-written greeting claims to be him', !(await p.locator('text=أنا سالم').count()));
  ok('no page errors', errors.length === 0);
  await ctx.close();
}

console.log('\n── the input starts disabled, since status never begins "connected" ──');
{
  const { ctx, p } = await fresh('/salem/');
  const input = p.locator('#salem-q');
  const send = p.getByRole('button', { name: 'إرسال' });
  ok('the box is present', await input.isVisible());
  ok('it is disabled before any network event can have arrived', await input.isDisabled());
  ok('so is the send button', await send.isDisabled());
  await ctx.close();
}

console.log('\n── /find\'s typing half names شوق too ──');
{
  const { ctx, p } = await fresh('/find/');
  const link = p.getByRole('link', { name: /ابدأ الكتابة/ });
  ok('the CTA leads to /salem', await link.isVisible());
  ok('the section is not attributed to سالم by name', !(await p.locator('text=اكتب لسالم').count()));
  await ctx.close();
}

console.log('\n── show_places/open_place render inline, without a live agent ──');
{
  // api.elevenlabs.io is refused by this sandbox's own egress gateway, the
  // same limitation every ElevenLabs feature in this repository carries — so
  // this stubs `window.WebSocket` itself, before any page script runs, the
  // same move shouq-agent.test.mjs makes for the widget's <script> tag one
  // layer up. Nothing here claims a real socket was exercised; what is under
  // test is wain's own side of the wire — the dispatch in salem-chat.ts and
  // the inline rendering in SalemChat.tsx — which a fake transport proves
  // exactly as well as a real one would.
  const sctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW',
  });
  await sctx.addInitScript(() => {
    class FakeSocket {
      constructor(url, protocols) {
        this.url = url;
        this.protocols = protocols;
        this.readyState = 0;
        this.sent = [];
        this.listeners = {};
        window.__salemSocket = this;
      }
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
      send(data) { this.sent.push(data); }
      close() { this.readyState = 3; }
      emit(type, evt) { for (const fn of this.listeners[type] ?? []) fn(evt); }
    }
    FakeSocket.CONNECTING = 0; FakeSocket.OPEN = 1; FakeSocket.CLOSING = 2; FakeSocket.CLOSED = 3;
    window.WebSocket = FakeSocket;
  });
  const sp = await sctx.newPage();
  const sErrors = [];
  sp.on('pageerror', (e) => sErrors.push(e.message));
  await sp.goto(`${B}/salem/`, { waitUntil: 'networkidle' });
  await sp.waitForFunction(() => !!window.__salemSocket, null, { timeout: 6000 });

  await sp.evaluate(() => {
    const s = window.__salemSocket;
    s.readyState = 1;
    s.emit('open', {});
  });
  ok('the handshake is sent on open', await sp.evaluate(() => window.__salemSocket.sent.length === 1));

  await sp.evaluate(() => {
    window.__salemSocket.emit('message', { data: JSON.stringify({ type: 'conversation_initiation_metadata' }) });
  });
  const input = sp.locator('#salem-q');
  await sp.waitForFunction(() => !document.getElementById('salem-q')?.disabled, null, { timeout: 6000 });
  ok('the box enables once the fake handshake settles', await input.isEnabled());

  await sp.evaluate(() => {
    window.__salemSocket.emit('message', {
      data: JSON.stringify({
        type: 'client_tool_call',
        client_tool_call: { tool_call_id: 'c1', tool_name: 'show_places', parameters: { query: 'أبراج' } },
      }),
    });
  });
  await sp.waitForSelector('a[href="/places/kuwait-towers/"]', { timeout: 8000 });
  ok('show_places renders a card linking to the real place', true);
  ok('and answers the agent back over the socket', await sp.evaluate(() => {
    const last = JSON.parse(window.__salemSocket.sent.at(-1));
    return last.tool_call_id === 'c1' && last.is_error === false && last.result.includes('أبراج');
  }));
  // ShareHangout, «integrate hangout»: a شوق CALL already reaches this panel
  // for free (show_places navigates to /search, which mounts SearchPlan's
  // own copy) — a typed chat never leaves this page, so nothing reused it
  // until it was wired in here directly. See SalemChat.tsx's own comment.
  await sp.waitForSelector('h2:has-text("رسّلها للربع")', { timeout: 6000 });
  ok('show_places result carries a send-to-the-group panel', true);

  await sp.evaluate(() => {
    window.__salemSocket.emit('message', {
      data: JSON.stringify({
        type: 'client_tool_call',
        client_tool_call: { tool_call_id: 'c2', tool_name: 'open_place', parameters: { slug: 'kuwait-towers' } },
      }),
    });
  });
  await sp.waitForFunction(
    () => document.querySelector('a[href="/places/kuwait-towers/"]')?.textContent.includes('أبراج الكويت'),
    null, { timeout: 8000 }
  );
  ok('open_place renders the fuller card with the place\'s own name', true);
  // Two turns, two panels — each show_places/open_place result carries its
  // own, not one shared across the whole transcript.
  ok('open_place result carries its own panel too', (await sp.locator('h2:has-text("رسّلها للربع")').count()) === 2);

  ok('no page errors from any of it', sErrors.length === 0, sErrors.join('; '));
  await sctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : '\nكل شي تمام');
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
