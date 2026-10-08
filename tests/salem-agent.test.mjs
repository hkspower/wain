import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/**
 * سالم's typed chat at /salem IN THE SANDBOX BUILD (agent mode — staging only
 * since 2 October; tests/salem.test.mjs covers the free build the live site
 * ships). Run by tests/run-shouq.mjs against its agent-mode export.
 *
 * Structure and client-side behaviour only.
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
const B = process.env.WAIN_URL || 'http://localhost:4190';
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

console.log('\n── the box says the conversation is kept, before anything is typed ──');
{
  // The agent records and keeps conversations with no expiry (read off its
  // settings on 1 October; WAIN_AI_RECORDING). A visitor has to be able to
  // read that BEFORE the first message, since the first message is kept too.
  const { ctx, p } = await fresh('/salem/');
  const notice = p.locator('p', { hasText: 'تنحفظ عند مزوّد خدمة الصوت' });
  ok('the notice is on screen with the box', await notice.isVisible());
  // The brand is off every visible surface but one sentence on /privacy, on
  // request (2 October).
  ok('and nothing on the page names the provider', !(await p.locator('body').innerText()).includes('ElevenLabs'));
  const box = await p.locator('#salem-q').boundingBox();
  const line = await notice.boundingBox({ timeout: 2000 }).catch(() => null);
  ok('it sits above the box, where it is read before typing', !!(box && line && line.y + line.height <= box.y + 1));
  // Soft: a missing notice must fail its own line, not throw and cancel
  // every section after it.
  const href = await notice.locator('a').getAttribute('href', { timeout: 2000 }).catch(() => null);
  ok('its link goes to the privacy section that says the rest', href === '/privacy/#wain-ai', `href=${href}`);
  await ctx.close();

  const priv = await fresh('/privacy/');
  const section = priv.p.locator('section#wain-ai');
  ok('/privacy has the section the link points at', await section.isVisible());
  ok('and it says there is no expiry, in so many words', await section.locator('text=ما لها مدة تنمسح بعدها').isVisible());
  ok('and it no longer says the only thing kept is our own log', !(await priv.p.locator('text=الشي الوحيد اللي نسجّله').count()));
  const named = ((await priv.p.locator('main').innerText()).match(/ElevenLabs/g) ?? []).length;
  ok('/privacy names the provider exactly once', named === 1, `named ${named} times`);
  // The fallback when the account is out of credits keeps two things on the
  // device, and the box's own notice points here while it runs (7 October).
  const said = await section.innerText().catch(() => '');
  ok('and it says what the fallback keeps: this tab\'s chat, and one time for a quarter hour',
    said.includes('Session') && said.includes('Local Storage') && said.includes('ربع ساعة'), said.slice(0, 120));
  await priv.ctx.close();
}

console.log('\n── /find\'s typing half is سالم\'s again ──');
{
  const { ctx, p } = await fresh('/find/');
  const link = p.getByRole('link', { name: /ابدأ الكتابة/ });
  ok('the CTA leads to /salem', await link.isVisible());
  // His name is in the heading («اكتب لسالم», 7 October) and in the greeting
  // under it; checking the section as a whole is what proves a reader can
  // call this half his.
  ok('the section names سالم — the heading and the greeting', await p.locator('section[aria-label="اكتب"]', { hasText: 'سالم' }).isVisible());
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

  console.log('\n── she speaks first: waiting, starters, and the phone-call filler ──');
  // Until her first line lands the transcript is empty, which read as a page
  // that had not loaded. The dots say she is on her way.
  ok('before her greeting, the typing dots show — the chat is not just blank',
    await sp.locator('[role="log"] .sr-only', { hasText: 'يكتب' }).count() === 1);
  // How they move, not only that they are there. They were Tailwind's stock
  // pulse — one fade on one period — and read as three dots dimming together.
  const dots = await sp.locator('[data-typing] [aria-hidden] > span').evaluateAll((els) =>
    els.map((e) => ({ name: getComputedStyle(e).animationName, delay: getComputedStyle(e).animationDelay })));
  ok('the dots rise in a wave: three, one keyframe, three different starts',
    dots.length === 3 && dots.every((d) => d.name === 'typing-dot') && new Set(dots.map((d) => d.delay)).size === 3,
    JSON.stringify(dots));
  await sp.emulateMedia({ reducedMotion: 'reduce' });
  ok('and keep still for a visitor who asked for less motion',
    await sp.locator('[data-typing] [aria-hidden] > span').first().evaluate((e) =>
      parseFloat(getComputedStyle(e).animationDuration) < 0.001));
  await sp.emulateMedia({ reducedMotion: 'no-preference' });
  ok('and no starters yet — nothing has been said to answer',
    await sp.getByRole('button', { name: 'قهوة هادية' }).count() === 0);
  await sp.evaluate(() => window.__salemSocket.emit('message', {
    data: JSON.stringify({ type: 'agent_response', agent_response_event: { agent_response: 'هلا والله!' } }),
  }));
  // Soft: a throw here would cancel every section after it, the coverage-hole
  // shape this repo has met three times already.
  const starters = await sp.getByRole('button', { name: 'قهوة هادية' }).waitFor({ timeout: 4000 }).then(() => true, () => false);
  ok('once she has greeted, the starters appear', starters);
  if (!starters) await sp.evaluate(() => { window.__salemStartersMissing = true; });
  ok('and the dots are gone', await sp.locator('[role="log"] .sr-only', { hasText: 'يكتب' }).count() === 0);
  ok('her reply slides in where they were, in her bubble with its tail',
    await sp.locator('[role="log"] p', { hasText: 'هلا والله' }).evaluate((e) => {
      const c = getComputedStyle(e);
      return c.animationName === 'bubble-in' && c.backgroundColor === 'rgb(255, 255, 255)';
    }).catch(() => false));
  if (starters) await sp.getByRole('button', { name: 'قهوة هادية' }).click();
  else await sp.locator('#salem-q').fill('قهوة هادية').then(() => sp.getByRole('button', { name: 'إرسال' }).click());
  ok('a starter sends its words as the visitor\'s own message', await sp.evaluate(() => {
    const m = JSON.parse(window.__salemSocket.sent.at(-1));
    return m.type === 'user_message' && m.text === 'قهوة هادية';
  }));
  ok('and is drawn as their bubble', await sp.locator('p', { hasText: 'قهوة هادية' }).count() === 1);
  ok('the starters leave once the conversation has begun', await sp.getByRole('button', { name: 'طلعة مع العيال' }).count() === 0);
  await sp.evaluate(() => window.__salemSocket.emit('message', {
    data: JSON.stringify({ type: 'agent_response', agent_response_event: { agent_response: 'ثانية وحدة…' } }),
  }));
  ok('a filler meant for a phone line draws no bubble',
    await sp.locator('p', { hasText: 'ثانية وحدة' }).count() === 0);
  ok('and the dots stay — she is still working',
    await sp.locator('[role="log"] .sr-only', { hasText: 'يكتب' }).count() === 1);
  await sp.evaluate(() => window.__salemSocket.emit('message', {
    data: JSON.stringify({ type: 'agent_response', agent_response_event: { agent_response: 'أبشر، مقاهي المباركية.' } }),
  }));
  await sp.waitForSelector('p:has-text("مقاهي المباركية")', { timeout: 4000 });
  ok('then the real answer replaces them', await sp.locator('[role="log"] .sr-only', { hasText: 'يكتب' }).count() === 0);

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
  // The tool and her answer after it are still her turn: the dots stay and
  // the box waits, until the answer arrives. They used to end with the
  // sentence she said before the tool, and a second question typed there
  // crossed the first answer.
  ok('the dots stay through the tool turn', await sp.locator('[role="log"] .sr-only', { hasText: 'يكتب' }).count() === 1);
  const sayAfterTool = (text) => sp.evaluate((t) => window.__salemSocket.emit('message', {
    data: JSON.stringify({ type: 'agent_response', agent_response_event: { agent_response: t } }),
  }), text);
  await sayAfterTool('هذي أبراج الكويت قدامك.');
  await sp.waitForSelector('p:has-text("هذي أبراج الكويت قدامك")', { timeout: 4000 });
  ok('and go when her answer after it arrives', await sp.locator('[role="log"] .sr-only', { hasText: 'يكتب' }).count() === 0);

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
  // Waited for, not read: the card can paint a render before its panel, and
  // reading the count at that instant failed one run in four.
  const panels = await sp.waitForFunction(
    () => [...document.querySelectorAll('h2')].filter((h) => h.textContent.includes('رسّلها للربع')).length === 2,
    null, { timeout: 4000 }
  ).then(() => 2, async () => sp.locator('h2:has-text("رسّلها للربع")').count());
  ok('open_place result carries its own panel too', panels === 2, `${panels} panels`);
  await sayAfterTool('فتحت لك بطاقتها.');
  await sp.waitForSelector('p:has-text("فتحت لك بطاقتها")', { timeout: 4000 });

  console.log('\n── typing, replies, corrections and a dropped line ──');
  ok('the transcript is a live log, so a screen reader hears her replies',
    await sp.locator('[role="log"][aria-live="polite"]').count() === 1);

  await input.fill('وين أروح؟');
  await sp.getByRole('button', { name: 'إرسال' }).click();
  ok('the visitor\'s own bubble is drawn once the message left', await sp.locator('p', { hasText: 'وين أروح؟' }).count() === 1);
  ok('and a typing indicator shows while she answers', await sp.locator('[role="log"] .sr-only', { hasText: 'يكتب' }).count() === 1);
  // A slow answer must not look like a dead one: after 10s the dots say so.
  await sp.waitForSelector('text=ثواني وترد عليك', { timeout: 14000 });
  ok('a reply taking long says so under the dots', true);
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

console.log('\n── a long chat scrolls inside itself; the box and her newest reply stay on screen ──');
// «didn't respond», reported 1 October. The page was `min-h-dvh`, so the
// transcript's `flex-1 overflow-y-auto` had no height to overflow: the page
// grew instead, the input and her newest reply slid below the fold, and the
// scroll-to-newest code scrolled a box that could not scroll. A reply that
// arrives where nobody is looking is a reply that did not come.
for (const [width, height, standalone] of [[390, 844, false], [320, 568, false], [390, 844, true]]) {
  const lctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, locale: 'ar-KW' });
  await lctx.addInitScript(() => {
    class FakeSocket {
      constructor() { this.readyState = 0; this.sent = []; this.listeners = {}; window.__salemSocket = this; }
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
      send(data) { this.sent.push(data); }
      close() { this.readyState = 3; }
      emit(type, evt) { for (const fn of this.listeners[type] ?? []) fn(evt); }
    }
    FakeSocket.CONNECTING = 0; FakeSocket.OPEN = 1; FakeSocket.CLOSING = 2; FakeSocket.CLOSED = 3;
    window.WebSocket = FakeSocket;
  });
  const lp = await lctx.newPage();
  await lp.goto(`${B}/salem/`, { waitUntil: 'networkidle' });
  if (standalone) await lp.evaluate(() => { document.documentElement.dataset.standalone = 'true'; });
  // Soft: a throw here would cancel the sizes after it.
  if (!(await lp.waitForFunction(() => !!window.__salemSocket, null, { timeout: 6000 }).then(() => true, () => false))) {
    ok(`${width}×${height}: the chat opened a socket`, false);
    await lctx.close();
    continue;
  }
  await lp.evaluate(() => {
    const s = window.__salemSocket;
    s.readyState = 1; s.emit('open', {});
    s.emit('message', { data: JSON.stringify({ type: 'conversation_initiation_metadata' }) });
    for (let i = 1; i <= 14; i++) {
      s.emit('message', { data: JSON.stringify({ type: 'agent_response', agent_response_event: {
        agent_response: `رد رقم ${i}: مقاهي المباركية في مدينة الكويت، چاي وقهوة عربية في حوش السوق، وأحلى وقت لها عقب المغرب. تبي شي ثاني؟` } }) });
    }
  });
  await lp.locator('[role="log"] >> text=رد رقم 14').waitFor({ timeout: 4000 }).catch(() => {});
  await lp.waitForTimeout(900);
  const m = await lp.evaluate(() => {
    const log = document.querySelector('[role="log"]');
    const input = document.getElementById('salem-q').getBoundingClientRect();
    const last = [...log.querySelectorAll('p')].filter((e) => e.textContent.includes('رد رقم 14')).pop()?.getBoundingClientRect();
    const bar = document.querySelector('nav.app-chrome');
    const floor = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : innerHeight;
    return {
      floor: Math.round(floor), inputBottom: Math.round(input.bottom),
      lastTop: last ? Math.round(last.top) : null, lastBottom: last ? Math.round(last.bottom) : null,
      logScrolls: log.scrollHeight > log.clientHeight + 1,
      pageScroll: document.scrollingElement.scrollHeight - innerHeight,
    };
  });
  const tag = `${width}×${height}${standalone ? ', installed' : ''}`;
  ok(`${tag}: the transcript scrolls inside itself`, m.logScrolls, JSON.stringify(m));
  ok(`${tag}: the page itself does not grow past the screen`, m.pageScroll <= 1, JSON.stringify(m));
  ok(`${tag}: the box is on screen, above the tab bar when there is one`, m.inputBottom <= m.floor, JSON.stringify(m));
  ok(`${tag}: her newest reply is in view`, m.lastBottom !== null && m.lastBottom <= m.floor && m.lastTop >= 0, JSON.stringify(m));
  await lctx.close();
}

console.log('\n── out of credits: he answers from وين\'s own search instead ──');
{
  // 2 October: every conversation ended at 0 s, «[quota_exceeded] You've run
  // out of credits», and this page answered «جرّب مرة ثانية» with a button that
  // could only meet the same refusal. That became an honest «مو متاح» — and on
  // 7 October the account ran dry again on the LIVE site, where «مو متاح» is a
  // dead end with a working search engine sitting in the same bundle. So a
  // refusal for credits now hands the chat to the free path, and the device
  // remembers it for a quarter of an hour (lib/agent-health.ts). The reason
  // arrives as the close reason.
  const qctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW',
  });
  await qctx.addInitScript(() => {
    window.__sockets = 0;
    class FakeSocket {
      constructor() { this.readyState = 0; this.sent = []; this.listeners = {}; window.__salemSocket = this; window.__sockets++; }
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
      send(data) { this.sent.push(data); }
      close() { this.readyState = 3; }
      // A listener that throws surfaces as a page error, as it would from a
      // real socket, instead of rejecting the test's evaluate.
      emit(type, evt) {
        for (const fn of this.listeners[type] ?? []) {
          try { fn(evt); } catch (e) { setTimeout(() => { throw e; }); }
        }
      }
    }
    FakeSocket.CONNECTING = 0; FakeSocket.OPEN = 1; FakeSocket.CLOSING = 2; FakeSocket.CLOSED = 3;
    window.WebSocket = FakeSocket;
  });
  const qp = await qctx.newPage();
  const qerr = [];
  qp.on('pageerror', (e) => qerr.push(e.message));
  await qp.goto(`${B}/salem/`, { waitUntil: 'networkidle' });
  await qp.waitForFunction(() => !!window.__salemSocket, null, { timeout: 6000 }).catch(() => {});
  await qp.evaluate(() => {
    const s = window.__salemSocket;
    if (!s) return;
    s.readyState = 1;
    s.emit('open', {});
    s.readyState = 3;
    s.emit('close', { code: 1008, reason: "[quota_exceeded] You've run out of credits. Add credits or upgrade your plan to start a new conversation." });
  }).catch(() => {});
  const log = qp.locator('[role="log"]');
  await log.getByText('دليل وين').first().waitFor({ timeout: 4000 }).catch(() => {});
  ok('the transcript says the voice service is out and he answers from the guide',
    await log.getByText('دليل وين').count() > 0);
  ok('no dead-end banner', await qp.locator('p[role="alert"]').count() === 0);
  await qp.waitForFunction(() => !document.getElementById('salem-q')?.disabled, null, { timeout: 4000 }).catch(() => {});
  ok('the box is open', await qp.locator('#salem-q').isEnabled().catch(() => false));
  ok('and the notice under it says nothing leaves the device now',
    await qp.locator('form').locator('xpath=preceding-sibling::p[1]').textContent().then((t) => (t ?? '').includes('يبقى بجهازك')).catch(() => false));
  const sentBefore = await qp.evaluate(() => window.__salemSocket?.sent.length ?? 0);
  await qp.locator('#salem-q').fill('قهوة').catch(() => {});
  await qp.locator('#salem-q').press('Enter').catch(() => {});
  await log.locator('a[href^="/places/"]').first().waitFor({ timeout: 8000 }).catch(() => {});
  ok('a question gets places from our own search', await log.locator('a[href^="/places/"]').count() > 0);
  // What the visitor would see if the question went to the socket instead —
  // the count of sent frames alone could not fail (review of 7 October).
  ok('answered here, not sent down the dead socket',
    await log.getByText('ما انرسلت رسالتك').count() === 0 &&
    await qp.evaluate((n) => (window.__salemSocket?.sent.length ?? 0) === n, sentBefore));
  ok('the device remembers the refusal', await qp.evaluate(() => Number(localStorage.getItem('wain:agent-off')) > 0));

  // The next page in this quarter hour does not knock on the same door.
  const again = await qctx.newPage();
  again.on('pageerror', (e) => qerr.push(e.message));
  await again.goto(`${B}/salem/`, { waitUntil: 'networkidle' });
  await again.waitForFunction(() => !document.getElementById('salem-q')?.disabled, null, { timeout: 4000 }).catch(() => {});
  ok('a fresh visit opens no socket', await again.evaluate(() => window.__sockets === 0));
  ok('and is ready to answer at once', await again.locator('#salem-q').isEnabled().catch(() => false));
  ok('with his own greeting', await again.locator('[role="log"]').getByText('أنا سالم').count() > 0);
  await again.close();

  // And after it, the agent is tried again.
  const later = await qctx.newPage();
  later.on('pageerror', (e) => qerr.push(e.message));
  await later.addInitScript(() => localStorage.setItem('wain:agent-off', String(Date.now() - 16 * 60_000)));
  await later.goto(`${B}/salem/`, { waitUntil: 'networkidle' });
  await later.waitForFunction(() => window.__sockets > 0, null, { timeout: 4000 }).catch(() => {});
  ok('a quarter of an hour later the agent is tried again', await later.evaluate(() => window.__sockets > 0));
  ok('no page errors through the refusal', qerr.length === 0, qerr.join(' | '));
  await qctx.close();

  /* Review of 7 October, both reproduced on this component: a refusal that
     comes AFTER her greeting left the question just sent unanswered under a
     line promising an answer, and a refusal on a return visit wrote over the
     conversation kept in this tab. */
  const QUOTA = "[quota_exceeded] You've run out of credits. Add credits or upgrade your plan to start a new conversation.";
  async function socketPage(path, init) {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW' });
    if (init) await c.addInitScript(init);
    await c.addInitScript(() => {
      class FakeSocket {
        constructor() { this.readyState = 0; this.sent = []; this.listeners = {}; window.__salemSocket = this; }
        addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
        send(data) { this.sent.push(data); }
        close() { this.readyState = 3; }
        emit(type, evt) {
          for (const fn of this.listeners[type] ?? []) {
            try { fn(evt); } catch (e) { setTimeout(() => { throw e; }); }
          }
        }
      }
      FakeSocket.CONNECTING = 0; FakeSocket.OPEN = 1; FakeSocket.CLOSING = 2; FakeSocket.CLOSED = 3;
      window.WebSocket = FakeSocket;
    });
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${B}${path}`, { waitUntil: 'networkidle' });
    await p.waitForFunction(() => !!window.__salemSocket, null, { timeout: 6000 }).catch(() => {});
    return { c, p, errs };
  }
  const greet = (p) => p.evaluate(() => {
    const s = window.__salemSocket;
    if (!s) return;
    s.readyState = 1;
    s.emit('open', {});
    s.emit('message', { data: JSON.stringify({ type: 'conversation_initiation_metadata' }) });
    s.emit('message', { data: JSON.stringify({ type: 'agent_response', agent_response_event: { agent_response: 'هلا! شنو تبي اليوم؟' } }) });
  }).catch(() => {});
  const refuse = (p) => p.evaluate((reason) => {
    const s = window.__salemSocket;
    if (!s) return;
    s.readyState = 3;
    s.emit('close', { code: 3000, reason });
  }, QUOTA).catch(() => {});
  const sentText = (p) => p.evaluate(() => (window.__salemSocket?.sent ?? []).map((d) => JSON.parse(d)).filter((m) => m.type === 'user_message').map((m) => m.text)).catch(() => []);

  {
    const { c, p, errs } = await socketPage('/salem/');
    await greet(p);
    await p.waitForFunction(() => !document.getElementById('salem-q')?.disabled, null, { timeout: 4000 }).catch(() => {});
    await p.locator('#salem-q').fill('قهوة').catch(() => {});
    await p.locator('#salem-q').press('Enter').catch(() => {});
    await p.waitForFunction(() => (window.__salemSocket?.sent ?? []).some((d) => d.includes('user_message')), null, { timeout: 4000 }).catch(() => {});
    ok('mid-chat: the question went down the socket first', (await sentText(p)).includes('قهوة'));
    await refuse(p);
    const plog = p.locator('[role="log"]');
    await plog.locator('a[href^="/places/"]').first().waitFor({ timeout: 8000 }).catch(() => {});
    ok('mid-chat: the question asked just before the refusal is answered from the guide', await plog.locator('a[href^="/places/"]').count() > 0);
    const asked = plog.locator('p.bg-sea-600', { hasText: 'قهوة' });
    ok('mid-chat: without drawing the question a second time', await asked.count() === 1, `${await asked.count()} bubbles`);
    ok('mid-chat: and says once that it switched', await plog.getByText('دليل وين').count() === 1);
    ok('mid-chat: no page errors', errs.length === 0, errs.join(' | '));
    await c.close();
  }
  {
    const { c, p, errs } = await socketPage('/salem/?q=قهوة&from=shouq');
    await greet(p);
    await p.waitForFunction(() => (window.__salemSocket?.sent ?? []).some((d) => d.includes('user_message')), null, { timeout: 4000 }).catch(() => {});
    ok('a handover: the question went down the socket after her greeting', (await sentText(p)).includes('قهوة'));
    await refuse(p);
    const plog = p.locator('[role="log"]');
    await plog.locator('a[href^="/places/"]').first().waitFor({ timeout: 8000 }).catch(() => {});
    ok('a handover refused on its first turn is still answered', await plog.locator('a[href^="/places/"]').count() > 0);
    ok('a handover: no page errors', errs.length === 0, errs.join(' | '));
    await c.close();
  }
  {
    // A chat kept in this tab from the fallback, and a flag that has run out:
    // the agent is tried, refuses again, and the chat must come back.
    const { c, p, errs } = await socketPage('/salem/', () => {
      sessionStorage.setItem('wain:salem:v1', JSON.stringify({
        messages: [
          { role: 'system', text: 'الخدمة الصوتية مو متاحة الحين — أجاوبك من دليل وين.' },
          { role: 'user', text: 'أبي أبراج' },
          { role: 'agent', text: 'جرّب أبراج الكويت.' },
          { role: 'place', slug: 'kuwait-towers' },
        ],
        ctx: null,
      }));
      localStorage.setItem('wain:agent-off', String(Date.now() - 16 * 60_000));
    });
    ok('kept chat: the agent is tried once the quarter hour is over', await p.evaluate(() => !!window.__salemSocket));
    await p.evaluate(() => { const s = window.__salemSocket; if (s) { s.readyState = 1; s.emit('open', {}); } }).catch(() => {});
    await refuse(p);
    const plog = p.locator('[role="log"]');
    await plog.getByText('أبي أبراج').first().waitFor({ timeout: 4000 }).catch(() => {});
    ok('kept chat: refused again, the conversation comes back', await plog.getByText('أبي أبراج').count() === 1);
    ok('kept chat: with its card', await plog.locator('a[href^="/places/kuwait-towers"]').count() > 0);
    const kept = await p.evaluate(() => sessionStorage.getItem('wain:salem:v1') ?? '');
    ok('kept chat: and the tab still keeps it', kept.includes('أبي أبراج'), kept.slice(0, 160));
    ok('kept chat: no page errors', errs.length === 0, errs.join(' | '));
    await c.close();
  }
}

console.log('\n── his tools answer from the live rows, not the snapshot they started with ──');
{
  // The socket opens once, at mount, and its tool handlers used to keep that
  // first render's places — the build-time snapshot — after usePlaces swapped
  // in the server's rows. So a place renamed in the admin was named the old
  // way to the agent while the card under it said the new one. The live rows
  // are a rename here, answered by the page's own back end.
  const rows = JSON.parse(readFileSync(new URL('../out/data/places.json', import.meta.url), 'utf8'));
  const renamed = rows.map((r) => (r.slug === 'kuwait-towers' ? { ...r, name_ar: 'أبراج الكويت الجديدة' } : r));
  const lctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW' });
  await lctx.route('**/api/wain.php*', (route) =>
    new URL(route.request().url()).searchParams.get('a') === 'places'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, places: renamed }) })
      : route.fulfill({ status: 404, body: '' }));
  await lctx.addInitScript(() => {
    class FakeSocket {
      constructor() { this.readyState = 0; this.sent = []; this.listeners = {}; window.__salemSocket = this; }
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
      send(data) { this.sent.push(data); }
      close() { this.readyState = 3; }
      emit(type, evt) { for (const fn of this.listeners[type] ?? []) fn(evt); }
    }
    FakeSocket.CONNECTING = 0; FakeSocket.OPEN = 1; FakeSocket.CLOSING = 2; FakeSocket.CLOSED = 3;
    window.WebSocket = FakeSocket;
  });
  const lp = await lctx.newPage();
  await lp.goto(`${B}/salem/`, { waitUntil: 'networkidle' });
  await lp.waitForFunction(() => !!window.__salemSocket, null, { timeout: 6000 }).catch(() => {});
  await lp.evaluate(() => {
    const s = window.__salemSocket;
    s.readyState = 1;
    s.emit('open', {});
    s.emit('message', { data: JSON.stringify({ type: 'conversation_initiation_metadata' }) });
    s.emit('message', { data: JSON.stringify({
      type: 'client_tool_call',
      client_tool_call: { tool_call_id: 'live1', tool_name: 'open_place', parameters: { slug: 'kuwait-towers' } },
    }) });
  }).catch(() => {});
  const reply = await lp.waitForFunction(() => {
    const m = (window.__salemSocket?.sent ?? []).map((d) => JSON.parse(d)).find((x) => x.tool_call_id === 'live1');
    return m ? m.result : null;
  }, null, { timeout: 6000 }).then((h) => h.jsonValue(), () => '');
  ok('open_place tells the agent the name the server has now', String(reply).includes('الجديدة'), String(reply).slice(0, 120));
  await lctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : '\nكل شي تمام');
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
