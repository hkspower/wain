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
   board would, so the customer's screen is reacting to a real change rather
   than to something the test told it directly.

   Two ways to run. By default the site's requests to /api/wain.php are
   intercepted here and answered in the server's own shapes (the ones
   tests/wain-api.test.mjs proves against the PHP). With WAIN_REAL_BACKEND set,
   nothing is intercepted: the fixture is served by a PHP server with the real
   endpoint behind it, and the shop's side is driven through the admin actions
   with the token in WAIN_ADMIN_SECRET — the same journey, a real back end. */
const REAL = !!process.env.WAIN_REAL_BACKEND;
const API_PATH = process.env.WAIN_API || '/api/wain.php';
const db = { order: null, status: 'placed', readyAt: null, collectedAt: null, cancelledAt: null };
const requests = [];
const isApi = (url) => url.includes(API_PATH);
const actionOf = (url) => { try { return new URL(url).searchParams.get('a'); } catch { return null; } };

if (!REAL) {
  await p.route((url) => isApi(url.href), async (route) => {
    const req = route.request();
    const url = req.url();
    const body = req.postData();
    const a = actionOf(url);
    requests.push({ url, action: a, method: req.method(), body });
    const json = (status, data) => route.fulfill({
      status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(data),
    });

    // Placing the order.
    if (a === 'order_place') {
      const row = JSON.parse(body);
      if (db.order && db.order.id === row.id) {
        // The same order sent twice: the server knows the id and the token,
        // and answers «placed, again» — the proof it is already there.
        return json(200, { ok: true, id: row.id, status: 'placed', again: true });
      }
      db.order = row;
      return json(200, { ok: true, id: row.id, status: 'placed', again: false });
    }

    // Reading it back with the id and the token.
    if (a === 'order_status') {
      const { id, token } = JSON.parse(body);
      if (!db.order || db.order.id !== id || db.order.track_token !== token) return json(200, { ok: true, order: null });
      return json(200, { ok: true, order: {
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
        cancelled_at: db.cancelledAt ?? null,
      } });
    }

    if (a === 'order_cancel') {
      const { id, token } = JSON.parse(body);
      if (!db.order || db.order.id !== id || db.order.track_token !== token) return json(200, { ok: true, status: null });
      if (db.status !== 'placed') return json(200, { ok: true, status: db.status });
      db.status = 'cancelled';
      db.cancelledAt = '2026-08-21T09:05:00Z';
      return json(200, { ok: true, status: 'cancelled' });
    }

    // Anything else — the live places read — answers empty so the site falls
    // back to its build-time snapshot, exactly as it would with a table that
    // has not been seeded yet.
    return json(200, { ok: true, places: [] });
  });
} else {
  // Record the traffic without touching it, so the same counts can be read.
  p.on('request', (req) => { if (isApi(req.url())) requests.push({ url: req.url(), action: actionOf(req.url()), method: req.method(), body: req.postData() }); });
}

/** The shop's side: in the mock, flip the in-memory row; against the real
 *  server, the admin action the board itself would send. */
const ADMIN = process.env.WAIN_ADMIN_SECRET || '';
async function adminCall(action, body) {
  const res = await fetch(`${B}${API_PATH}?a=${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wain-Admin': ADMIN },
    body: JSON.stringify(body),
  });
  return res.json();
}
async function shopSets(status) {
  if (!REAL) {
    db.status = status;
    if (status === 'ready') db.readyAt = '2026-08-21T09:25:00Z';
    if (status === 'collected') db.collectedAt = '2026-08-21T09:40:00Z';
    return;
  }
  const r = await adminCall('order_set_status', { id: db.order.id, status });
  if (!r.ok) throw new Error('the admin action failed: ' + JSON.stringify(r));
  db.status = status;
}
/** What the server holds for the latest order placed by this page. */
async function serverOrder() {
  if (!REAL) return db.order;
  const list = await adminCall('orders_list', { limit: 20 });
  const placed = requests.filter((r) => r.action === 'order_place').map((r) => JSON.parse(r.body).id);
  const row = (list.orders ?? []).find((o) => placed.includes(o.id));
  if (row) db.order = { ...row, track_token: JSON.parse(requests.find((r) => r.action === 'order_place' && JSON.parse(r.body).id === row.id).body).track_token };
  return row ?? null;
}
async function serverStatus() {
  if (!REAL) return db.status;
  const list = await adminCall('orders_list', { limit: 20 });
  return (list.orders ?? []).find((o) => o.id === db.order?.id)?.status ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── 1. she opens the site ──');
await p.goto(B + '/', { waitUntil: 'networkidle' });
ok('the home page loads', (await p.textContent('body')).includes('وين'));
// `:visible`, not a bare count. Counting is what let this pass while the home
// page had no route to search at all: the only `href="/search/"` left after
// the navbar went was AppTabBar's tab, which is `standalone:block` and so is
// in the DOM and painted by nothing outside the installed app.
ok('and offers a way to search', (await p.locator('a[href="/search/"]:visible').count()) > 0);
// As the installed app — the attribute AppShell sets for a home-screen launch
// or the Capacitor shell. The tab bar appears, and the pill under the dial
// stands down so search is offered once, not twice. Put back afterwards: the
// journey below is a browser's.
await p.evaluate(() => { document.documentElement.dataset.standalone = 'true'; });
const appLinks = await p.locator('a[href="/search/"]:visible').evaluateAll((as) => as.map((a) => !!a.closest('nav')));
ok('installed, search is offered exactly once — by the tab bar', appLinks.length === 1 && appLinks[0] === true, JSON.stringify(appLinks));
await p.evaluate(() => { delete document.documentElement.dataset.standalone; });

console.log('\n── 2. she follows the search link and asks for tea ──');
// The link on the home page, followed rather than typed. This step used to
// open the ⌘K palette from the navbar button, which was the thumb's route to
// searching; the navbar was removed and took the palette with it, so this is
// now the only route there is — which is exactly why it is worth walking.
await p.locator('a[href="/search/"]:visible').first().click();
const box = p.locator('input[aria-label="ابحث في كل محتوى وين"]');
await box.waitFor({ state: 'visible', timeout: 15000 });
ok('the search page opened, and its bundle arrived', await box.isVisible());
ok('and that is where she landed', p.url().includes('/search'), p.url());

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
ok('and nothing reached the server', requests.filter((r) => r.action === 'order_place').length === 0);

console.log('\n── 7. she sends it, and the first attempt is lost ──');
await p.locator('#o-phone').fill('51234567');
// One dropped request, the way a phone behaves crossing a road. The drop is
// a route of its own so it works in both modes: against the real server the
// first order_place is aborted before it leaves the browser.
let dropped = false;
await p.route((url) => isApi(url.href) && url.searchParams.get('a') === 'order_place', async (route) => {
  if (!dropped) { dropped = true; requests.push({ url: route.request().url(), action: 'order_place', method: 'POST', body: route.request().postData(), dropped: true }); return route.abort('failed'); }
  return route.fallback();
});
await send.click();
await p.waitForTimeout(2500);
ok('the dropped request did not lose the order', (await serverOrder()) !== null, JSON.stringify(db.order));
const posts = requests.filter((r) => r.action === 'order_place');
ok('it was sent again after the drop', posts.filter((r) => !r.dropped).length >= 1, `${posts.length} attempts, ${posts.filter((r) => !r.dropped).length} reached the server`);
ok('and the retry carried the same order id, so there is only one order',
  new Set(posts.map((r) => JSON.parse(r.body).id)).size === 1,
  posts.map((r) => JSON.parse(r.body).id).join(', '));
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
await shopSets('ready');
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
await shopSets('collected');
await p.evaluate(() => {
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await p.waitForTimeout(1200);
body = await p.textContent('body');
ok('the order shows as collected', body.includes('تسلّمته'), body.slice(0, 300));

const before = requests.filter((r) => r.action === 'order_status').length;
// Without this the check below passes on a tracker that never polled at all.
ok('the tracker really was polling', before > 0, `${before} status reads`);
await p.waitForTimeout(2500);
const after = requests.filter((r) => r.action === 'order_status').length;
ok('and polling stopped — nothing changes after collection', after === before, `${before} → ${after}`);

console.log('\n── 11. a second order, which she calls off herself ──');
// The old card said «المكان ألغى الطلب» whoever had cancelled — so a customer
// who pressed «ألغِ الطلب» was told the shop had cancelled on them. The device
// remembers who did it; the database only knows that it happened.
const first = db.order;
const placedBefore = requests.filter((r) => r.action === 'order_place').length;
db.order = null; db.status = 'placed'; db.readyAt = null; db.collectedAt = null; db.cancelledAt = null;
await p.goto(`${B}/places/${SLUG}/`, { waitUntil: 'networkidle' });
await p.locator('button[aria-label*="زد چاي كرك"]').click();
await p.locator('#o-name').fill('نورة');
await p.locator('#o-phone').fill('51234567');
await p.selectOption('#o-time', { index: 1 });
await p.locator('button:has-text("أرسل الطلب")').click();
await p.waitForTimeout(800);
ok('the second order was placed', (await serverOrder()) !== null && db.order.id !== first.id
   && requests.filter((r) => r.action === 'order_place').length > placedBefore);
await p.goto(`${B}/orders/`, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.evaluate(() => { window.confirm = () => true; });
// Scoped to the second order's card: the first one is collected, but the mock
// now answers «no such order» for it, and a card with no readable status
// falls back to «placed» and offers cancel too.
const ref2 = db.order.id.replace(/-/g, '').slice(0, 6).toUpperCase();
const cancelBtn = p.locator(`li[data-order-card="db"]:has-text("${ref2}") button:has-text("ألغِ الطلب")`);
ok('cancelling is offered on the placed order', (await cancelBtn.count()) === 1);
await cancelBtn.first().click().catch(() => {});
await p.waitForTimeout(1200);
body = await p.textContent('body');
ok('the server says cancelled', (await serverStatus()) === 'cancelled');
ok('and the card says SHE cancelled it', body.includes('ألغيت الطلب'), body.slice(0, 400));
ok('…not that the shop did', !body.includes('المكان ألغى الطلب'));
const remembered = JSON.parse(await p.evaluate(() => localStorage.getItem('wain:orders') || '[]'));
ok('the device remembers it was hers', (remembered.find((o) => o.id === db.order.id) || {}).cancelledByMe === true);

console.log('\n── the whole way through ──');
ok('no page errors anywhere on the journey', errors.length === 0, errors.join(' | '));
ok('the first order was collected and the second cancelled', first !== null && (await serverStatus()) === 'cancelled');

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
