import { chromium } from 'playwright';

/**
 * دوري, driven in a browser, against a build with no database.
 *
 * That is the case worth testing hardest: with nothing to ask, the screen must
 * still show the number the device is holding and admit it cannot confirm the
 * position, rather than inventing one. A queue screen that guesses is worse
 * than one that says it does not know — somebody misses their turn on it.
 */

const B = process.env.WAIN_URL || 'http://localhost:4192';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar-KW' });
await ctx.addInitScript(() => { navigator.vibrate = () => true; });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));

/** Kuwait is UTC+3 with no daylight saving, so this matches kuwaitToday(). */
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const yesterday = new Date(Date.now() + 3 * 3600_000 - 86400_000).toISOString().slice(0, 10);

const TICKET = {
  id: '9f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  token: 'b1c2d3e4f5a60718293a4b5c6d7e8f90',
  number: 7,
  placeSlug: 'kuwait-towers',
  placeNameAr: 'أبراج الكويت',
  salonKind: 'men',
  day: today,
  joinedAt: new Date().toISOString(),
};

console.log('\n── with no turn taken ──');
await p.goto(B + '/queue/', { waitUntil: 'networkidle' });
await p.waitForTimeout(300);
let body = await p.textContent('body');
ok('the page exists and is titled دوري', body.includes('دوري'));
ok('an empty device is told so', body.includes('ما عندك دور اليوم'));
ok('and pointed somewhere useful', (await p.locator('a[href="/explore/"], a[href="/explore"]').count()) > 0);
ok('no queue link in the header with nothing to track',
  (await p.locator('header a[href*="/queue"]').count()) === 0);

console.log('\n── holding a number ──');
await ctx.addInitScript((t) => localStorage.setItem('wain:queue', JSON.stringify([t])), TICKET);
await p.goto(B + '/queue/', { waitUntil: 'networkidle' });
await p.waitForTimeout(500);
body = await p.textContent('body');
ok('the number is shown in Arabic-Indic digits', body.includes('٧'), body.slice(0, 300));
ok('the salon is named', body.includes('أبراج الكويت'));
ok('the kind is stated, so nobody joins the wrong one', body.includes('رجالي'));
ok('an unreachable queue is admitted, not guessed', body.includes('ما قدرنا نتأكد من الطابور'));
// Scoped to the card, not the page: the meta description legitimately contains
// «كم واحد قدامك» as a description of the feature, and matching against the
// whole body caught that instead of what is on screen.
const card = await p.locator('li:has-text("أبراج الكويت")').first().textContent();
ok('the card does not claim a position it could not read', !card.includes('قدامك'), card);
ok('it says it is still looking instead', card.includes('نشوف وين وصل الطابور'), card);
ok('and it says the number is only for today', body.includes('الأرقام تبدأ من جديد كل يوم'));

console.log('\n── the number is the biggest thing on the screen ──');
// Somebody glances at this across a salon; if the number is not the largest
// text on the card, the screen has failed at its one job.
const numberSize = await p.evaluate(() => {
  const els = [...document.querySelectorAll('p, span, strong')];
  const target = els.find((e) => e.textContent.trim() === '٧');
  if (!target) return null;
  const mine = parseFloat(getComputedStyle(target).fontSize);
  const biggest = Math.max(...els
    .filter((e) => e.textContent.trim().length > 0 && e.children.length === 0)
    .map((e) => parseFloat(getComputedStyle(e).fontSize)));
  return { mine, biggest };
});
ok('the ticket number is the largest text on the page',
  numberSize && numberSize.mine >= numberSize.biggest, JSON.stringify(numberSize));

console.log('\n── leaving is offered while it is still true ──');
ok('a waiting turn can be given up', (await p.locator('button:has-text("ألغِ دوري")').count()) === 1);
ok('and there is somewhere to go', (await p.locator('a[href*="google.com/maps/dir"]').count()) >= 1);

console.log('\n── the way back appears once there is a turn ──');
await p.goto(B + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(400);
const link = p.locator('header a[href*="/queue"]');
ok('the header links to دوري', (await link.count()) === 1);
ok('with the count in Arabic digits', (await link.first().textContent()).includes('١'));

console.log('\n── yesterday\'s number is not today\'s ──');
// The salon restarted at one this morning. Showing a stale number on a screen
// whose whole job is to show the right one would be worse than showing none.
const ctx2 = await browser.newContext({ locale: 'ar-KW' });
await ctx2.addInitScript((t) => localStorage.setItem('wain:queue', JSON.stringify([t])),
  { ...TICKET, day: yesterday });
const p2 = await ctx2.newPage();
const errors2 = [];
p2.on('pageerror', (e) => errors2.push(e.message));
await p2.goto(B + '/queue/', { waitUntil: 'networkidle' });
await p2.waitForTimeout(400);
const stale = await p2.textContent('body');
ok('a ticket from yesterday is not shown', !stale.includes('أبراج الكويت'), stale.slice(0, 300));
ok('the empty state takes its place', stale.includes('ما عندك دور اليوم'));
await p2.goto(B + '/', { waitUntil: 'networkidle' });
await p2.waitForTimeout(300);
ok('and it does not put a link in the header either',
  (await p2.locator('header a[href*="/queue"]').count()) === 0);
await ctx2.close();

console.log('\n── a corrupted store does not break the page ──');
const ctx3 = await browser.newContext({ locale: 'ar-KW' });
await ctx3.addInitScript(() => localStorage.setItem('wain:queue', 'not json at all'));
const p3 = await ctx3.newPage();
const errors3 = [];
p3.on('pageerror', (e) => errors3.push(e.message));
await p3.goto(B + '/queue/', { waitUntil: 'networkidle' });
await p3.waitForTimeout(300);
ok('it falls back to the empty state', (await p3.textContent('body')).includes('ما عندك دور اليوم'));
ok('without throwing', errors3.length === 0, errors3.join(' | '));
await ctx3.close();

ok('no page errors throughout', errors.length === 0 && errors2.length === 0,
  [...errors, ...errors2].join(' | '));

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
