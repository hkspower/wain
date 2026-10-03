import { chromium } from 'playwright';

/**
 * سالم's typed chat at /salem, as the LIVE site ships it: the free build.
 *
 * Since 2 October the live site carries no ElevenLabs at all (src/lib/wain-ai.ts
 * — the account ran dry and the widget printed its quota error in English over
 * our own call sheet). Before this, a build without the agent showed «المحادثة
 * مو متاحة الحين» on a disabled box under a notice that the chat was being
 * saved: a dead end that also claimed something untrue. Now سالم answers from
 * وين's own search inside the page.
 *
 * What this holds, all of it on the default build that run-hangout serves:
 * nothing is sent anywhere (no WebSocket is even constructed, no request
 * leaves for any voice host), the box works from the first frame, a typed
 * question gets a sentence plus the real place cards and the hangout panel,
 * a miss gets a way on rather than silence, the notice says what is true, and
 * the layout keeps the newest answer and the box on screen.
 *
 * The socket client — the sandbox build, staging only — is
 * tests/salem-agent.test.mjs, run by run-shouq against its agent export.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

async function fresh(path, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, locale: 'ar-KW' });
  // Count every WebSocket the page tries to open, and every request to a
  // voice host — the free build must make neither.
  await ctx.addInitScript(() => {
    window.__sockets = 0;
    const Real = window.WebSocket;
    window.WebSocket = function (...a) { window.__sockets++; return new Real(...a); };
  });
  const p = await ctx.newPage();
  const errors = [];
  const voiceHosts = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('request', (r) => { if (/elevenlabs|\/api\/tts\.php/.test(r.url())) voiceHosts.push(r.url()); });
  await p.goto(`${B}${path}`, { waitUntil: 'networkidle' });
  return { ctx, p, errors, voiceHosts };
}

/** Type a question and wait for سالم's answer to it (soft: never throws). */
async function ask(p, q) {
  const before = await p.locator('[role="log"] p').count();
  try {
    await p.locator('#salem-q').fill(q, { timeout: 3000 });
    await p.locator('#salem-q').press('Enter', { timeout: 3000 });
  } catch {
    return; // a box that cannot be typed into fails the assertions after it, not the run
  }
  await p.waitForFunction((n) => document.querySelectorAll('[role="log"] p').length >= n + 2, before, { timeout: 8000 })
    .catch(() => {});
  await p.waitForTimeout(300);
}

console.log('\n── /salem works with nothing behind it but the page ──');
{
  const { ctx, p, errors, voiceHosts } = await fresh('/salem/');
  ok('the header names سالم', await p.locator('header', { hasText: 'سالم' }).isVisible());
  ok('and says he is ready, not connecting or unavailable',
    await p.locator('header', { hasText: 'جاهز' }).isVisible() && !(await p.locator('text=مو متاحة').count()));
  ok('he greets first, in words this page owns', await p.locator('[role="log"] >> text=أدوّر لك بين أماكن وين').isVisible());
  ok('the box is usable from the first frame', await p.locator('#salem-q').isEnabled());
  ok('the starters are offered', await p.getByRole('button', { name: 'قهوة هادية' }).isVisible());
  ok('no WebSocket is opened', (await p.evaluate(() => window.__sockets)) === 0);
  ok('no page errors', errors.length === 0, errors.join(' | '));

  const notice = await p.locator('form').evaluate((f) => f.previousElementSibling?.textContent ?? '');
  ok('the notice says what is true: nothing leaves the device', notice.includes('يبقى بجهازك'), notice);
  ok('and no longer claims the chat is saved', !notice.includes('تنحفظ'), notice);
  ok('nothing on the page names the voice provider', !(await p.locator('body').innerText()).includes('ElevenLabs'));

  console.log('\n── a question gets an answer, the places, and the group panel ──');
  await ask(p, 'قهوة');
  ok('the visitor\'s line is drawn', await p.locator('[role="log"] p', { hasText: /^قهوة$/ }).count() === 1);
  const reply = (await p.locator('[role="log"] p.bg-white').last().textContent({ timeout: 2000 }).catch(() => '')) ?? '';
  ok('he answers with a sentence that names a place', reply.length > 20 && !reply.includes('ما لقيت'), reply);
  ok('the real place cards follow it', await p.locator('[role="log"] a[href^="/places/"]').count() >= 1);
  ok('with the send-to-the-group panel', await p.locator('[role="log"] h2', { hasText: 'رسّلها للربع' }).count() >= 1);
  ok('the starters leave once the conversation has begun', await p.getByRole('button', { name: 'قهوة هادية' }).count() === 0);

  console.log('\n── a miss is said, with a way on ──');
  const cards = await p.locator('[role="log"] a[href^="/places/"]').count();
  await ask(p, 'زززققق');
  ok('a question nothing matches says so', await p.locator('[role="log"] p', { hasText: 'ما لقيت شي يطابق' }).count() === 1);
  ok('and draws no cards for it', (await p.locator('[role="log"] a[href^="/places/"]').count()) === cards);

  ok('still no socket, and no request to any voice host, after all of it',
    (await p.evaluate(() => window.__sockets)) === 0 && voiceHosts.length === 0, voiceHosts.join(', '));
  await ctx.close();
}

console.log('\n── /privacy says the same thing ──');
{
  const { ctx, p } = await fresh('/privacy/');
  const section = p.locator('section#wain-ai');
  ok('the section says a call is not recorded or kept', await section.locator('text=المكالمة ما تنسجّل ولا تنحفظ').isVisible());
  ok('and that what is typed to سالم stays on the device', await section.locator('text=يبقى في جهازك').isVisible());
  ok('the free build names no voice provider on its privacy page', !(await p.locator('main').innerText()).includes('ElevenLabs'));
  await ctx.close();
}

console.log('\n── /find\'s typing half is سالم\'s ──');
{
  const { ctx, p } = await fresh('/find/');
  ok('the CTA leads to /salem', await p.getByRole('link', { name: /ابدأ الكتابة/ }).isVisible());
  ok('the section names سالم', await p.locator('section[aria-label="اكتب"]', { hasText: 'سالم' }).isVisible());
  await ctx.close();
}

// The page is an exact height so the transcript scrolls inside itself; a
// minimum let it grow and pushed the box and the newest answer off screen
// (1 October). Same check as the sandbox suite, driven by real questions.
console.log('\n── a long chat scrolls inside itself; the box and the newest answer stay on screen ──');
for (const [width, height, standalone] of [[390, 844, false], [320, 568, false], [390, 844, true]]) {
  const { ctx, p } = await fresh('/salem/', { width, height });
  if (standalone) await p.evaluate(() => { document.documentElement.dataset.standalone = 'true'; });
  for (const q of ['قهوة', 'بحر', 'مطعم', 'العيال', 'مول']) await ask(p, q);
  await p.waitForTimeout(900); // a smooth scroll settles
  const m = await p.evaluate(() => {
    const log = document.querySelector('[role="log"]');
    const input = document.getElementById('salem-q').getBoundingClientRect();
    // What he SAID is the answer; the cards under it can run below the fold.
    const said = [...log.querySelectorAll('p.bg-white')].filter((e) => !e.hasAttribute('data-typing')).at(-1)?.getBoundingClientRect();
    const box = log.getBoundingClientRect();
    const bar = document.querySelector('nav.app-chrome');
    const floor = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : innerHeight;
    return {
      floor: Math.round(floor), inputBottom: Math.round(input.bottom),
      saidTop: said ? Math.round(said.top) : null, logTop: Math.round(box.top),
      logScrolls: log.scrollHeight > log.clientHeight + 1,
      pageScroll: document.scrollingElement.scrollHeight - innerHeight,
    };
  });
  const tag = `${width}×${height}${standalone ? ', installed' : ''}`;
  ok(`${tag}: the transcript scrolls inside itself`, m.logScrolls, JSON.stringify(m));
  ok(`${tag}: the page itself does not grow past the screen`, m.pageScroll <= 1, JSON.stringify(m));
  ok(`${tag}: the box is on screen, above the tab bar when there is one`, m.inputBottom <= m.floor, JSON.stringify(m));
  ok(`${tag}: his newest sentence is in view, not above it or below it`,
    m.saidTop !== null && m.saidTop >= m.logTop - 1 && m.saidTop < m.floor - 40, JSON.stringify(m));
  await ctx.close();
}

console.log('\n── a reply that cannot load is said, and the next one tries again ──');
{
  // The search engine is a chunk loaded at runtime. On a weak connection it
  // can fail or crawl; the chat used to remember a failure for the whole visit,
  // and to wait on a slow one with the box locked and the dots up for ever.
  for (const mode of ['fails', 'crawls']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW' });
    // The engine's chunk is the one the page asks for later: not named in the
    // page's HTML, and carrying `buildIndex` (the page's own chunk calls it,
    // so the name alone would catch the page too).
    const html = await (await ctx.request.get(`${B}/salem/`)).text();
    const upfront = new Set([...html.matchAll(/_next\/static\/chunks\/[^"]+\.js/g)].map((m) => m[0]));
    let block = true;
    await ctx.route('**/_next/static/chunks/**', async (route) => {
      const res = await route.fetch();
      const body = await res.text();
      const path = new URL(route.request().url()).pathname.slice(1);
      if (!block || upfront.has(path) || !body.includes('buildIndex')) return route.fulfill({ response: res, body });
      if (mode === 'fails') return route.fulfill({ status: 404, body: 'nope' });
      await new Promise((r) => setTimeout(r, 15_000));
      return route.fulfill({ response: res, body });
    });
    const p = await ctx.newPage();
    await p.goto(`${B}/salem/`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(800);
    await p.locator('#salem-q').fill('قهوة', { timeout: 5000 }).catch(() => {});
    await p.locator('#salem-q').press('Enter', { timeout: 5000 }).catch(() => {});
    const said = await p.waitForFunction(
      () => document.querySelector('[role="log"]')?.textContent.includes('ما وصلني رد'),
      null, { timeout: 12_000 }
    ).then(() => true, () => false);
    ok(`the search ${mode}: سالم says he got nothing, within ten seconds or so`, said);
    if (mode === 'fails') {
      block = false;
      await p.locator('#salem-q').fill('بحر', { timeout: 5000 }).catch(() => {});
      await p.locator('#salem-q').press('Enter', { timeout: 5000 }).catch(() => {});
      const answered = await p.waitForFunction(
        () => document.querySelectorAll('[role="log"] a[href^="/places/"]').length > 0,
        null, { timeout: 8000 }
      ).then(() => true, () => false);
      ok('…and the next question gets a real answer, not the same failure', answered);
    }
    await ctx.close();
  }
}

console.log('\n── before the page is ready, the box waits ──');
{
  const ctx = await browser.newContext();
  const html = await (await ctx.request.get(`${B}/salem/`)).text();
  const input = html.match(/<input[^>]*id="salem-q"[^>]*>/)?.[0] ?? '';
  ok('the box is disabled in the page as sent, until its script has run', /\sdisabled(=""|\s|>)/.test(input), input.slice(0, 160));
  await ctx.close();
}

console.log('\n── the chat fits the screen that is visible, keyboard and all ──');
{
  // An iPhone keyboard shrinks the VISUAL viewport and leaves the layout one
  // alone, so `100dvh` stays full height and the browser pans the page: the
  // header slid off and the page scrolled. Chromium has no keyboard to open,
  // so the visual viewport is played by a stand-in 400px tall.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW' });
  await ctx.addInitScript(() => {
    const vv = new EventTarget();
    Object.assign(vv, { height: 400, width: 390, offsetTop: 0, offsetLeft: 0, scale: 1, pageTop: 0, pageLeft: 0 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
  });
  const p = await ctx.newPage();
  await p.goto(`${B}/salem/`, { waitUntil: 'networkidle' });
  const m = await p.evaluate(() => {
    const input = document.getElementById('salem-q').getBoundingClientRect();
    const header = document.querySelector('header').getBoundingClientRect();
    return { inputBottom: Math.round(input.bottom), headerTop: Math.round(header.top) };
  });
  ok('with a keyboard over half the screen, the box sits above it', m.inputBottom <= 400, JSON.stringify(m));
  ok('…and the header is still at the top', m.headerTop === 0, JSON.stringify(m));
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : '\nكل شي تمام');
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
