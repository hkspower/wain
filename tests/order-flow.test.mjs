import { chromium } from 'playwright';

const B = process.env.WAIN_URL || 'http://localhost:4182';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar-KW' });
await ctx.addInitScript(() => { navigator.vibrate = () => true; });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));

console.log('\n── the panel appears only where a business opted in ──');
await p.goto(B + '/places/kuwait-towers/', { waitUntil: 'networkidle' });
ok('a seeded place with no menu shows no order panel', !(await p.textContent('body')).includes('اطلب مقدّماً'));

// The rest needs a place carrying a menu, which no shipped place has — no
// business has registered yet. Seed one into src/lib/places.ts and rebuild to
// exercise it; skipped rather than failed when the fixture is absent.
await p.goto(B + '/places/mubarakiya-tea-houses/', { waitUntil: 'networkidle' });
const panel = p.locator('section:has-text("اطلب مقدّماً")').first();
if ((await panel.count()) === 0) {
  console.log('– order-panel assertions skipped (no menu fixture in this build)');
  console.log(`\n${pass} passed, ${fails.length} failed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
}
ok('a place with a menu shows the panel', true);

console.log('\n── it never claims the customer has paid ──');
const body = await p.textContent('body');
ok('it says payment is on collection', body.includes('الدفع عند الاستلام'));
ok('the word «مدفوع» appears nowhere', !body.includes('مدفوع'));
ok('it says wain does not hold the money', body.includes('ما ندفع ولا نمسك فلوسك') || body.includes('ما تدفع شي هنا'));
ok('the total is labelled approximate', body.includes('المجموع التقريبي'));

console.log('\n── choosing items ──');
const send = p.locator('button:has-text("أرسل الطلب")');
ok('sending is disabled with an empty basket', await send.isDisabled());
ok('a sold-out item cannot be added', (await p.locator('span:has-text("خلصت")').count()) === 1);

const plusKarak = p.locator('button[aria-label*="زد چاي كرك"]');
await plusKarak.click();
await plusKarak.click();
await p.waitForTimeout(200);
ok('quantity shows in Arabic digits', (await p.locator('span[aria-label="الكمية 2"]').count()) === 1);
ok('two karak is ٠٫٥٠٠', (await p.textContent('body')).includes('٠٫٥٠٠ د.ك'), 'expected 0.500');

await p.locator('button[aria-label*="زد قهوة عربية"]').click();
await p.waitForTimeout(200);
ok('adding a 0.500 coffee makes ١٫٠٠٠', (await p.textContent('body')).includes('١٫٠٠٠ د.ك'));
ok('sending is now possible', !(await send.isDisabled()));

const minus = p.locator('button[aria-label*="أنقص چاي كرك"]');
await minus.click(); await minus.click();
await p.waitForTimeout(200);
ok('removing back to zero leaves only the coffee', (await p.textContent('body')).includes('٠٫٥٠٠ د.ك'));
ok('the minus button disables at zero', await minus.isDisabled());

console.log('\n── it refuses an incomplete order, in Arabic ──');
await send.click();
await p.waitForTimeout(400);
// allTextContents never trips strict mode; .textContent() throws when more
// than one alert is on screen and a .catch() there silently reads as "no
// alert at all", which is how this looked like a product bug.
const alert = (await p.locator('[role=alert]').allTextContents()).join(' ');
ok('an alert appears', alert.length > 0);
ok('it asks for a name', alert.includes('اسمك'));
ok('it asks for a time or a phone', alert.includes('وقت') || alert.includes('رقم'));

await p.locator('#o-name').fill('سالم');
await p.locator('#o-phone').fill('22345678');
await p.selectOption('#o-time', { index: 1 });
await send.click();
await p.waitForTimeout(400);
const alert2 = (await p.locator('[role=alert]').allTextContents()).join(' ');
ok('a landline number is refused', alert2.includes('رقم كويتي'), alert2);

await p.locator('#o-phone').fill('51234567');
await send.click();
await p.waitForTimeout(700);
const after = await p.textContent('body');
ok('with no database it says so plainly rather than pretending', after.includes('مو متاح حالياً') || after.includes('اتصل بالمكان'));
ok('it still has not claimed payment', !after.includes('مدفوع'));

console.log('\n── accessibility of the controls ──');
const labels = await p.locator('section:has-text("اطلب مقدّماً") button[aria-label]').count();
ok('every stepper button is labelled', labels >= 4);
ok('the quantity is announced', (await p.locator('[aria-live="polite"]').count()) >= 1);
ok('no page errors throughout', errors.length === 0, errors.join(' | '));

await p.locator('section:has-text("اطلب مقدّماً")').first().screenshot({ path: 'order-panel.png' });

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
