import { chromium } from 'playwright';

/**
 * The dial, then the choice it now leads to.
 *
 * The dial used to open its own panel — the five nearest places, ranked live
 * against a GPS fix. That panel is gone; the dial is a plain link to /find
 * now, and /find is where the real choice is: type, or call شوق. Both of
 * those have to be proved here rather than assumed, because the first draft
 * of the شوق option nested the real ShouqCallButton inside a second, outer
 * <button> whose own onClick did the navigation — which silently made the
 * OUTER button the only thing that ever fired. Tapping it moved to /search
 * having placed no call at all. `wain-ai:call` firing is the proof that
 * would have caught it; a navigation to /search alone would not have,
 * because the outer button produced that too.
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

console.log('\n── /find offers exactly the two ──');
{
  const { ctx, p, errors } = await fresh('/find/');
  // A real input, not a link — the box is functional now, not a shortcut
  // past the choice.
  const typeInput = p.locator('#find-q');
  // The real ShouqCallButton — its accessible name names شوق, which a
  // bespoke look-alike button would have no reason to get right.
  const shouqButton = p.getByRole('button', { name: /شوق/ });
  ok('typing is offered, as a real search box', await typeInput.isVisible());
  ok('كلّم شوق is offered, as the real call button', await shouqButton.isVisible());
  ok('nothing here names سالم — not a top-level choice', !(await p.locator('text=سالم').count()));
  const box = await shouqButton.boundingBox();
  // size="lg" (size-20, 80px) against the sm default (size-8, 32px) — this
  // is the one thing a screenshot proves and an accessible-name check does
  // not: that the prop actually reached the rendered button.
  ok('the button is the "lg" size, not the inline default', box.width >= 70);
  ok('no page errors', errors.length === 0);
  await ctx.close();
}

console.log('\n── اكتب is a real box: it carries what you typed ──');
{
  const { ctx, p } = await fresh('/find/');
  await p.locator('#find-q').fill('قهوة');
  await p.getByRole('button', { name: 'ابحث' }).click();
  await p.waitForURL('**/search/**');
  ok('landed on /search with the query', p.url().includes('q=%D9%82%D9%87%D9%88%D8%A9'));
  await ctx.close();
}

console.log('\n── an empty box still goes to /search ──');
{
  const { ctx, p } = await fresh('/find/');
  await p.getByRole('button', { name: 'ابحث' }).click();
  await p.waitForURL('**/search/**');
  ok('landed on /search, no dangling ?q=', !p.url().includes('q='));
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
