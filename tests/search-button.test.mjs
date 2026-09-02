import { chromium } from 'playwright';

/**
 * The search button, and the palette behind it.
 *
 * The journey suite already walks the happy path — tap the navbar button, type,
 * open a result. What nothing covered is everything the component promises
 * around that: a keyboard shortcut it documents in its own header, focus that
 * has to land in the box and come back to the button, arrow keys and Enter,
 * and the code-splitting the file exists for.
 *
 * That last one is the reason SearchPalette and SearchPaletteDialog are two
 * files at all: the navbar is in the root layout, so before the split every
 * page paid for the search engine, the whole catalogue and every place's
 * artwork. «Reading the privacy policy should not cost the same JavaScript as
 * searching.» Nothing checked that it stayed true, and a stray static import
 * would undo it silently — the button would still work, which is exactly why
 * nobody would notice.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); }
};

const BOX = 'input[aria-label="ابحث في وين"]';
const BUTTON = 'button[aria-label*="بحث"]';

async function open({ touch = false } = {}) {
  const ctx = await browser.newContext(
    touch
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW' }
      : { viewport: { width: 1200, height: 900 }, locale: 'ar-KW' }
  );
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  return { ctx, p, errors };
}

console.log('\n── the button is reachable, and says what it is ──');
{
  const { ctx, p } = await open({ touch: true });
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  const btn = p.locator(BUTTON).first();
  ok('the search button is on the page', (await btn.count()) > 0);
  // On a phone the label is `hidden sm:inline`, so the button is icon-only and
  // the aria-label is the ONLY name a screen reader gets.
  const name = await btn.getAttribute('aria-label');
  ok('it carries an accessible name even with the text hidden', (name || '').includes('بحث'), name);
  const box = await btn.boundingBox();
  ok(`it clears 44px in both axes on a phone (${Math.round(box.width)}×${Math.round(box.height)})`,
    box.width >= 44 && box.height >= 44);
  await ctx.close();
}

console.log('\n── the dialog is not paid for until it is opened ──');
{
  const { ctx, p } = await open();
  const chunks = [];
  p.on('response', (r) => { if (/\.js(\?|$)/.test(r.url())) chunks.push(r.url().split('/').pop()); });
  await p.goto(B + '/privacy/', { waitUntil: 'networkidle' });
  const before = chunks.length;
  /**
   * Read the JavaScript, not the rendered HTML.
   *
   * The first version of this asked whether the page's innerHTML mentioned a
   * place, and it PASSED with the dynamic import replaced by a static one —
   * the privacy page never renders a place name either way, so the assertion
   * was true for a reason that had nothing to do with what it claimed. The
   * catalogue travels in a chunk; that is where it has to be looked for.
   */
  const early = await p.evaluate(async () => {
    const srcs = [...document.querySelectorAll('script[src]')].map((s) => s.src);
    const bodies = await Promise.all(srcs.map((u) => fetch(u).then((r) => r.text()).catch(() => '')));
    return bodies.some((b) => b.includes('مقاهي المباركية'));
  });
  ok('the privacy page does not ship the catalogue in its JavaScript', !early);

  await p.locator(BUTTON).first().click();
  await p.locator(BOX).waitFor({ state: 'visible', timeout: 15000 });
  ok('opening the palette fetched more JavaScript than the page needed',
    chunks.length > before, `${before} → ${chunks.length}`);
  ok('and the palette works on a page that is not the home page',
    await p.locator(BOX).isVisible());
  await ctx.close();
}

console.log('\n── the keyboard shortcut its own header documents ──');
{
  const { ctx, p } = await open();
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await p.keyboard.press('Control+k');
  await p.locator(BOX).waitFor({ state: 'visible', timeout: 15000 });
  ok('Ctrl+K opens it', await p.locator(BOX).isVisible());
  ok('without navigating', p.url().endsWith('/'), p.url());

  // The handler is a toggle, and a toggle that only opens is half a feature.
  await p.keyboard.press('Control+k');
  await p.waitForTimeout(250);
  ok('and Ctrl+K again closes it', (await p.locator(BOX).count()) === 0);
  await ctx.close();
}

console.log('\n── focus goes where the hands are ──');
{
  const { ctx, p } = await open();
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await p.locator(BUTTON).first().click();
  await p.locator(BOX).waitFor({ state: 'visible', timeout: 15000 });
  // Opening a search box and leaving the caret elsewhere means the first thing
  // typed goes nowhere, which is the whole cost of getting this wrong.
  ok('the box takes focus on open',
    await p.evaluate((s) => document.activeElement === document.querySelector(s), BOX));

  await p.keyboard.type('قهوة');
  await p.waitForTimeout(400);
  ok('typing lands in the box', (await p.locator(BOX).inputValue()) === 'قهوة');
  await ctx.close();
}

console.log('\n── Escape closes it, and the backdrop does too ──');
{
  const { ctx, p } = await open();
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await p.locator(BUTTON).first().click();
  await p.locator(BOX).waitFor({ state: 'visible', timeout: 15000 });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  ok('Escape closes it', (await p.locator(BOX).count()) === 0);
  ok('and does not navigate away', p.url().endsWith('/'), p.url());

  await p.locator(BUTTON).first().click();
  await p.locator(BOX).waitFor({ state: 'visible', timeout: 15000 });
  await p.locator('button[aria-label="إغلاق البحث"]').click();
  await p.waitForTimeout(250);
  ok('so does tapping the backdrop', (await p.locator(BOX).count()) === 0);
  await ctx.close();
}

console.log('\n── the arrow keys and Enter, which are the only way in from a keyboard ──');
{
  const { ctx, p } = await open();
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await p.locator(BUTTON).first().click();
  await p.locator(BOX).waitFor({ state: 'visible', timeout: 15000 });
  await p.locator(BOX).fill('قهوة');
  await p.waitForTimeout(500);

  const rows = p.locator('#wain-search-results a, [role="dialog"] a[href^="/"]');
  const n = await rows.count();
  ok('the palette lists results', n > 0, `${n}`);

  // Enter with nothing arrowed to opens the first hit; that is the case a
  // visitor actually hits, because they type and press Enter.
  await p.keyboard.press('Enter');
  await p.waitForURL(/\/(places|search|explore)/, { timeout: 15000 });
  ok('Enter opens a result rather than doing nothing', /\/(places|search|explore)/.test(p.url()), p.url());
  await ctx.close();
}

console.log('\n── ArrowDown moves the selection before Enter takes it ──');
{
  const { ctx, p } = await open();
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await p.locator(BUTTON).first().click();
  await p.locator(BOX).waitFor({ state: 'visible', timeout: 15000 });
  await p.locator(BOX).fill('قهوة');
  await p.waitForTimeout(500);

  const first = await p.evaluate(() => {
    const a = document.querySelector('[role="dialog"] a[href^="/"]');
    return a ? a.getAttribute('href') : null;
  });
  await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(200);
  await p.keyboard.press('Enter');
  await p.waitForURL(/\/(places|search|explore)/, { timeout: 15000 });
  ok('arrowing down and pressing Enter opens a DIFFERENT result than the first',
    first && !p.url().includes(first.replace(/\/$/, '')), `first=${first} landed=${p.url()}`);
  await ctx.close();
}

console.log('\n── a query with no answer says so, and still offers a way on ──');
{
  const { ctx, p, errors } = await open();
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await p.locator(BUTTON).first().click();
  await p.locator(BOX).waitFor({ state: 'visible', timeout: 15000 });
  await p.locator(BOX).fill('زززززز');
  await p.waitForTimeout(500);
  const text = await p.locator('[role="dialog"]').textContent();
  ok('it admits there is nothing', text.includes('ما لقينا'), text.slice(0, 120));
  ok('no page errors anywhere in the palette', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
