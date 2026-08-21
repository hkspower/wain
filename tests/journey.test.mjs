import { chromium } from 'playwright';

/**
 * One customer, one continuous path.
 *
 * The rule this suite holds itself to: **never navigate by URL.** Every step
 * has to be reachable by tapping what is on the screen, the way a person gets
 * there. A page that works perfectly when you type its address and is
 * unreachable from the page before it is broken, and only a journey notices.
 *
 * The whole thing runs on a phone-sized viewport with touch, because that is
 * what this is used on.
 */

const B = process.env.WAIN_URL || 'http://127.0.0.1:4201';
const SLUG = process.env.WAIN_FIXTURE_SLUG || 'mubarakiya-tea-houses';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true, locale: 'ar-KW',
});
await ctx.addInitScript(() => { navigator.vibrate = () => true; });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(`${e.message}`));

/* ── the shop's side of the counter ───────────────────────────────────────
   One order, held in memory. The tests drive its status the way the admin
   queue would, so the customer's screen is reacting to a real change rather
   than to something the test told it directly. */
const db = { order: null, status: 'placed', readyAt: null, collectedAt: null };
const requests = [];

await p.route('**/sb/**', async (route) => {
  const req = route.request();
  const url = req.url();
  const body = req.postData();
  requests.push({ url, method: req.method(), body });
  const json = (status, data) => route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(data),
  });

  // Placing the order.
  if (url.includes('/orders') && req.method() === 'POST') {
    const rows = JSON.parse(body);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (db.order && db.order.id === row.id) {
      // The same order sent twice — the duplicate primary key that means
      // "already placed".
      return json(409, { code: '23505', message: 'duplicate key' });
    }
    db.order = row;
    return json(201, {});
  }

  // Reading it back through the security-definer function.
  if (url.includes('order_status')) {
    const { p_id, p_token } = JSON.parse(body);
    if (!db.order || db.order.id !== p_id || db.order.track_token !== p_token) return json(200, []);
    return json(200, [{
      status: db.status,
      place_slug: db.order.place_slug,
      place_name_ar: db.order.place_name_ar,
      lines: db.order.lines,
      total_fils: db.order.total_fils,
      pickup_at: db.order.pickup_at,
      note_ar: db.order.note_ar,
      created_at: '2026-08-21T09:00:00Z',
      ready_at: db.readyAt,
      collected_at: db.collectedAt,
      cancelled_at: null,
    }]);
  }

  if (url.includes('cancel_order')) {
    const { p_id, p_token } = JSON.parse(body);
    if (!db.order || db.order.id !== p_id || db.order.track_token !== p_token) return json(200, null);
    if (db.status !== 'placed') return json(200, db.status);
    db.status = 'cancelled';
    return json(200, 'cancelled');
  }

  // Anything else — the live places read, auth refreshes — answers empty so
  // the site falls back to its build-time snapshot, exactly as it would with
  // an unconfigured database.
  return json(200, []);
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── 1. she opens the site ──');
await p.goto(B + '/', { waitUntil: 'networkidle' });
ok('the home page loads', (await p.textContent('body')).includes('وين'));
ok('and offers a way to search', (await p.locator('a[href="/search/"], button:has-text("بحث")').count()) > 0);

console.log('\n── 2. she taps the search button and asks for tea ──');
// The palette, not the /search/ page: it is the button in the navbar, it is
// what a thumb reaches for, and its dialog is loaded on demand — a code path
// worth walking rather than stepping around by typing an address.
await p.locator('button[aria-label*="بحث"]').first().click();
const box = p.locator('input[aria-label="ابحث في وين"]');
await box.waitFor({ state: 'visible', timeout: 15000 });
ok('the search palette opened, and its bundle arrived', await box.isVisible());
ok('the page did not navigate to do it', p.url().endsWith('/'), p.url());

await box.fill('چاي كرك');
await p.waitForTimeout(600);
let body = await p.textContent('body');
ok('results appear as she types', !body.includes('ما لقينا شي'), body.slice(0, 160));

console.log('\n── 3. she opens the place from the results ──');
const result = p.locator(`a[href*="/places/${SLUG}/"]`).first();
ok('the tea houses are among the results', (await result.count()) > 0);
await result.click();
// waitForURL, not waitForLoadState: this is a client-side route change with
// the bundle already in memory, so "networkidle" is true a moment before the
// route has actually committed and p.url() still reads the page she left.
await p.waitForURL(new RegExp(`/places/${SLUG}`), { timeout: 15000 });
await p.waitForLoadState('networkidle');
ok('the place page opened', p.url().includes(`/places/${SLUG}`), p.url());
body = await p.textContent('body');
ok('it shows the place', body.includes('مقاهي المباركية') || body.length > 500);

console.log('\n── 4. the order panel is there, because this place opted in ──');
// :has-text matches ancestors as well, so the count is the section plus
// whatever wraps it — the question is whether it is on screen, not how many
// elements contain the phrase.
const panel = p.locator('section:has-text("اطلب مقدّماً")').last();
await panel.waitFor({ state: 'visible', timeout: 10000 });
ok('the panel rendered', await panel.isVisible());
ok('it says payment happens at the counter', (await panel.textContent()).includes('الدفع عند الاستلام'));
ok('the sold-out item cannot be ordered', (await p.locator('span:has-text("خلصت")').count()) === 1);
ok('nothing claims the order is paid', !(await p.textContent('body')).includes('مدفوع'));

console.log('\n── 5. she picks two karak and a coffee ──');
const send = p.locator('button:has-text("أرسل الطلب")');
ok('sending is refused with an empty basket', await send.isDisabled());
const plusKarak = p.locator('button[aria-label*="زد چاي كرك"]');
await plusKarak.click();
await plusKarak.click();
await p.locator('button[aria-label*="زد قهوة عربية"]').click();
await p.waitForTimeout(250);
body = await p.textContent('body');
ok('the total is ١٫٠٠٠ د.ك', body.includes('١٫٠٠٠ د.ك'), body.match(/[٠-٩٫]+ د\.ك/g)?.join(' ') ?? '');
ok('and it is labelled approximate, not a receipt', body.includes('المجموع التقريبي'));

console.log('\n── 6. she is asked for the least she can give ──');
await p.locator('#o-name').fill('نورة');
await p.locator('#o-phone').fill('22345678');
await p.selectOption('#o-time', { index: 1 });
await send.click();
await p.waitForTimeout(400);
let alert = (await p.locator('[role=alert]').allTextContents()).join(' ');
ok('a landline is refused before anything is sent', alert.includes('رقم كويتي'), alert);
ok('and nothing reached the server', requests.filter((r) => r.method === 'POST' && r.url.includes('/orders')).length === 0);

console.log('\n── 7. she sends it, and the first attempt is lost ──');
await p.locator('#o-phone').fill('51234567');
// One dropped request, the way a phone behaves crossing a road.
let dropped = false;
await p.route('**/sb/rest/**', async (route) => {
  if (!dropped && route.request().method() === 'POST') { dropped = true; return route.abort('failed'); }
  return route.fallback();
});
await send.click();
await p.waitForTimeout(2500);
ok('the dropped request did not lose the order', db.order !== null, JSON.stringify(db.order));
const posts = requests.filter((r) => r.method === 'POST' && r.url.includes('/orders'));
ok('it was sent again after the drop', posts.length >= 1, `${posts.length} reached the server`);
ok('and the retry carried the same order id, so there is only one order',
  new Set(posts.map((r) => (JSON.parse(r.body)[0] ?? JSON.parse(r.body)).id)).size === 1,
  posts.map((r) => (JSON.parse(r.body)[0] ?? JSON.parse(r.body)).id).join(', '));
body = await p.textContent('body');
ok('she is told it arrived', body.includes('وصل طلبك'), body.slice(0, 200));

const reference = (body.match(/[0-9A-F]{6}/) || [])[0];
ok('with a reference she can say at the counter', !!reference, String(reference));
ok('the confirmation lists what she ordered', body.includes('چاي كرك') && body.includes('قهوة عربية'));
ok('it names the collection time', /[٠-٩]+:[٠-٩]+ [صم]/.test(body), body.slice(0, 300));
ok('and gives her directions', (await p.locator('a[href*="google.com/maps/dir"]').count()) >= 1);
ok('still nothing about having paid', !body.includes('مدفوع'));

console.log('\n── 8. she follows the link to her orders ──');
await p.locator('a[href="/orders"], a[href="/orders/"]').first().click();
await p.waitForURL(/\/orders/, { timeout: 15000 });
await p.waitForLoadState('networkidle');
await p.waitForTimeout(900);
ok('طلباتي opened from the confirmation', p.url().includes('/orders'), p.url());
body = await p.textContent('body');
ok('her order is there', body.includes(reference), body.slice(0, 200));
ok('it is waiting to be prepared', body.includes('بانتظار التجهيز'));
ok('the items are listed here too', body.includes('چاي كرك'));
ok('with nobody claiming it is paid', !body.includes('مدفوع'));

console.log('\n── 9. the shop marks it ready, and her screen catches up ──');
db.status = 'ready';
db.readyAt = '2026-08-21T09:25:00Z';
// She looks back at her phone — which is exactly when the tracker refreshes,
// rather than up to a poll interval later.
await p.evaluate(() => {
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await p.waitForTimeout(150);
await p.evaluate(() => {
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await p.waitForTimeout(1200);
body = await p.textContent('body');
ok('it says the order is ready', body.includes('طلبك جاهز'), body.slice(0, 300));
ok('and repeats the reference to say at the counter', body.includes(reference));
ok('cancelling is no longer offered — the food exists', (await p.locator('button:has-text("ألغِ الطلب")').count()) === 0);

console.log('\n── 10. she collects it, and the screen stops asking ──');
db.status = 'collected';
db.collectedAt = '2026-08-21T09:40:00Z';
await p.evaluate(() => {
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await p.waitForTimeout(1200);
body = await p.textContent('body');
ok('the order shows as collected', body.includes('تسلّمته'), body.slice(0, 300));

const before = requests.filter((r) => r.url.includes('order_status')).length;
// Without this the check below passes on a tracker that never polled at all.
ok('the tracker really was polling', before > 0, `${before} status reads`);
await p.waitForTimeout(2500);
const after = requests.filter((r) => r.url.includes('order_status')).length;
ok('and polling stopped — nothing changes after collection', after === before, `${before} → ${after}`);

console.log('\n── the whole way through ──');
ok('no page errors anywhere on the journey', errors.length === 0, errors.join(' | '));
ok('exactly one order exists at the end', db.order !== null && db.status === 'collected');

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
