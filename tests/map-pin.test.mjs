import { chromium } from 'playwright';

/**
 * The pins, on a phone and on a desktop.
 *
 * They used to answer only to `mouseenter`, which meant a place's name was
 * readable on a desktop and nowhere else: on a phone the tap fired the link
 * immediately, so the label the map is built around had no moment in which it
 * could ever be seen. "The map and the list stay in step" was true of mice
 * only, on a site whose traffic is almost entirely phones.
 *
 * These are the two behaviours that must not drift back together: one tap on a
 * touch device selects, and one click on a desktop still opens.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const SEARCH = '/search/?q=' + encodeURIComponent('قهوة');

async function open({ touch }) {
  const ctx = await browser.newContext(
    touch
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW' }
      : { viewport: { width: 1200, height: 900 }, locale: 'ar-KW' }
  );
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(B + SEARCH, { waitUntil: 'networkidle' });
  const map = p.locator('section[aria-labelledby="search-map-heading"]');
  await map.waitFor({ timeout: 8000 });
  return { ctx, p, map, errors };
}

console.log('\n── the map is there, with a pin per result ──');
{
  const { ctx, p, map, errors } = await open({ touch: false });
  const pins = map.locator('a[href^="/places/"]');
  const n = await pins.count();
  ok('pins are drawn', n > 0, `${n} pins`);
  ok('every pin names its place for a screen reader',
    (await pins.first().getAttribute('aria-label'))?.includes('—'),
    await pins.first().getAttribute('aria-label'));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  void p;
  await ctx.close();
}

console.log('\n── on a phone, the first tap selects instead of leaving ──');
{
  const { ctx, p, map } = await open({ touch: true });
  const pin = map.locator('a[href^="/places/"]').first();
  const href = await pin.getAttribute('href');
  await pin.click();
  await p.waitForTimeout(400);
  ok('it did not navigate away', p.url().includes('/search'), p.url());
  ok('the pin reports itself as the current one', (await pin.getAttribute('aria-current')) === 'true');
  // The callout is the entire reason the first tap is spent this way.
  const callout = map.locator('a[aria-current="true"]').locator('xpath=..');
  ok('the callout carries the name', (await callout.textContent()).trim().length > 0);

  console.log('\n── and the second tap opens it ──');
  await pin.click();
  await p.waitForURL('**' + href + '**', { timeout: 8000 });
  ok('the place page opens on the second tap', p.url().includes(href), p.url());
  await ctx.close();
}

console.log('\n── on a desktop, one click still opens ──');
{
  const { ctx, p, map } = await open({ touch: false });
  const pin = map.locator('a[href^="/places/"]').first();
  const href = await pin.getAttribute('href');
  await pin.click();
  await p.waitForURL('**' + href + '**', { timeout: 8000 });
  ok('no second click is asked for', p.url().includes(href), p.url());
  await ctx.close();
}

console.log('\n── hovering still selects, for the mouse ──');
{
  const { ctx, p, map } = await open({ touch: false });
  const pin = map.locator('a[href^="/places/"]').first();
  ok('nothing is selected to begin with', (await map.locator('[aria-current="true"]').count()) === 0);
  await pin.hover();
  await p.waitForTimeout(300);
  ok('hovering selects it', (await pin.getAttribute('aria-current')) === 'true');
  await ctx.close();
}

console.log('\n── the pins are not all the same colour any more ──');
{
  // A map of eight kinds of place used to be one near-black dot repeated. The
  // tint comes from the category, so a mixed result set has to show more than
  // one — and this check is worth having because a wrong Record key would fall
  // back to nothing and quietly return the whole map to one colour.
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'ar-KW' });
  const p = await ctx.newPage();
  await p.goto(B + '/search/?q=' + encodeURIComponent('الكويت'), { waitUntil: 'networkidle' });
  const map = p.locator('section[aria-labelledby="search-map-heading"]');
  await map.waitFor({ timeout: 8000 });
  const colours = await map.locator('a[href^="/places/"]').evaluateAll(
    (els) => [...new Set(els.map((e) => getComputedStyle(e).backgroundColor))]
  );
  ok('a mixed result set shows more than one pin colour', colours.length > 1, colours.join(' | '));
  ok('and none of them is transparent — every category has a tone',
    !colours.some((c) => /rgba\(0, 0, 0, 0\)/.test(c)), colours.join(' | '));
  await ctx.close();
}

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
