import { chromium } from 'playwright';

/**
 * سالم's typed chat at /salem: structure and client-side behaviour only.
 *
 * This suite has now asserted three different versions of what this page
 * claims, and all three were real states this page was actually in — read
 * before changing this a fourth time. First it asserted the header named
 * سالم and opened on a hand-written «أنا سالم» greeting — the mistake
 * `/salem` shipped with, caught by pulling the live agent's real
 * `first_message` («أنا شوق», feminine grammar throughout, because the
 * agent never changed). Corrected to assert her name with no voice badge
 * at all, her own voice unchanged. Reversed again on request, 30 September,
 * back to his name and his voice — `SALEM_VOICE_ID`'s own comment in
 * `lib/wain-ai.ts` has the full account of why, including the one thing
 * that is still true regardless of this reversal: the agent's own
 * `first_message` still says «أنا شوق», so what is asserted below is
 * exactly what changed (the header, the identity) and exactly what did NOT
 * (still no hand-written greeting standing in for what the wire actually
 * sends — that would repeat the very first mistake, not fix anything). The
 * input starts disabled (status begins at "connecting", never "connected",
 * before any network event fires), and the page never throws.
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

console.log('\n── /salem names سالم again ──');
{
  const { ctx, p, errors } = await fresh('/salem/');
  ok('the header names سالم', await p.locator('header', { hasText: 'سالم' }).isVisible());
  ok('still no hand-written greeting — the wire\'s own first line is what shows, not a scripted one', !(await p.locator('text=أنا سالم').count()));
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

console.log('\n── /find\'s typing half is سالم\'s again ──');
{
  const { ctx, p } = await fresh('/find/');
  const link = p.getByRole('link', { name: /ابدأ الكتابة/ });
  ok('the CTA leads to /salem', await link.isVisible());
  // The pill states his ROLE (SALEM_ROLE has no literal "سالم" in it, same
  // as the call half's pill never spells out "شوق" either); his NAME comes
  // from the greeting sentence beneath it — checking the section as a whole
  // is what actually proves a reader can call this half his.
  ok('the section names سالم — the greeting under the pill', await p.locator('section[aria-label="اكتب"]', { hasText: 'سالم' }).isVisible());
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

  console.log('\n── typing, replies, corrections and a dropped line ──');
  ok('the transcript is a live log, so a screen reader hears her replies',
    await sp.locator('[role="log"][aria-live="polite"]').count() === 1);

  await input.fill('وين أروح؟');
  await sp.getByRole('button', { name: 'إرسال' }).click();
  ok('the visitor\'s own bubble is drawn once the message left', await sp.locator('p', { hasText: 'وين أروح؟' }).count() === 1);
  ok('and a typing indicator shows while she answers', await sp.locator('[role="log"] .sr-only', { hasText: 'يكتب' }).count() === 1);
  await input.fill('ثاني');
  ok('the send button is held back until her reply, so two questions do not cross',
    await sp.getByRole('button', { name: 'إرسال' }).isDisabled());

  await sp.evaluate(() => window.__salemSocket.emit('message', {
    data: JSON.stringify({ type: 'agent_response', agent_response_event: { agent_response: 'أحلى وقت العصر' } }),
  }));
  await sp.waitForSelector('p:has-text("أحلى وقت العصر")', { timeout: 4000 });
  ok('her reply replaces the indicator', await sp.locator('[role="log"] .sr-only', { hasText: 'يكتب' }).count() === 0);
  ok('and frees the button', await sp.getByRole('button', { name: 'إرسال' }).isEnabled());

  await sp.evaluate(() => window.__salemSocket.emit('message', {
    data: JSON.stringify({ type: 'agent_response_correction', agent_response_correction_event: {
      original_agent_response: 'أحلى وقت العصر', corrected_agent_response: 'أحلى وقت عقب المغرب', event_id: 2 } }),
  }));
  await sp.waitForSelector('p:has-text("عقب المغرب")', { timeout: 4000 });
  ok('a correction replaces her bubble instead of adding a second', await sp.locator('p:has-text("أحلى وقت")').count() === 1);
  ok('and the old wording is gone', await sp.locator('p:has-text("أحلى وقت العصر")').count() === 0);

  // A socket that is no longer open must not produce a message that never left.
  await sp.evaluate(() => { window.__salemSocket.readyState = 3; });
  await input.fill('ما راح توصل');
  await sp.getByRole('button', { name: 'إرسال' }).click();
  ok('a message that could not be sent says so', await sp.locator('text=ما انرسلت رسالتك').count() === 1);
  ok('and no bubble is drawn for it', await sp.locator('p', { hasText: 'ما راح توصل' }).count() === 0);

  await sp.evaluate(() => { window.__salemSocket.readyState = 1; });
  await sp.evaluate(() => { window.__firstSocket = window.__salemSocket; });
  await sp.evaluate(() => { window.__salemSocket.readyState = 3; window.__salemSocket.emit('close', { code: 1006 }); });
  // `p[role="alert"]`: Next's own route announcer is a role="alert" too.
  await sp.waitForSelector('p[role="alert"]', { timeout: 4000 });
  const alertText = await sp.locator('p[role="alert"]').textContent();
  ok('a line that dies mid-chat says it dropped, not that it never connected', alertText.includes('انقطع الاتصال'), alertText);
  ok('and the header just says it is offline, not the same sentence twice',
    (await sp.locator('header').textContent()).includes('مو متصل') && !(await sp.locator('header').textContent()).includes('انقطع'));
  await sp.getByRole('button', { name: 'ابدأ من جديد' }).click();
  await sp.waitForFunction(() => window.__salemSocket !== window.__firstSocket, null, { timeout: 4000 });
  ok('starting again opens a new socket', true);
  ok('and marks the break, so a fresh greeting is not the old chat\'s next line',
    await sp.locator('[role="log"] >> text=محادثة جديدة').count() === 1);

  ok('no page errors from any of it', sErrors.length === 0, sErrors.join('; '));
  await sctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : '\nكل شي تمام');
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
