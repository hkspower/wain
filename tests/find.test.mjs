import { chromium } from 'playwright';

/**
 * The dial, then the choice it now leads to.
 *
 * The dial used to open its own panel — the five nearest places, ranked live
 * against a GPS fix. That panel is gone; the dial is a plain link to /find
 * now, and /find is where the real choice is: call شوق, or type to her. The
 * call half has to be proved doing a real call rather than assumed, because
 * the first draft nested the real ShouqCallButton inside a second, outer
 * <button> whose own onClick did the navigation — which silently made the
 * OUTER button the only thing that ever fired. Tapping it moved to /search
 * having placed no call at all. `wain-ai:call` firing is the proof that
 * would have caught it; a navigation to /search alone would not have,
 * because the outer button produced that too.
 *
 * The typing half's identity has moved three times, and this file has
 * asserted a different one of them each time — read `SALEM_VOICE_ID`'s own
 * comment in `lib/wain-ai.ts` for the full account before changing this
 * again. It shipped as سالم's, was corrected to شوق's, and was reversed
 * again on request, 30 September, back to his — his own regenerated photo,
 * his own pill and greeting, his own voice on the wire. What is real and
 * asserted below: the call half is شوق's, the typing half is سالم's, and the
 * real ShouqCallButton actually places a call rather than only navigating.
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

console.log('\n── the dial no longer opens its own panel ──');
{
  const { ctx, p, errors } = await fresh('/');
  const dial = p.locator('a[href="/find/"]');
  ok('the dial is a link to /find', await dial.isVisible());
  ok('it no longer promises a distance figure', !(await p.locator('text=كم حواليك').count()));
  await dial.click();
  await p.waitForURL('**/find/**');
  ok('tapping it lands on /find', p.url().includes('/find'));
  ok('no page errors on the way', errors.length === 0);
  await ctx.close();
}

console.log('\n── /find offers exactly the two, equally ──');
{
  const { ctx, p, errors } = await fresh('/find/');
  // The real ShouqCallButton — its accessible name names شوق, which a
  // bespoke look-alike button would have no reason to get right.
  const shouqButton = p.getByRole('button', { name: /شوق/ });
  const typeLink = p.getByRole('link', { name: /ابدأ الكتابة/ });
  ok('كلّم شوق is offered, as the real call button', await shouqButton.isVisible());
  ok('typing to him is offered too', await typeLink.isVisible());
  ok('the call half is شوق\'s — the typing half\'s سالم text sits below it', await p.locator('section[aria-label="اتصال"]', { hasText: 'سالم' }).count() === 0);
  ok('and the typing half names سالم', await p.locator('section[aria-label="اكتب"]', { hasText: 'سالم' }).isVisible());
  const box = await shouqButton.boundingBox();
  // size="lg" (size-20, 80px) against the sm default (size-8, 32px) — this
  // is the one thing a screenshot proves and an accessible-name check does
  // not: that the prop actually reached the rendered button.
  ok('the button is the "lg" size, not the inline default', box.width >= 70);
  ok('no page errors', errors.length === 0);
  await ctx.close();
}

console.log('\n── the typing option leads to سالم\'s chat page ──');
{
  const { ctx, p } = await fresh('/find/');
  await p.getByRole('link', { name: /ابدأ الكتابة/ }).click();
  await p.waitForURL('**/salem/**');
  ok('landed on /salem', p.url().includes('/salem'));
  await ctx.close();
}

console.log('\n── كلّم شوق places a call, not just a navigation ──');
{
  const { ctx, p } = await fresh('/find/');
  const calledEvents = await p.evaluate(() => {
    window.__calls = 0;
    window.addEventListener('wain-ai:call', () => { window.__calls++; });
    return true;
  });
  ok('the listener attached', calledEvents === true);
  await p.getByRole('button', { name: /شوق/ }).click();
  await p.waitForURL('**/search/**', { timeout: 8000 });
  const calls = await p.evaluate(() => window.__calls);
  ok('the tap requested a real call (wain-ai:call fired)', calls === 1);
  ok('and it also landed on /search, where the answer appears', p.url().includes('/search'));
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : '\nكل شي تمام');
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
