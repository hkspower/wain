import { chromium } from 'playwright';

/**
 * The UX pass of 3 October — four things the owner chose from a measured list.
 *
 *   1. A finger gets 40px. --spacing-tap is 24px under a mouse and 40px under
 *      `pointer: coarse`; the chips that measured exactly 24px tall on a phone
 *      are asserted here at both, so neither floor can drift alone.
 *   2. /search reads in the order it answers: no numbered «١ · ٢ · ٣» line,
 *      no greyed tab for a kind the query did not find, and شوق's answer one
 *      line with the rest folded — so the first result row is on the first
 *      screen of a phone instead of under it.
 *   3. The empty spots: /search before typing offers the call, the categories
 *      and the home page's picks; the home page's picks have a heading; a
 *      place page has one way back, not two stacked.
 *   4. A desktop's first screen of the home page has something to press,
 *      until the sun itself is on screen — and a phone never sees that bar.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

async function open(path, { width = 390, height = 844, touch = width < 600 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch, locale: 'ar-KW' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.route('**openstreetmap.org**', (r) => r.abort());
  await p.goto(`${B}${path}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  return { ctx, p, errors };
}

// The visible chips a finger aims at on each page: the starters, the filter
// tabs, the category links and the hangout time chips.
// A read that cannot throw. A locator that matches nothing makes
// `.evaluate()` wait 30s and throw, which ends the process and silently skips
// every section after it — the coverage hole CLAUDE.md records three times.
const one = (p, sel, fn, arg) =>
  p.locator(sel).evaluateAll((els, [src, a]) => (els[0] ? new Function('return ' + src)()(els[0], a) : null), [fn.toString(), arg]);

const chipHeights = (p) => p.evaluate(() => [...document.querySelectorAll('main button, main a')]
  .filter((e) => {
    const r = e.getBoundingClientRect();
    // Not a map pin: its position is its meaning (the same exemption as
    // audit:mobile, WCAG 2.5.8), so it is sized for the map, not the thumb.
    return r.width > 0 && r.height > 0 && /rounded-full/.test(e.className)
      && getComputedStyle(e).position !== 'fixed' && !e.closest('[data-map-frame]');
  })
  .map((e) => Math.round(e.getBoundingClientRect().height)));

console.log('\n── 1. a finger gets 40px, a mouse keeps 24 ──');
for (const path of ['/search/', '/search/?q=قهوة', '/places/kuwait-towers/', '/explore/']) {
  {
    const { ctx, p } = await open(path);
    const h = await chipHeights(p);
    ok(`${path} on a phone: every chip is at least 40px tall`, h.length > 0 && Math.min(...h) >= 40, `${h.length} chips, min ${Math.min(...h)}`);
    await ctx.close();
  }
  {
    const { ctx, p } = await open(path, { width: 1280, height: 800, touch: false });
    const h = await chipHeights(p);
    ok(`${path} under a mouse: the compact 24px is kept`, h.length > 0 && Math.min(...h) < 40 && Math.min(...h) >= 24, `${h.length} chips, min ${Math.min(...h)}`);
    await ctx.close();
  }
}

console.log('\n── 2. /search reads in the order it answers ──');
{
  const { ctx, p, errors } = await open('/search/?q=قهوة');
  ok('no numbered «١. دوّر بالكتابة» line', (await p.locator('text=دوّر بالكتابة').count()) === 0);
  const tabs = await p.locator('[aria-label="نوع النتيجة"] button').allInnerTexts();
  ok('only the kinds this query found get a tab', tabs.length >= 2 && !tabs.some((t) => /مناطق|صفحات/.test(t)), tabs.join(' | '));
  ok('and none of them is a dead, disabled tab',
    (await p.locator('[aria-label="نوع النتيجة"] button:disabled').count()) === 0);

  const card = (await one(p, 'section[aria-label*="شوق"]', (s) => {
    const d = s.querySelector('details');
    return { h: Math.round(s.getBoundingClientRect().height), open: d?.open ?? null, folded: d?.textContent ?? '' };
  })) ?? { h: 9999, open: null, folded: '' };
  ok('شوق leads with one line: her card is short', card.h <= 200, `${card.h}px`);
  ok('the rest of her answer is folded, not gone', card.open === false && card.folded.includes('وإذا تبي غيره'), JSON.stringify(card));
  const summary = p.locator('section[aria-label*="شوق"] summary');
  if (await summary.count()) await summary.click();
  ok('and opens on a tap', (await one(p, 'section[aria-label*="شوق"] details', (d) => d.open)) === true);

  const firstRow = (await one(p, '[role="option"]', (e) => Math.round(e.getBoundingClientRect().top))) ?? 9999;
  ok('the first result row is on the first screen of a phone', firstRow < 844 - 60, `top ${firstRow}px`);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── 3. the empty spots ──');
{
  const { ctx, p } = await open('/search/');
  ok('an empty /search offers the call, as a link to /find',
    await p.locator('a[href="/find/"]', { hasText: 'كلّمي شوق' }).isVisible());
  ok('…and the categories', (await p.locator('main a[href^="/explore/?category="]:visible').count()) >= 6);
  ok('…and the home page\'s picks', (await p.locator('main a[href^="/places/"]:visible').count()) >= 4);
  const blank = await p.evaluate(() => {
    const last = [...document.querySelectorAll('main a[href^="/places/"]')].pop();
    return last ? Math.round(last.getBoundingClientRect().bottom) : 0;
  });
  ok('so the page is not six chips and a blank screen', blank > 844, `last pick ends at ${blank}px`);
  await ctx.close();
}
{
  const { ctx, p } = await open('/');
  const h = await p.locator('h2', { hasText: 'أماكن ما تنقال عنها لا' }).evaluateAll((es) => es[0]
    ? { sr: es[0].className.includes('sr-only'), w: es[0].getBoundingClientRect().width }
    : { sr: true, w: 0 });
  ok('the home page\'s picks have a heading you can see, beside «شوف الكل»', !h.sr && h.w > 40, JSON.stringify(h));
  await ctx.close();
}
{
  const { ctx, p } = await open('/places/kuwait-towers/');
  ok('a place page has no breadcrumb under the back button',
    (await p.locator('nav[aria-label="مسار التنقّل"]').count()) === 0);
  ok('…and the back button is still there', (await p.locator('[data-back-button]').count()) === 1);
  await ctx.close();
}

console.log('\n── 4. the desktop home page has something to press ──');
const bar = async (p) => (await one(p, '[data-start-bar]', (e) => ({
  shown: getComputedStyle(e).opacity === '1', inert: e.inert,
}))) ?? { shown: false, inert: true, missing: true };
{
  const { ctx, p } = await open('/', { width: 1280, height: 800, touch: false });
  await p.waitForTimeout(500);
  const sunTop = (await one(p, '[data-hero-sun]', (e) => Math.round(e.getBoundingClientRect().top))) ?? 0;
  const b = await bar(p);
  ok('at 1280×800 the sun is below the first screen', sunTop > 800, `sun at ${sunTop}px`);
  ok('so the «ابدأ» bar is up, and reachable', b.shown && !b.inert, JSON.stringify(b));
  await p.evaluate(() => document.querySelector('[data-hero-sun]')?.scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(600);
  const after = await bar(p);
  ok('once the sun is on screen the bar goes, and leaves the Tab order', !after.missing && !after.shown && after.inert, JSON.stringify(after));
  await p.evaluate(() => scrollTo(0, 0));
  await p.waitForTimeout(600);
  if (await p.locator('[data-start-bar] a').count()) await p.locator('[data-start-bar] a').click({ timeout: 3000 }).catch(() => {});
  await p.waitForURL('**/find/**', { timeout: 5000 }).catch(() => {});
  ok('the bar leads where the sun does', p.url().includes('/find'), p.url());
  await ctx.close();
}
{
  const { ctx, p } = await open('/');
  await p.waitForTimeout(500);
  const b = await bar(p);
  ok('a phone, where the sun is in the first screen, never sees the bar', !b.missing && !b.shown && b.inert, JSON.stringify(b));
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : '\nكل شي تمام');
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
