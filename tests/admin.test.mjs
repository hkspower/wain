import { chromium } from 'playwright';

/**
 * The admin board against the real back end (run by tests/run-backend.mjs).
 *
 * The gate first: a wrong password is refused with a sentence, the right one
 * opens the board, and the token lives in this tab alone. Then the four panels
 * on real rows — the seeded catalogue, a publish toggle that the PUBLIC read
 * reflects, the orders the journey just placed (one collected, one cancelled),
 * the empty submissions queue — and the walk-in gate on the queue tab.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4221';
const API = process.env.WAIN_API || '/api/wain.php';
const SECRET = process.env.WAIN_ADMIN_SECRET || '';
const SLUG = process.env.WAIN_FIXTURE_SLUG || 'mubarakiya-tea-houses';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar-KW' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const apiRequests = [];
p.on('request', (r) => { if (r.url().includes(API)) apiRequests.push({ url: r.url(), headers: r.headers() }); });

const publicPlaces = async () => (await fetch(`${B}${API}?a=places`).then((r) => r.json())).places;

console.log('\n── the gate ──');
await p.goto(`${B}/admin/`, { waitUntil: 'networkidle' });
const secretBox = p.locator('#a-secret');
await secretBox.waitFor({ state: 'visible', timeout: 15000 });
ok('with a secret on the server and none in this tab, the sign-in form shows', await secretBox.isVisible());
ok('the page asked the server about itself first', apiRequests.some((r) => r.url.includes('a=ping')));
ok('and sent no admin header while doing so', !apiRequests.some((r) => r.headers['x-wain-admin']));
await secretBox.fill('wrong-password-for-the-board');
await p.locator('button[type=submit]').click();
const alert = p.locator('p[role=alert]');
await alert.waitFor({ state: 'visible', timeout: 10000 });
ok('a wrong password is refused with a sentence', (await alert.textContent()).includes('كلمة السر'), await alert.textContent());
ok('and the wrong token is not kept in the tab', (await p.evaluate(() => sessionStorage.getItem('wain:admin'))) === null);

await secretBox.fill(SECRET);
await p.locator('button[type=submit]').click();
const heading = p.locator('h1:has-text("لوحة التحكّم")');
await p.locator('[role=tablist]').waitFor({ state: 'visible', timeout: 15000 });
ok('the right password opens the board', await heading.isVisible() && await p.locator('[role=tablist]').isVisible());
ok('the token is in sessionStorage, not localStorage and not a cookie',
  (await p.evaluate(() => sessionStorage.getItem('wain:admin'))) === SECRET
  && (await p.evaluate(() => localStorage.getItem('wain:admin'))) === null
  && (await ctx.cookies()).length === 0);
ok('the header says which stage it is on', (await p.textContent('header')).includes('الموقع الحي'));

console.log('\n── the places tab: the seeded catalogue ──');
const list = p.locator('main ul li, ul.space-y-2 li');
await list.first().waitFor({ state: 'visible', timeout: 15000 });
const shown = await p.locator('ul.space-y-2 > li').count();
const live = await publicPlaces();
ok(`the list shows every seeded place (${shown})`, shown >= 50 && shown === live.length, `${shown} vs ${live.length} public`);
const fixtureItem = p.locator(`ul.space-y-2 > li:has-text("${live.find((r) => r.slug === SLUG)?.name_ar ?? 'مقاهي المباركية'}")`).first();
ok('the fixture place is among them', (await fixtureItem.count()) === 1);

console.log('\n── publish toggle: the public read follows ──');
const toggle = fixtureItem.locator('button:has-text("منشور")');
ok('it is published', (await toggle.count()) === 1);
await toggle.click();
await p.waitForTimeout(800);
ok('the row now says hidden', (await fixtureItem.locator('button:has-text("مخفي")').count()) === 1);
const afterHide = await publicPlaces();
ok('and the public `places` no longer lists it', !afterHide.some((r) => r.slug === SLUG), `${afterHide.length} public`);
await fixtureItem.locator('button:has-text("مخفي")').click();
await p.waitForTimeout(800);
const afterShow = await publicPlaces();
ok('toggling back publishes it again', afterShow.some((r) => r.slug === SLUG) && (await fixtureItem.locator('button:has-text("منشور")').count()) === 1);

console.log('\n── the orders tab: what the journey placed ──');
await p.locator('[role=tab]:has-text("الطلبات المسبقة")').click();
await p.waitForTimeout(1200);
let body = await p.textContent('body');
if (body.includes('ما فيه طلبات مفتوحة') || body.includes('المفتوحة بس')) {
  await p.locator('button:has-text("كل الطلبات")').click().catch(() => {});
  await p.waitForTimeout(400);
  body = await p.textContent('body');
}
ok('the orders tab lists the journey\'s orders', body.includes('تسلّم') && body.includes('ملغي'), body.slice(0, 300));
ok('with the customer\'s name and number for the counter', body.includes('نورة') && body.includes('51234567'));
ok('and the recomputed total agrees with the stored one', !body.includes('راجع السعر عند الاستلام'));

console.log('\n── the queue tab: a walk-in needs a salon ──');
await p.locator('[role=tab]:has-text("الطابور")').click();
await p.waitForTimeout(1200);
body = await p.textContent('body');
ok('today\'s queue is empty', body.includes('ما فيه أدوار اليوم'), body.slice(0, 200));
await p.locator('input[aria-label="اسم الزبون"]').fill('زبون');
await p.locator('button:has-text("أضفه")').click();
await p.waitForTimeout(600);
body = await p.textContent('body');
ok('without a salon to add to, the board says so instead of inventing one', body.includes('ما فيه صالون محدد'), body.slice(0, 300));

console.log('\n── the submissions tab ──');
await p.locator('[role=tab]:has-text("طلبات التسجيل")').click();
await p.waitForTimeout(1200);
body = await p.textContent('body');
ok('nothing is waiting, and it says where submissions come from', body.includes('ما فيه طلبات تنتظر') && body.includes('/add'), body.slice(0, 300));

console.log('\n── every admin request carried the token, and the public ones did not ──');
const adminActions = ['places_all', 'place_publish', 'orders_list', 'queue_list', 'submissions_list', 'whoami'];
const sent = apiRequests.filter((r) => adminActions.some((a) => r.url.includes(`a=${a}`)));
// The one with the wrong password is in here too, carrying what was typed.
ok(`${sent.length} admin requests, every one with X-Wain-Admin and all but the refused guess with the secret`,
  sent.length > 5 && sent.every((r) => r.headers['x-wain-admin']) && sent.filter((r) => r.headers['x-wain-admin'] === SECRET).length >= sent.length - 1);
ok('the secret never travelled in a URL', !apiRequests.some((r) => r.url.includes(SECRET)));

console.log('\n── signing out ──');
await p.locator('button:has-text("خروج")').click();
await p.waitForTimeout(400);
ok('the sign-in form is back and the token is gone', await p.locator('#a-secret').isVisible() && (await p.evaluate(() => sessionStorage.getItem('wain:admin'))) === null);

ok('no page errors on the board', errors.length === 0, errors.join(' | '));

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
