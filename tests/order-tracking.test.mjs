import { chromium } from 'playwright';

/**
 * طلباتي, driven in a browser.
 *
 * The tracker's live status comes from the order_status() RPC, which needs a
 * configured Supabase — a static build has none, so fetchOrderState() returns
 * null here. That is exactly the case worth testing hardest: with the network
 * silent the screen must still show the customer their reference, their place
 * and their time from what the device remembers, and must say plainly that it
 * could not confirm the status rather than inventing one.
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

const SEED = [
  {
    id: '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    reference: '3F2B1C',
    placeSlug: 'kuwait-towers',
    placeNameAr: 'أبراج الكويت',
    totalFils: 2750,
    pickupAt: '18:30',
    placedAt: new Date(Date.now() - 12 * 60000).toISOString(),
  },
];

console.log('\n── with nothing ordered ──');
await p.goto(B + '/orders/', { waitUntil: 'networkidle' });
await p.waitForTimeout(300);
let body = await p.textContent('body');
ok('the page exists and is titled طلباتي', body.includes('طلباتي'));
ok('an empty device is told so, not shown a spinner forever', body.includes('ما عندك طلبات'));
ok('it offers a way to start', (await p.locator('a[href="/explore/"], a[href="/explore"]').count()) > 0);
ok('the footer link is absent when there is nothing to track',
  (await p.locator('footer a[href*="/orders"]').count()) === 0);

console.log('\n── with one order on the device ──');
await ctx.addInitScript((seed) => {
  localStorage.setItem('wain:orders', JSON.stringify(seed));
}, SEED);
await p.goto(B + '/orders/', { waitUntil: 'networkidle' });
await p.waitForTimeout(600);
body = await p.textContent('body');
ok('the reference is shown', body.includes('3F2B1C'));
ok('the place is named', body.includes('أبراج الكويت'));
ok('the total is the remembered one, in dinars', body.includes('٢٫٧٥٠ د.ك'), body.slice(0, 400));
ok('the collection time is Arabic-digit 12-hour', body.includes('٦:٣٠ م'), body.slice(0, 400));
ok('the three steps are named', body.includes('وصل الطلب') && body.includes('جاهز للاستلام') && body.includes('تسلّمته'));
ok('it defaults to «بانتظار التجهيز», not to ready', body.includes('بانتظار التجهيز') && !body.includes('طلبك جاهز'));
ok('an unreachable status is admitted, not guessed', body.includes('ما قدرنا نتأكد من الحالة'));
ok('the place name links to the place', (await p.locator('a[href="/places/kuwait-towers/"]').count()) > 0);

console.log('\n── it says where to collect from ──');
// Collecting in person is the one kind of order that needs directions and a
// phone number, and the card carried neither.
const directions = p.locator('a[href*="google.com/maps/dir"]');
ok('there is a link to the directions', (await directions.count()) >= 1);
ok('pointed at the place, not a search box',
  (await directions.first().getAttribute('href')).includes('destination='),
  await directions.first().getAttribute('href'));
ok('and a way back to the place page', (await p.locator('a[href="/places/kuwait-towers/"]').count()) >= 1);

console.log('\n── cancelling is offered only while it is true ──');
// With no database the status cannot be read, so the card shows its remembered
// state: placed. That is exactly when cancelling should be on offer.
ok('a placed order offers a cancel', (await p.locator('button:has-text("ألغِ الطلب")').count()) === 1);
ok('and it is not presented as deleting the record',
  (await p.locator('button:has-text("احذفه من القائمة")').count()) === 1);

console.log('\n── it still never claims payment ──');
ok('the word «مدفوع» appears nowhere', !body.includes('مدفوع'));
ok('it repeats that payment is on collection', body.includes('الدفع عند الاستلام'));

console.log('\n── the way back exists once there is an order ──');
await p.goto(B + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(400);
const footerLink = p.locator('footer a[href*="/orders"]');
ok('the footer now links to طلباتي', (await footerLink.count()) === 1);
ok('and carries the count in Arabic digits', (await footerLink.first().textContent()).includes('١'));

console.log('\n── forgetting an order ──');
await p.goto(B + '/orders/', { waitUntil: 'networkidle' });
await p.waitForTimeout(500);
await p.locator('button:has-text("احذفه من القائمة")').first().click();
await p.waitForTimeout(300);
body = await p.textContent('body');
ok('the card is gone', !body.includes('3F2B1C'));
ok('the empty state takes its place', body.includes('ما عندك طلبات'));
const left = await p.evaluate(() => localStorage.getItem('wain:orders'));
ok('and the device really forgot it', JSON.parse(left).length === 0, left);

console.log('\n── a corrupted store does not break the page ──');
const ctx2 = await browser.newContext({ locale: 'ar-KW' });
await ctx2.addInitScript(() => localStorage.setItem('wain:orders', '{not json'));
const p2 = await ctx2.newPage();
const errors2 = [];
p2.on('pageerror', (e) => errors2.push(e.message));
await p2.goto(B + '/orders/', { waitUntil: 'networkidle' });
await p2.waitForTimeout(300);
ok('it falls back to the empty state', (await p2.textContent('body')).includes('ما عندك طلبات'));
ok('without throwing', errors2.length === 0, errors2.join(' | '));
await ctx2.close();

ok('no page errors throughout', errors.length === 0, errors.join(' | '));

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
