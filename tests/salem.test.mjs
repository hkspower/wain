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

/** Type a question and wait for سالم's answer to it (soft: never throws).
 *  The typing dots are a `p` in the log too, so they are not counted, and the
 *  wait lasts until they are gone: counted, the visitor's line and the dots
 *  were already «two more» before any answer had come. */
async function ask(p, q) {
  const LINES = '[role="log"] p:not([data-typing])';
  const before = await p.locator(LINES).count();
  try {
    await p.locator('#salem-q').fill(q, { timeout: 3000 });
    await p.locator('#salem-q').press('Enter', { timeout: 3000 });
  } catch {
    return; // a box that cannot be typed into fails the assertions after it, not the run
  }
  await p.waitForFunction(([sel, n]) =>
    document.querySelectorAll(sel).length >= n + 2 && !document.querySelector('[role="log"] [data-typing]'),
  [LINES, before], { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(300);
}

/** What he said last: his bubbles are the start-side lines of the log. */
const lastSaid = async (p) =>
  (await p.locator('[role="log"] div[data-line].justify-start > p').last().textContent({ timeout: 2000 }).catch(() => '')) ?? '';

console.log('\n── /salem works with nothing behind it but the page ──');
{
  const { ctx, p, errors, voiceHosts } = await fresh('/salem/');
  ok('the header names سالم', await p.locator('header', { hasText: 'سالم' }).isVisible());
  ok('and says he is ready, not connecting or unavailable',
    await p.locator('header', { hasText: 'جاهز' }).isVisible() && !(await p.locator('text=مو متاحة').count()));
  ok('he greets first, in words this page owns', await p.locator('[role="log"] >> text=أدوّر لك بين أماكن وين').isVisible());
  ok('the box is usable from the first frame', await p.locator('#salem-q').isEnabled());
  ok('the starters are offered', await p.getByRole('button', { name: 'قهوة هادية' }).isVisible());
  const starter = await p.getByRole('button', { name: 'قهوة هادية' }).boundingBox();
  ok('a starter is a 40px chip', (starter?.height ?? 0) >= 39.5, String(starter?.height));
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
  ok('his face sits beside his reply', await p.locator('[role="log"] p.bg-white').last().evaluate((b) => b.previousElementSibling?.tagName === 'IMG'));
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

console.log('\n── a finger on a card does not move the map under it (iPhone) ──');
{
  // On an iPhone a finger «enters» a card at touchstart; choosing it popped
  // its pin out of a map bubble, and WebKit's ContentChangeObserver reads new
  // content under a tap as a hover menu and drops the click — the first tap on
  // any card but the first opened nothing (8 October). Chromium has no such
  // observer, so what is held here is the cause: a finger's pointerenter
  // chooses nothing, and a mouse's still does (so the check can see a choice).
  const { ctx, p } = await fresh('/salem/');
  await ask(p, 'قهوة');
  const second = p.locator('[data-salem-places]').last().locator('li[data-slug]').nth(1);
  const ringed = () => second.evaluate((li) => li.className.includes('ring-sun-400'), null, { timeout: 2000 }).catch(() => null);
  // What a tap sends on iOS, and what a mouse sends: a pointerover of its
  // own type, then the mouseover every tap also produces for compatibility.
  const enter = (type) => second.evaluate((li, t) => {
    const card = li.querySelector('a') ?? li;
    card.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: t, isPrimary: true, relatedTarget: null }));
    card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
  }, type, { timeout: 2000 }).catch(() => {});
  ok('the answer has a second card to touch', (await second.count()) === 1);
  ok('…not chosen to begin with', (await ringed()) === false);
  await enter('touch');
  await p.waitForTimeout(300);
  ok('a finger touching it chooses nothing, so the map stays still under the tap', (await ringed()) === false);
  await enter('mouse');
  await p.waitForTimeout(300);
  ok('a mouse pointing at it still chooses it', (await ringed()) === true);
  await ctx.close();
}

console.log('\n── he answers what is said, not only what is searched ──');
{
  /* Read off the live site, 8 October: every message was a search. «السلام
     عليكم» answered «جرّب قصر السلام», «مين أنت؟» a bridge, «شكراً» and «هلا»
     «ما لقيت شي» — and that miss wiped the chat's memory, so «وين بالضبط؟»
     under four cafés was searched as words and answered with the Grand Mosque.
     The reader is unit-tested (salem-followup.test); this is the page wired to
     it: a social line is answered and not searched, the memory survives it,
     and a chip acts on the answer it was offered under. */
  const { ctx, p, errors } = await fresh('/salem/');
  const cards = () => p.locator('[role="log"] a[href^="/places/"]').count();

  await ask(p, 'السلام عليكم');
  let said = await lastSaid(p);
  ok('«السلام عليكم» is greeted back, not searched', said.includes('وعليكم السلام') && !said.includes('جرّب'), said);
  ok('…with no cards drawn for it', (await cards()) === 0);
  ok('…and the starters stay, since nothing has been asked yet',
    await p.getByRole('button', { name: 'قهوة هادية' }).isVisible().catch(() => false));

  await ask(p, 'مين أنت؟');
  said = await lastSaid(p);
  ok('«مين أنت؟» is answered by name', said.includes('أنا سالم'), said);

  await ask(p, 'غيره');
  said = await lastSaid(p);
  ok('«غيره» with nothing before it asks what about, rather than guessing', said.includes('عن شنو'), said);

  await ask(p, 'قريب مني');
  said = await lastSaid(p);
  ok('«قريب مني» asks for the area: the page does not know where you are', said.includes('ما أعرف وين أنت'), said);

  await ask(p, 'الجهراء');
  said = await lastSaid(p);
  ok('a part of Kuwait with nothing in it is named, not «ما لقيت شي»', said.includes('بالجهراء') && !said.includes('ما لقيت'), said);
  ok('…and still no cards', (await cards()) === 0);

  await ask(p, 'قهوة');
  const coffee = await p.locator('[data-salem-places]').last().locator('li[data-slug]')
    .evaluateAll((els) => els.map((e) => e.dataset.slug)).catch(() => []);
  ok('«قهوة» is an answer with places', coffee.length >= 2, coffee.join(','));

  await ask(p, 'شكراً');
  said = await lastSaid(p);
  ok('«شكراً» is thanked back, not searched', said.includes('العفو'), said);
  ok('…and the coffee answer keeps its chips', await p.locator('[data-followups] button', { hasText: 'وين بالضبط؟' }).count() === 1);

  // The chip under the coffee: where, for one of THOSE cafés. Each «where»
  // draws a map block with a «صفحته» link; the newest one is read only once
  // the count has grown, or an earlier block is read in its place.
  const pages = () => p.locator('[role="log"] a', { hasText: 'صفحته' }).count();
  const where = async (before) => {
    await p.waitForFunction(() => !document.querySelector('[role="log"] [data-typing]'), null, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(300);
    if ((await pages()) !== before + 1) return null;
    const href = await p.locator('[role="log"] a', { hasText: 'صفحته' }).last().getAttribute('href', { timeout: 2000 }).catch(() => null);
    return href?.match(/^\/places\/([^/]+)\/$/)?.[1] ?? null;
  };
  let before = await pages();
  await p.locator('[data-followups] button', { hasText: 'وين بالضبط؟' }).click({ timeout: 3000 }).catch(() => {});
  const there = await where(before);
  ok('«وين بالضبط؟» after the thanks answers for the first café, not the words', there === coffee[0], `${there} vs ${coffee.join(',')}`);

  before = await pages();
  await ask(p, 'وين الثاني؟');
  const second = await where(before);
  ok('«وين الثاني؟» shows the second café on the map', second === coffee[1], `${second} vs ${coffee.join(',')}`);

  await ask(p, 'زززققق');
  ok('a word that matches nothing still says so', (await lastSaid(p)).includes('ما لقيت شي'));
  // A chip still on screen belongs to the answer it came with, and acts on
  // it — whatever the memory holds (a miss used to wipe it; it keeps it now).
  before = await pages();
  await p.locator('[data-followups] button', { hasText: 'وين بالضبط؟' }).click({ timeout: 3000 }).catch(() => {});
  const after = await where(before);
  ok('…and the coffee answer\'s chip still acts on the coffee, with a map of its own', coffee.includes(after ?? ''), `${after} vs ${coffee.join(',')}`);
  ok('no page errors in any of it', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── thanks, counts, «no» and a miss keep the answer (14 October) ──');
{
  /* Replayed against the free chat on 14 October, each of these was a search:
     «يعطيك الصحة» answered with a house, «كم مكان فيه؟» opened one place, «رقم
     ٩» under eight a stranger, «مو هذي» the same eight again, and a miss wiped
     the memory so the «غيره» typed after it asked «عن شنو؟». The reader is
     unit-tested; this is the page saying what the reader read. */
  const { ctx, p, errors } = await fresh('/salem/');
  const cards = () => p.locator('[role="log"] a[href^="/places/"]').count();

  await ask(p, '👍');
  let said = await lastSaid(p);
  ok('a thumbs-up with nothing on screen is a nod, not a hello', said.includes('تمام') && !said.includes('هلا'), said);
  await ask(p, 'كم مكان عندك؟');
  said = await lastSaid(p);
  ok('«كم مكان عندك؟» with nothing on screen counts the guide', said.includes('عندي') && said.includes('مكان بالكويت'), said);

  await ask(p, 'مطعم');
  const shown = await cards();
  ok('«مطعم» is an answer with more than one page of places', shown >= 8, String(shown));

  await ask(p, 'يعطيك الصحة');
  said = await lastSaid(p);
  ok('«يعطيك الصحة» is thanked back, not searched', said.includes('الله يعافيك'), said);
  ok('…with no cards drawn for it', (await cards()) === shown);

  await ask(p, 'كم مكان فيه؟');
  said = await lastSaid(p);
  ok('«كم مكان فيه؟» counts the answer on screen', said.includes('لقيت') && said.includes('«مطعم»') && said.includes('غيره'), said);
  ok('…and draws nothing', (await cards()) === shown);

  await ask(p, 'رقم ٩');
  said = await lastSaid(p);
  ok('«رقم ٩» under eight says there is no ninth', said.includes('ما عندي تاسع'), said);

  await ask(p, 'كم سعره؟');
  said = await lastSaid(p);
  ok('«كم سعره؟» says the guide has no price, only its band', said.includes('ما عندي أسعاره بالضبط'), said);

  const before = await cards();
  await ask(p, 'مو هذي');
  said = await lastSaid(p);
  ok('«مو هذي» is a «no» to the answer: he asks what instead', said.includes('ما عجبتك') && said.includes('بدالها'), said);
  ok('…and nothing is searched for it', (await cards()) === before);

  await ask(p, 'زززققق');
  said = await lastSaid(p);
  ok('a miss after an answer says the answer is still there', said.includes('ما لقيت شي') && said.includes('اللي قبل باقية'), said);
  await ask(p, 'غيره');
  said = await lastSaid(p);
  ok('…and «غيره» typed after it goes on with that answer, not «عن شنو؟»', said.includes('وهذي غيرها') && !said.includes('عن شنو'), said);
  ok('…with more cards', (await cards()) > before, `${before} → ${await cards()}`);
  ok('no page errors in any of it', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── with the browser\'s storage blocked, his buttons still work ──');
{
  /* «Block all cookies» in Safari, and some private modes: reading
     localStorage THROWS. The haptics read it unguarded, so every tap that
     buzzes threw: «رسّلها» stayed on «لحظة…» for good and the call button in
     his header did nothing (8 October). */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW' });
  await ctx.addInitScript(() => {
    for (const name of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(window, name, {
        configurable: true,
        get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
      });
    }
    // The share sheet answers at once, so what is read is the button's own label.
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => {} });
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => true });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${B}/salem/`, { waitUntil: 'networkidle' });
  await ask(p, 'قهوة');
  ok('he answers with storage refused', await p.locator('[role="log"] a[href^="/places/"]').count() >= 1);
  const send = p.locator('[role="log"]').getByRole('button', { name: /^(رسّلها|لحظة…)$/ }).first();
  await send.click({ timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(800);
  const label = ((await send.textContent({ timeout: 2000 }).catch(() => '')) ?? '').trim();
  ok('«رسّلها» sends and comes back, instead of staying on «لحظة…»', label === 'رسّلها', label);
  await p.locator('header').getByRole('button', { name: 'كلّم سالم' }).click({ timeout: 3000 }).catch(() => {});
  const rang = await p.locator('#wain-ai-panel').waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false);
  ok('the call button in his header opens the call', rang);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── on a computer the chat keeps to one centred column ──');
{
  // 7 October: at 1280 the replies ran against one edge, the visitor's lines
  // against the other, and the input box was 1200px wide.
  const { ctx, p } = await fresh('/salem/', { width: 1280, height: 800 });
  const box = await p.locator('#salem-q').boundingBox();
  const log = await p.locator('[role="log"]').evaluate((el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { inner: r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) };
  });
  ok('the input box is no wider than the column', (box?.width ?? 9999) <= 680, String(box?.width));
  ok('and centred under it', Math.abs(((box?.x ?? 0) + (box?.width ?? 0) / 2) - 640) < 40, String(box?.x));
  ok('the transcript is one 42rem column', log.inner <= 672.5, String(log.inner));
  await ctx.close();
}

console.log('\n── سالم and /search name the same place ──');
{
  /* The chat ordered its hits by reviews and /search did not, so «مطعم كويتي»
     could be one place in the chat and another on the page. Both go through
     answerOrder now (3 October). Checked at a pinned Kuwait clock, in winter
     and in a summer afternoon, because the season is part of the order. */
  const open = async (path, iso) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW' });
    const p = await ctx.newPage();
    await p.clock.setFixedTime(new Date(iso));
    await p.route('**openstreetmap.org**', (r) => r.abort());
    await p.goto(`${B}${path}`, { waitUntil: 'networkidle' });
    return { ctx, p };
  };
  for (const iso of ['2026-01-15T11:00:00Z', '2026-08-15T11:00:00Z']) {
    for (const q of ['مطعم كويتي', 'قهوة', 'مطعم رخيص', 'وين أروح الحين']) {
      const chat = await open('/salem/', iso);
      await ask(chat.p, q);
      const card = await chat.p.locator('[role="log"] a[href^="/places/"]').first().getAttribute('href', { timeout: 2000 }).catch(() => null);
      await chat.ctx.close();
      const page = await open(`/search/?q=${encodeURIComponent(q)}`, iso);
      await page.p.waitForTimeout(400);
      const named = await page.p.locator('section[aria-label*="شوق"] a[href^="/places/"]').first().getAttribute('href', { timeout: 2000 }).catch(() => null);
      await page.ctx.close();
      ok(`«${q}» (${iso.slice(5, 7) === '08' ? 'August' : 'January'}): the chat's first card is the place /search names`,
        !!card && card === named, `${card} vs ${named}`);
    }
  }
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
      () => document.querySelector('[role="log"]')?.textContent.includes('ما وصلنا رد'),
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

console.log('\n── reading aloud, remembered from an earlier visit, speaks on an iPhone ──');
{
  // iOS lets speechSynthesis talk only once a speak() has run inside a tap,
  // and drops every other one without an error or an end (WebKit,
  // SpeechSynthesis.cpp). His reply is never inside the tap that asked — it
  // waits on the voice list, the search chunk, or the socket — so with «اقرا
  // لي» remembered from an earlier visit an iPhone read nothing until the
  // switch was flipped off and on again (8 October). The engine here is a
  // stand-in that keeps WebKit's rule: a tap is a trusted input event and the
  // task it runs in, and nothing speaks until one speak() has run inside one.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW' });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('wain-salem-read', '1'); } catch { /* the check below fails instead */ }
    let gesture = false;
    let unlocked = false;
    for (const t of ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup', 'touchend', 'submit'])
      window.addEventListener(t, (e) => {
        if (!e.isTrusted) return;
        gesture = true;
        setTimeout(() => { gesture = false; }, 0);
      }, true);
    window.__spoken = [];
    window.__dropped = [];
    const synth = {
      speaking: false, pending: false, paused: false,
      getVoices: () => [], addEventListener() {}, removeEventListener() {},
      cancel() {}, pause() {}, resume() {},
      speak(u) {
        if (gesture) unlocked = true;
        if (!unlocked) { window.__dropped.push(u.text); return; }
        window.__spoken.push(u.text);
        setTimeout(() => u.onend?.(new Event('end')), 20);
      },
    };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => synth });
  });
  const p = await ctx.newPage();
  await p.goto(`${B}/salem/`, { waitUntil: 'networkidle' });
  await ask(p, 'قهوة');
  await p.waitForFunction(() => window.__spoken.some((t) => t.trim()) || window.__dropped.some((t) => t.trim()),
    null, { timeout: 6000 }).catch(() => {});
  const heard = await p.evaluate(() => ({
    spoken: window.__spoken.filter((t) => t.trim()),
    dropped: window.__dropped.filter((t) => t.trim()),
  }));
  ok(`his reply is read out (${heard.spoken.length} sentence(s))`, heard.spoken.length > 0, JSON.stringify(heard).slice(0, 200));
  ok(`and none of it is dropped for want of a tap (${heard.dropped.length})`, heard.dropped.length === 0, JSON.stringify(heard.dropped).slice(0, 200));
  await ctx.close();
}

console.log('\n── the job travels between them (14 October) ──');
{
  /**
   * «كمّل مع سالم» carried one string: the places she had put on screen, and
   * the one the visitor had picked, stayed behind (lib/agent-job.ts). The job
   * goes with the question now, in this tab only.
   */
  const job = (p) => p.evaluate(() => {
    try { return JSON.parse(sessionStorage.getItem('wain:job:v1') ?? 'null'); } catch { return null; }
  });
  const { ctx, p, errors } = await fresh('/search/?q=' + encodeURIComponent('قهوة'));
  const results = await p.locator('main a[href^="/places/"]').evaluateAll((as) =>
    [...new Set(as.map((a) => new URL(a.href).pathname.split('/')[2]).filter(Boolean))]);
  await p.getByRole('link', { name: 'كمّل مع سالم' }).first().click({ timeout: 4000 }).catch(() => {});
  await p.waitForURL((u) => new URL(u).pathname === '/salem/', { timeout: 6000 }).catch(() => {});
  const handed = await job(p);
  ok('«كمّل مع سالم» hands him her job: the question', handed?.by === 'shouq-answer' && handed?.asked === 'قهوة', JSON.stringify(handed));
  ok('and her places, in her order', !!handed && handed.shown.length > 0 && handed.shown[0] === results[0],
    `${JSON.stringify(handed?.shown?.slice(0, 3))} vs ${JSON.stringify(results.slice(0, 3))}`);
  await p.locator('[role="log"] a[href^="/places/"]').first().waitFor({ state: 'attached', timeout: 9000 }).catch(() => {});
  const mine = await job(p);
  ok('his answer becomes the job he holds', mine?.by === 'salem-chat' && mine?.asked === 'قهوة' && mine.shown.length > 0, JSON.stringify(mine));

  // A job with a pick, handed over with its question: the line names the
  // place picked there, and «وينه؟» means it.
  const second = results[1];
  await p.goto(`${B}/search/?q=${encodeURIComponent('قهوة')}`, { waitUntil: 'networkidle' });
  await p.evaluate(([s, ranked]) => sessionStorage.setItem('wain:job:v1', JSON.stringify({
    v: 1, by: 'shouq-call', asked: 'قهوة', shown: ranked.slice(0, 8), ranked, picked: s, at: Date.now(),
  })), [second, results]);
  await p.goto(`${B}/salem/?q=${encodeURIComponent('قهوة')}&from=call`, { waitUntil: 'networkidle' });
  await p.locator('[role="log"] a[href^="/places/"]').first().waitFor({ state: 'attached', timeout: 9000 }).catch(() => {});
  // The newest line: the tab keeps the chat from before, with its own line.
  const line = (await p.locator('[role="log"] p[role="status"]').last().textContent({ timeout: 3000 }).catch(() => '')) ?? '';
  ok('the line over the question names the place picked with her', line.includes('من مكالمتك مع شوق') && line.includes('واخترت'), line);
  await ask(p, 'وينه؟');
  const where = await lastSaid(p);
  const picked = await p.evaluate(async (s) => {
    const html = await (await fetch(`/places/${s}/`)).text();
    return html.match(/<h1[^>]*>([^<]+)</)?.[1] ?? '';
  }, second);
  ok('and «وينه؟» means that place, not his first', !!picked && where.includes(picked), `${where} — expected ${picked}`);
  ok('no page errors through it', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
{
  // The server's call-centre page hands a question over the same way.
  const { ctx, p } = await fresh(`/salem/?q=${encodeURIComponent('بحر')}&from=call-center`);
  await p.locator('[role="log"] a[href^="/places/"]').first().waitFor({ state: 'attached', timeout: 9000 }).catch(() => {});
  const line = (await p.locator('[role="log"] p[role="status"]').first().textContent({ timeout: 3000 }).catch(() => '')) ?? '';
  ok('a question from the call centre says so', line.includes('من مركز الاتصال') && line.includes('بحر'), line);
  await ctx.close();
}

/*
 * /salem on phones, as measured on 15 October at five widths, sideways and
 * installed: each block below is one thing the shipped page got wrong, and
 * each was red against it. Soft throughout — a wait that times out is a red
 * line here, never the end of the file. The clock is pinned (Kuwait, 10 in the
 * morning) because the order of an answer, and so which pins sit where, moves
 * with the hour.
 */
const PINNED = '2026-10-15T07:00:00Z';
async function at(path, { viewport = { width: 390, height: 844 }, reduced = false, standalone = false, blockScripts = false } = {}) {
  const ctx = await browser.newContext({
    viewport, isMobile: true, hasTouch: true, locale: 'ar-KW',
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  if (blockScripts) await ctx.route('**/*.js', (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.clock.setFixedTime(new Date(PINNED)).catch(() => {});
  // The tiles are refused by this sandbox; failing them at once keeps the
  // network idle wait short and changes nothing measured here.
  await p.route('**openstreetmap.org**', (r) => r.abort());
  await p.goto(`${B}${path}`, { waitUntil: blockScripts ? 'domcontentloaded' : 'networkidle' }).catch(() => {});
  if (standalone) await p.evaluate(() => { document.documentElement.dataset.standalone = 'true'; }).catch(() => {});
  return { ctx, p, errors };
}
/** The newest element matching `sel` against the transcript's box: whether it
 *  is all on screen, and where (px from the transcript's top). */
const inLog = (p, sel) => p.evaluate((sel) => {
  const log = document.querySelector('[role="log"]')?.getBoundingClientRect();
  const el = [...document.querySelectorAll(sel)].at(-1);
  if (!log || !el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: Math.round(r.top - log.top), bottom: Math.round(r.bottom - log.top), log: Math.round(log.height),
    whole: r.top >= log.top - 1 && r.bottom <= log.bottom + 1,
  };
}, sel).catch(() => null);
/** Settle a smooth scroll. */
const settle = (p) => p.waitForTimeout(1000);

console.log('\n── on a phone: «وينه؟» lands with its map on screen ──');
for (const [width, height, reduced] of [[320, 568, false], [390, 844, false], [320, 568, true]]) {
  // The reply was scrolled to while its map was still 2px tall (the map is
  // fitted a commit later), so the scroll stopped at the old, shorter end and
  // 11–21% of the map it points to showed — «مكانه على الخريطة تحت», under
  // the fold, at every phone width.
  const { ctx, p } = await at('/salem/', { viewport: { width, height }, reduced });
  await ask(p, 'قهوة');
  await ask(p, 'وينه؟');
  await settle(p);
  const map = await inLog(p, '[role="log"] [data-map-frame]');
  ok(`${width}×${height}${reduced ? ', reduced motion' : ''}: the map «وينه؟» points to is all on screen`, !!map?.whole, JSON.stringify(map));
  // At the top, or as near it as the transcript goes: a short reply at the
  // end of a tall screen cannot be lifted further than the bottom.
  const said = await inLog(p, '[role="log"] div[data-line].justify-start');
  const end = await p.evaluate(() => {
    const log = document.querySelector('[role="log"]');
    return log.scrollHeight - log.scrollTop - log.clientHeight < 2;
  }).catch(() => false);
  ok(`${width}×${height}${reduced ? ', reduced motion' : ''}: …and the reply still starts at the top`,
    !!said?.whole && (said.top <= 24 || end), JSON.stringify({ ...said, end }));
  await ctx.close();
}

console.log('\n── on a phone: a pasted link stays in its bubble ──');
{
  // 59 characters with no place to break: the bubble's text ran 186px off the
  // screen's left edge at 320, and the whole transcript slid sideways under a
  // finger by 196px.
  const link = 'https://maps.app.goo.gl/Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56Qr7';
  const lines = (p, sel) => p.evaluate((sel) => {
    const log = document.querySelector('[role="log"]');
    const el = [...log.querySelectorAll(sel)].at(-1);
    if (!el) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()];
    return {
      scroll: log.scrollWidth, client: log.clientWidth, w: innerWidth,
      own: el.scrollWidth, ownClient: el.clientWidth,
      left: Math.round(Math.min(...rects.map((r) => r.left))), right: Math.round(Math.max(...rects.map((r) => r.right))),
    };
  }, sel).catch(() => null);
  {
    const { ctx, p } = await at('/salem/', { viewport: { width: 320, height: 568 } });
    await ask(p, link);
    const m = await lines(p, '.justify-end p');
    ok('320: the transcript does not scroll sideways under a pasted link', !!m && m.scroll <= m.client, JSON.stringify(m));
    ok('320: …and every line of the visitor\'s bubble is on the screen', !!m && m.left >= 0 && m.right <= m.w, JSON.stringify(m));
    await ctx.close();
  }
  {
    const { ctx, p } = await at(`/salem/?q=${encodeURIComponent(link)}&from=call`, { viewport: { width: 320, height: 568 } });
    await p.locator('[role="log"] .justify-end p').first().waitFor({ state: 'attached', timeout: 9000 }).catch(() => {});
    await settle(p);
    // The line's own box and its own text only: the transcript's sideways
    // scroll is the bubbles' to answer for (above), and the handed-over link's
    // own bubble overflowing it read here as the line's fault.
    const m = await lines(p, 'p[role="status"]');
    ok('320: the line over a handed-over link stays on the screen too', !!m && m.own <= m.ownClient && m.left >= 0 && m.right <= m.w, JSON.stringify(m));
    await ctx.close();
  }
}

console.log('\n── on a phone: a tapped «إرسال» keeps the keyboard up ──');
{
  // A tap moved focus from the box to the button, which then disabled itself
  // on the empty draft: focus ended on <body> after 8 of 8 tapped sends, and
  // Android drops its keyboard when the box loses focus. Enter kept it.
  const { ctx, p } = await at('/salem/');
  await p.locator('#salem-q').fill('قهوة', { timeout: 3000 }).catch(() => {});
  await p.getByRole('button', { name: 'إرسال' }).tap({ timeout: 3000 }).catch(() => {});
  await p.locator('[role="log"] a[href^="/places/"]').first().waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(300);
  ok('the tapped message went', (await p.locator('[role="log"] .justify-end p', { hasText: /^قهوة$/ }).count()) === 1);
  const focus = await p.evaluate(() => document.activeElement?.id || document.activeElement?.tagName).catch(() => null);
  ok('…and the box still has focus after it', focus === 'salem-q', String(focus));
  await ctx.close();
}

console.log('\n── on a phone: arriving from a call, the line that says so is on screen ──');
for (const [width, height] of [[320, 568], [390, 844]]) {
  // «من مكالمتك مع شوق: «قهوة»» was scrolled above the transcript's top every
  // time (0px of it showed at 320–390): the reply was anchored at its own first
  // line, and the line saying where the question came from sits above it.
  const { ctx, p } = await at(`/salem/?q=${encodeURIComponent('قهوة')}&from=call`, { viewport: { width, height } });
  await p.locator('[role="log"] a[href^="/places/"]').first().waitFor({ state: 'attached', timeout: 9000 }).catch(() => {});
  await settle(p);
  const line = await inLog(p, '[role="log"] p[role="status"]');
  ok(`${width}×${height}: the «من مكالمتك» line is all on screen`, !!line?.whole, JSON.stringify(line));
  const said = await inLog(p, '[role="log"] div[data-line].justify-start');
  ok(`${width}×${height}: …and so is his answer's first sentence`, !!said?.whole, JSON.stringify(said));
  await ctx.close();
}
{
  // With a place picked with her, the line runs to two lines at 320 and the
  // line, the question, the sentence and the first card did not fit together,
  // so the reply's start won and the line — the one place that says what
  // «وينه؟» will answer about — sat 58px above the transcript, 0px on screen.
  const { ctx, p } = await at('/privacy/', { viewport: { width: 320, height: 568 } });
  await p.evaluate(() => sessionStorage.setItem('wain:job:v1', JSON.stringify({
    v: 1, by: 'shouq-call', asked: 'قهوة', shown: [], ranked: [], picked: 'hamad-al-mubarak-street', at: Date.now(),
  }))).catch(() => {});
  await p.goto(`${B}/salem/?q=${encodeURIComponent('قهوة')}&from=call`, { waitUntil: 'networkidle' }).catch(() => {});
  await p.locator('[role="log"] a[href^="/places/"]').first().waitFor({ state: 'attached', timeout: 9000 }).catch(() => {});
  await settle(p);
  const text = (await p.locator('[role="log"] p[role="status"]').last().textContent({ timeout: 2000 }).catch(() => '')) ?? '';
  ok('320×568, a pick carried with her: the line names it', text.includes('واخترت'), text);
  const line = await inLog(p, '[role="log"] p[role="status"]');
  ok('320×568, a pick carried with her: …and the line is all on screen', !!line?.whole, JSON.stringify(line));
  const said = await inLog(p, '[role="log"] div[data-line].justify-start');
  ok('320×568, a pick carried with her: …with his answer\'s first sentence under it', !!said?.whole, JSON.stringify(said));
  await ctx.close();
}
{
  // Sideways the transcript is about 204px, and the line, the question and the
  // first card do not fit in it together: the reply keeps its start at the
  // top, as before, so its first card is on screen rather than cut to 40px.
  const { ctx, p } = await at(`/salem/?q=${encodeURIComponent('قهوة')}&from=call`, { viewport: { width: 844, height: 390 } });
  await p.locator('[role="log"] a[href^="/places/"]').first().waitFor({ state: 'attached', timeout: 9000 }).catch(() => {});
  await settle(p);
  const said = await inLog(p, '[role="log"] div[data-line].justify-start');
  ok('844×390, from a call: the reply still starts at the top of the transcript', !!said?.whole && said.top <= 16, JSON.stringify(said));
  await ctx.close();
}

console.log('\n── sideways with the keyboard up, the box is whole ──');
{
  // 844×200 is a phone on its side with the keyboard up: the frame's fixed
  // rows needed 218px and the box was clipped. The consent line steps aside
  // while the box has focus there, and only there (on request, 15 October).
  const read = (p) => p.evaluate(() => {
    const form = document.querySelector('form');
    const notice = form?.previousElementSibling;
    const input = document.getElementById('salem-q').getBoundingClientRect();
    const frame = document.querySelector('header').parentElement.getBoundingClientRect();
    return {
      notice: !!notice && getComputedStyle(notice).display !== 'none' && notice.getBoundingClientRect().height > 0,
      top: Math.round(input.top), bottom: Math.round(form.getBoundingClientRect().bottom),
      floor: Math.round(Math.min(frame.bottom, innerHeight)), log: document.querySelector('[role="log"]').clientHeight,
    };
  }).catch(() => null);
  {
    const { ctx, p } = await at('/salem/', { viewport: { width: 844, height: 200 } });
    ok('844×200: before typing, the consent line is there', !!(await read(p))?.notice);
    await p.locator('#salem-q').focus({ timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(200);
    const typing = await read(p);
    ok('844×200: …and steps aside while the box has focus', typing?.notice === false, JSON.stringify(typing));
    // The form's own foot too: it was the row the frame clipped (218px of
    // fixed rows in 200), and the transcript was its own 32px of padding.
    ok('844×200: …so the box\'s row is whole on the screen', !!typing && typing.top >= 0 && typing.bottom <= typing.floor, JSON.stringify(typing));
    ok('844×200: …with room left for the conversation', (typing?.log ?? 0) > 40, JSON.stringify(typing));
    await p.evaluate(() => document.activeElement?.blur()).catch(() => {});
    await p.waitForTimeout(200);
    ok('844×200: …and comes back when the box is left', !!(await read(p))?.notice);
    await ctx.close();
  }
  {
    const { ctx, p } = await at('/salem/', { viewport: { width: 844, height: 390 } });
    await p.locator('#salem-q').focus({ timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(200);
    ok('844×390: with room for it, the consent line stays while typing', !!(await read(p))?.notice);
    await ctx.close();
  }
}

console.log('\n── on a phone: an answer\'s first card is on the answer\'s edge ──');
{
  // The rail snapped its first card to the scroller's own edge, which the
  // bleed puts on the screen's: the recommended place sat flush at 0px while
  // everything else in the answer was 16px in.
  const { ctx, p } = await at('/salem/');
  await ask(p, 'قهوة');
  await p.waitForTimeout(500);
  const m = await p.evaluate(() => {
    const ul = document.querySelector('[data-salem-places] ul');
    const li = ul?.querySelector('li');
    return li ? { scrollLeft: ul.scrollLeft, fromEdge: Math.round(innerWidth - li.getBoundingClientRect().right) } : null;
  }).catch(() => null);
  ok('the rail rests where it starts', !!m && Math.abs(m.scrollLeft) < 1, JSON.stringify(m));
  ok('…with its first card 16px in, like the rest of the answer', m?.fromEdge === 16, JSON.stringify(m));
  await ctx.close();
}

console.log('\n── installed: the chat meets the tab bar ──');
for (const [width, height] of [[390, 844], [320, 568]]) {
  // The frame leaves 4.25rem for the tab bar and the bar measured 64.94px, so
  // a 3px strip of white page showed between them on every visit.
  const { ctx, p } = await at('/salem/', { viewport: { width, height }, standalone: true });
  await p.waitForTimeout(200);
  const m = await p.evaluate(() => {
    const frame = document.querySelector('header').parentElement.getBoundingClientRect();
    const nav = document.querySelector('nav.app-chrome').getBoundingClientRect();
    return { frameBottom: frame.bottom, navTop: nav.top };
  }).catch(() => null);
  ok(`${width}×${height} installed: no strip between the chat and the tab bar`, !!m && Math.abs(m.navTop - m.frameBottom) < 0.5, JSON.stringify(m));
  await ctx.close();
}

console.log('\n── on a narrow phone, two pins do not sit on each other ──');
{
  // Grouped by their TIPS, a surveyed pin and an approximate one stood 36.9px
  // apart at the tip and 23.8px at the head, so at 320 the Gulf Road cafés
  // covered half of سوق الصفافير's circle. The heads are what must not overlap
  // (MapPin); only the top result and the pointed-at pin are kept apart.
  const { ctx, p } = await at('/salem/', { viewport: { width: 320, height: 568 } });
  await ask(p, 'قهوة');
  await p.waitForTimeout(400);
  const m = await p.evaluate(() => {
    const block = [...document.querySelectorAll('[data-salem-places]')].at(-1);
    const top = block?.querySelector('li[data-slug]')?.dataset.slug;
    const pins = [...(block?.querySelectorAll('[data-map-frame] a[href^="/places/"]') ?? [])].map((a) => ({
      slug: a.getAttribute('href').split('/')[2], current: a.getAttribute('aria-current') === 'true', r: a.getBoundingClientRect(),
    }));
    const overlaps = [];
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        const [a, b] = [pins[i], pins[j]];
        if ([a, b].some((x) => x.slug === top || x.current)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 0.5 && h > 0.5) overlaps.push(`${a.slug}~${b.slug} ${w.toFixed(1)}×${h.toFixed(1)}`);
      }
    }
    return { pins: pins.length, overlaps };
  }).catch(() => null);
  ok('320: the answer has its pins', (m?.pins ?? 0) >= 1, JSON.stringify(m));
  ok('320: no two of them overlap (bar the top result)', !!m && m.overlaps.length === 0, JSON.stringify(m));
  await ctx.close();
}

console.log('\n── sideways, an answer\'s map fits the chat window ──');
{
  // At 844×390 the transcript is about 204px tall and «بحر»'s map was 525px:
  // no scroll position showed all of its pins.
  const { ctx, p } = await at('/salem/', { viewport: { width: 844, height: 390 } });
  await ask(p, 'بحر');
  await p.waitForTimeout(400);
  const m = await p.evaluate(() => ({
    map: Math.round([...document.querySelectorAll('[data-salem-places] [data-map-frame]')].at(-1)?.getBoundingClientRect().height ?? -1),
    log: document.querySelector('[role="log"]').clientHeight,
  })).catch(() => null);
  ok('844×390: «بحر»\'s map is no taller than the chat window', !!m && m.map > 0 && m.map <= m.log, JSON.stringify(m));
  await ctx.close();
}
{
  // The «وينه؟» map is the other map in the chat (SalemWhere), and it was
  // 630×420 in a 204px window — capped by the same `maxHeight`, and nothing
  // held it to that until now.
  const { ctx, p } = await at('/salem/', { viewport: { width: 844, height: 390 } });
  await ask(p, 'قهوة');
  await ask(p, 'وينه؟');
  await p.waitForTimeout(400);
  const m = await p.evaluate(() => ({
    map: Math.round([...document.querySelectorAll('[role="log"] [data-map-frame]')].at(-1)?.getBoundingClientRect().height ?? -1),
    log: document.querySelector('[role="log"]').clientHeight,
    // The newest map is the «وينه؟» one, not the answer's above it.
    where: (() => {
      const frame = [...document.querySelectorAll('[role="log"] [data-map-frame]')].at(-1);
      return !!frame && !frame.closest('[data-salem-places]');
    })(),
  })).catch(() => null);
  ok('844×390: «وينه؟»\'s map is no taller than the chat window either', !!m && m.where && m.map > 0 && m.map <= m.log, JSON.stringify(m));
  await ctx.close();
}

console.log('\n── installed, typing: the tab bar steps aside ──');
{
  // Android shrinks the layout for its keyboard and the tab bar rode up on top
  // of it, while the frame still left room for the bar: 79px of conversation
  // at 360×640 with the keyboard up, against 147 in a browser tab.
  const typing = async (standalone) => {
    const { ctx, p } = await at('/salem/', { viewport: { width: 360, height: 640 }, standalone });
    await p.locator('#salem-q').focus({ timeout: 3000 }).catch(() => {});
    await p.setViewportSize({ width: 360, height: 352 }).catch(() => {});
    await p.waitForTimeout(300);
    const nav = () => p.evaluate(() => {
      const el = document.querySelector('nav.app-chrome');
      return el ? getComputedStyle(el).display : 'none';
    }).catch(() => null);
    const log = await p.evaluate(() => document.querySelector('[role="log"]').clientHeight).catch(() => -1);
    return { ctx, p, nav, log, shown: await nav() };
  };
  const tab = await typing(false);
  await tab.ctx.close();
  const app = await typing(true);
  ok('installed: the tab bar is hidden while the box has focus', app.shown === 'none', String(app.shown));
  ok('installed: …and the conversation gets the room a browser tab has', Math.abs(app.log - tab.log) < 1, `${app.log} vs ${tab.log}`);
  await app.p.evaluate(() => document.activeElement?.blur()).catch(() => {});
  await app.p.waitForTimeout(200);
  const back = await app.nav();
  ok('installed: …and comes back when the box is left', !!back && back !== 'none', String(back));
  await app.ctx.close();
}
{
  // Only where a keyboard comes up. Installed on a computer, a click on the
  // box hid the app's navigation and moved the box 68px from under the
  // pointer that had just pressed it, and nothing followed to use the room.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-KW' });
  const p = await ctx.newPage();
  await p.route('**openstreetmap.org**', (r) => r.abort());
  await p.goto(`${B}/salem/`, { waitUntil: 'networkidle' }).catch(() => {});
  await p.evaluate(() => { document.documentElement.dataset.standalone = 'true'; }).catch(() => {});
  await p.waitForTimeout(200);
  const read = () => p.evaluate(() => ({
    nav: getComputedStyle(document.querySelector('nav.app-chrome')).display,
    top: Math.round(document.getElementById('salem-q').getBoundingClientRect().top),
  })).catch(() => null);
  const before = await read();
  await p.locator('#salem-q').click({ timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(200);
  const after = await read();
  ok('installed, with a mouse: the box took the click', await p.evaluate(() => document.activeElement?.id === 'salem-q').catch(() => false));
  ok('installed, with a mouse: …and the tab bar stays', !!after && after.nav !== 'none', JSON.stringify({ before, after }));
  ok('installed, with a mouse: …and the box stays where it was clicked', !!before && !!after && before.top === after.top, JSON.stringify({ before, after }));
  await ctx.close();
}

console.log('\n── a narrowing that keeps the first place says so ──');
{
  // «بحر» then «أرخص»: both replies said «جرّب شاطئ المسيلة. روح العصر لين
  // الغروب.», word for word — the top three were already the cheapest, so the
  // first screen did not change and the request read as ignored.
  //
  // `said` returns the first reply and only the replies the second message
  // drew. It used to read the last two lines of the log, so a narrowing that
  // drew no reply at all was checked against the first one and passed.
  const said = async (first, then) => {
    const { ctx, p } = await at('/salem/');
    const HIS = '[role="log"] div[data-line].justify-start > p';
    await ask(p, first);
    const before = await p.locator(HIS).allTextContents().catch(() => []);
    await ask(p, then);
    const after = await p.locator(HIS).allTextContents().catch(() => []);
    await ctx.close();
    return { first: before.at(-1) ?? '', added: after.slice(before.length) };
  };
  const tried = (r) => r.added.length === 1 && r.added[0].length > 0;
  // The place a reply recommends, with its area: «جرّب …» up to the full stop.
  const placeOf = (line) => line.match(/جرّب ([^.]+)\./)?.[1] ?? null;

  const cheaper = await said('بحر', 'أرخص');
  ok('«بحر» then «أرخص»: one new reply, not the first one again', tried(cheaper) && cheaper.added[0] !== cheaper.first, JSON.stringify(cheaper));
  ok('…it says these are the cheapest and the first is unchanged', (cheaper.added[0] ?? '').startsWith('هذي أرخصها — والأول ما تغيّر:'), JSON.stringify(cheaper));

  // «للعيال» after «مطعم» reorders the restaurants and keeps ميس الغانم on top.
  const narrowed = await said('مطعم', 'للعيال');
  ok('«مطعم» then «للعيال», a new order under the same first place: a narrowing line',
    tried(narrowed) && narrowed.added[0].startsWith('ضيّقتها لك — والأول ما تغيّر:'), JSON.stringify(narrowed));

  // «للعيال» after «قهوة» gives back the same four cafés in the same order:
  // «ضيّقتها لك» said a narrowing had happened that had not.
  const same = await said('قهوة', 'للعيال');
  ok('«قهوة» then «للعيال», nothing changed: a reply, with no narrowing claimed',
    tried(same) && same.added[0].startsWith('جرّب') && !same.added[0].includes('ضيّقتها'), JSON.stringify(same));

  const moved = await said('قهوة', 'داخلي');
  ok('«قهوة» then «داخلي», a new first place: one new reply, naming it, with no such line',
    tried(moved) && moved.added[0].startsWith('جرّب') && !moved.added[0].includes('ما تغيّر')
      && !!placeOf(moved.added[0]) && placeOf(moved.added[0]) !== placeOf(moved.first),
    JSON.stringify({ ...moved, was: placeOf(moved.first), now: placeOf(moved.added[0] ?? '') }));
}

console.log('\n── one edge for every row ──');
{
  // The header, the transcript and the notice sat 16px in and the box 12px,
  // so the input started 4px outside everything above it.
  const { ctx, p } = await at('/salem/');
  const m = await p.evaluate(() => {
    const form = getComputedStyle(document.querySelector('form'));
    return {
      form: [form.paddingLeft, form.paddingRight],
      input: Math.round(innerWidth - document.getElementById('salem-q').getBoundingClientRect().right),
    };
  }).catch(() => null);
  ok('the box sits on the same 16px edge as the rows above it', !!m && m.form.every((x) => x === '16px') && m.input === 16, JSON.stringify(m));
  await ctx.close();
}

console.log('\n── before its script runs, the header does not say «جاهز» ──');
{
  // The box is disabled until the page's script runs, and the header said
  // «جاهز» over it: 3–4 seconds on a slow phone in which a tap was lost.
  const { ctx, p } = await at('/salem/', { blockScripts: true });
  const m = await p.evaluate(() => ({
    status: document.querySelector('header p[aria-live]')?.textContent ?? null,
    disabled: document.getElementById('salem-q')?.disabled ?? null,
    placeholder: document.getElementById('salem-q')?.placeholder ?? null,
  })).catch(() => null);
  ok('with no script yet the box is disabled', m?.disabled === true, JSON.stringify(m));
  ok('…and the header says he is being reached, not ready', m?.status === 'نوصّل سالم…', JSON.stringify(m));
  ok('…and so does the box', m?.placeholder === 'نوصّل سالم…', JSON.stringify(m));
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : '\nكل شي تمام');
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
