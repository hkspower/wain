import { chromium } from 'playwright';

/**
 * The search button, on every route that needs one.
 *
 * A suite of this name existed before and was deleted with the navbar. This
 * one asks a different question, and it is the question that shipped broken
 * twice: **can a thumb reach search from where it is standing.** Measured on
 * the build before this button existed, `a[href="/search/"]:visible` was 1 on
 * `/` and **0 on /explore, 0 on a place page and 0 on /about** — one link in
 * the DOM everywhere, and it was AppTabBar's tab, which is `standalone:block`
 * and painted by nothing in a browser.
 *
 * So every assertion here is `:visible`. A count is not reachability; that
 * mistake is the whole reason this file is back.
 */

const B = process.env.WAIN_URL || 'http://localhost:4192';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

/** The map frame and the font CDN are not reachable from CI, and nothing here
 *  depends on them; without this `networkidle` waits for their own timeouts. */
const offline = (ctx) =>
  ctx.route('**', (route) => (route.request().url().startsWith(B) ? route.continue() : route.abort()));

const SEED = [{
  id: '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  reference: '3F2B1C',
  placeSlug: 'kuwait-towers',
  placeNameAr: 'أبراج الكويت',
  totalFils: 2750,
  pickupAt: '18:30',
  placedAt: new Date().toISOString(),
}];

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar-KW' });
await ctx.addInitScript(() => { navigator.vibrate = () => true; });
await offline(ctx);
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));

const visit = async (page, route) => {
  await page.goto(B + route, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
};
/** Every link to /search a thumb could actually hit on this screen. */
const reachable = (page) => page.locator('a[href="/search/"]:visible');

console.log('\n── every interior route offers a way to search ──');
// These four are the ones measured at 0 before the button existed: the deepest
// route on the site, the list, and two static pages nobody would think to
// check. A place page is the one that matters most — it is where a link from
// WhatsApp lands, so for most first-time visitors it is the whole site.
for (const route of ['/places/kuwait-towers/', '/explore/', '/about/', '/privacy/']) {
  await visit(p, route);
  ok(`${route} offers one`, (await reachable(p).count()) === 1, `${await reachable(p).count()} visible`);
}

console.log('\n── and it is one offer, not two ──');
await visit(p, '/');
// The home page has its own link under the dial, so the button stands down
// there; if it did not, the page would ask the same question twice.
ok('the home page still offers exactly one', (await reachable(p).count()) === 1);
ok('and it is the link under the dial, not the button',
  (await p.locator('a[href="/search/"]:visible').first().textContent()).includes('دوّر'));
await visit(p, '/search/');
ok('/search does not offer a way to itself', (await reachable(p).count()) === 0);

console.log('\n── it is big enough to hit ──');
await visit(p, '/places/kuwait-towers/');
const btn = await reachable(p).first().boundingBox();
// 24px is MIN_TARGET_PX in scripts/audit-mobile.mjs — WCAG 2.5.8 AA. Asserted
// here as well as there because a threshold hardcoded in two places is exactly
// the drift `npm run scan` cannot see: the last time this suite carried a
// number of its own it kept 44 after the floor moved, and went red for being
// stale rather than for a regression.
ok('it clears the 24px target floor', btn.width >= 24 && btn.height >= 24, JSON.stringify(btn));

console.log('\n── it goes where it says ──');
await reachable(p).first().click();
await p.waitForTimeout(800);
ok('tapping it lands on /search', p.url().includes('/search'), p.url());
ok('and the search box is there and interactive',
  await p.locator('input[aria-label="ابحث في كل محتوى وين"]').isVisible());

console.log('\n── it shares the rail with a live order instead of fighting it ──');
// Two separately-positioned floating controls measured 10px apart at 320px,
// which is inside the 24px clearance audit:mobile requires between targets.
// They are one flex row now, so this asks the row to prove it at the width
// where it was closest.
for (const width of [320, 390]) {
  const c = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, locale: 'ar-KW' });
  await c.addInitScript(() => { navigator.vibrate = () => true; });
  await c.addInitScript((s) => localStorage.setItem('wain:orders', JSON.stringify(s)), SEED);
  await offline(c);
  const q = await c.newPage();
  await visit(q, '/places/kuwait-towers/');
  const search = await reachable(q).first().boundingBox();
  const tray = await q.locator('nav[aria-label="طلباتك الحالية"]').first().boundingBox();
  ok(`${width}px: both are on screen at once`, !!search && !!tray,
    JSON.stringify({ search, tray }));
  const gap = search && tray
    ? Math.max(search.x, tray.x) - Math.min(search.x + search.width, tray.x + tray.width)
    : -1;
  ok(`${width}px: and they clear each other by 24px`, gap >= 24, `gap=${Math.round(gap)}`);
  await c.close();
}

console.log('\n── the installed app is not given the same offer twice ──');
// AppTabBar already carries a search tab, so the rail stands down there. The
// data attribute is the signal AppShell sets; the media query cannot be forced.
const appCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW' });
await appCtx.addInitScript(() => {
  document.documentElement.dataset.standalone = 'true';
});
await offline(appCtx);
const app = await appCtx.newPage();
await visit(app, '/places/kuwait-towers/');
await app.evaluate(() => { document.documentElement.dataset.standalone = 'true'; });
await app.waitForTimeout(200);
const tab = app.locator('nav[aria-label="تنقّل التطبيق"] a[href="/search/"]:visible');
ok('the app gets its tab', (await tab.count()) === 1);
ok('and not the rail button too', (await reachable(app).count()) === 1,
  `${await reachable(app).count()} visible`);
await appCtx.close();

ok('no page errors throughout', errors.length === 0, errors.join(' | '));

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
