import { chromium } from 'playwright';

/**
 * طلباتي, driven in a browser.
 *
 * The tracker's live status comes from the `order_status` action, which needs
 * `/api/wain.php` answering — a static build served alone has none, so fetchOrderState() returns
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
// The tray, not a `<header>` — the site has no header any more, so the old
// selector returned 0 whatever the code did and the assertion could not fail.
ok('no tray at all when there is nothing to track',
  (await p.locator('nav[aria-label="طلباتك الحالية"]').count()) === 0);

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
// `:visible`, not a count. This assertion was `header a[href*="/orders"]`
// against the navbar pill; when the navbar went, the only link left was
// AppTabBar's, which is `standalone:block` — in the DOM and painted by
// nothing in a browser. A count cannot tell those apart, and that is exactly
// how the same class of break shipped for /search. LiveTray is the browser's
// route now, and it must be a link a thumb can actually reach.
await p.goto(B + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(400);
const tray = p.locator('nav[aria-label="طلباتك الحالية"] a[href*="/orders"]:visible');
ok('a browser gets a visible way back to طلباتي', (await tray.count()) === 1);
ok('and it carries the count in Arabic digits', (await tray.first().textContent()).includes('١'));
// The installed app grows its own tab for this, so the tray must stand down
// there or the same offer is drawn twice.
ok('the app tab bar still offers it too',
  (await p.locator('nav[aria-label="تنقّل التطبيق"] a[href*="/orders"]').count()) === 1);

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

console.log('\n── an order that went by WhatsApp, beside one that went to the database ──');
// A legacy entry (no `channel`, written before WhatsApp mode existed) and a
// WhatsApp one on the same device. The first is a database order and keeps
// its steps; the second has no status anything here can read, and must say
// so instead of drawing «بانتظار التجهيز» over a message the shop may have
// answered an hour ago.
const WA = {
  id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  token: 'f1e2d3c4b5a60718293a4b5c6d7e8f90',
  reference: '9A8B7C',
  placeSlug: 'mubarakiya-tea-houses',
  placeNameAr: 'مقاهي المباركية',
  totalFils: 1000,
  pickupAt: '09:30',
  placedAt: new Date(Date.now() - 5 * 60000).toISOString(),
  channel: 'whatsapp',
  whatsapp: '51234567',
  lines: [
    { id: 'm1', nameAr: 'چاي كرك', priceFils: 250, qty: 2 },
    { id: 'm2', nameAr: 'قهوة عربية', priceFils: 500, qty: 1 },
  ],
  noteAr: 'بدون سكر',
};
const ctx3 = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, locale: 'ar-KW' });
await ctx3.addInitScript((seed) => {
  navigator.vibrate = () => true;
  window.confirm = () => true;
  localStorage.setItem('wain:orders', JSON.stringify(seed));
}, [WA, ...SEED]);
const p3 = await ctx3.newPage();
const errors3 = [];
p3.on('pageerror', (e) => errors3.push(e.message));
// The cancel control is a real link to wa.me; answer it locally so a tap
// opens nothing on the network.
await ctx3.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '' }));
await p3.goto(B + '/orders/', { waitUntil: 'networkidle' });
await p3.waitForTimeout(600);
const wa = p3.locator('li[data-order-card="whatsapp"]');
const db = p3.locator('li[data-order-card="db"]');
ok('both cards are drawn, each by its channel', (await wa.count()) === 1 && (await db.count()) === 1);
const waText = (await wa.textContent().catch(() => '')) || '';
const dbText = (await db.textContent().catch(() => '')) || '';
ok('the legacy entry is still a database order with its steps', dbText.includes('وصل الطلب') && dbText.includes('بانتظار التجهيز'));
ok('the WhatsApp card says it went by WhatsApp', waText.includes('أرسلته عبر واتساب'));
ok('…and draws no steps', !waText.includes('وصل الطلب') && !waText.includes('بانتظار التجهيز'));
ok('…and says the status is not shown here, rather than «could not confirm»',
  waText.includes('الحالة ما تنعرض هني') && !waText.includes('ما قدرنا نتأكد'));
ok('…shows the remembered lines', waText.includes('چاي كرك') && waText.includes('×٢') && waText.includes('١٫٠٠٠ د.ك'));
ok('…and the note', waText.includes('ملاحظتك: بدون سكر'));
ok('…and the time', waText.includes('٩:٣٠ ص'));
ok('«افتح المحادثة» opens the thread with the shop',
  (await wa.locator('a[href="https://wa.me/96551234567"]').count()) === 1);
const cancelLink = wa.locator('a:has-text("ألغِ عبر واتساب")');
ok('cancelling is a link into the same thread', (await cancelLink.count()) === 1);
const cancelHref = (await cancelLink.getAttribute('href').catch(() => null)) || '';
const cancelText = decodeURIComponent(cancelHref.slice(cancelHref.indexOf('?text=') + 6));
ok('…to the shop\'s number', cancelHref.startsWith('https://wa.me/96551234567?text='), cancelHref.slice(0, 40));
ok('…carrying the cancel sentence with the reference', cancelText.includes('ألغي الطلب رقم 9A8B7C'), cancelText);
ok('it never claims payment either', !waText.includes('مدفوع') && waText.includes('الدفع عند الاستلام'));

const popup = ctx3.waitForEvent('page', { timeout: 3000 }).catch(() => null);
await cancelLink.click();
const opened = await popup;
await p3.waitForTimeout(400);
const afterText = (await wa.textContent().catch(() => '')) || '';
ok('tapping it marks the order as cancelled by the customer', afterText.includes('طلبت الإلغاء عبر واتساب'), afterText.slice(0, 200));
ok('…in the words of a request, not a fact the shop confirmed', afterText.includes('طلبت إلغاءه') && !afterText.includes('المكان ألغى'));
ok('…and the cancel link is gone', (await cancelLink.count()) === 0);
ok('…while the thread link stays', (await wa.locator('a[href="https://wa.me/96551234567"]').count()) === 1);
const stored3 = JSON.parse((await p3.evaluate(() => localStorage.getItem('wain:orders'))) || '[]');
const waStored = stored3.find((o) => o.id === WA.id) || {};
ok('the device remembers it was cancelled from here', waStored.cancelledByMe === true && typeof waStored.cancelledAt === 'string');
ok('the database order beside it is untouched', !(stored3.find((o) => o.id === SEED[0].id) || {}).cancelledByMe);
if (opened) await opened.close().catch(() => {});
ok('no page errors on the mixed list', errors3.length === 0, errors3.join(' | '));
await wa.screenshot({ path: `${process.env.WAIN_SHOTS || '.'}/orders-whatsapp.png` }).catch(() => {});
await ctx3.close();

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
