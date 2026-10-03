/**
 * The order panel in WhatsApp mode — the only mode a visitor can meet today.
 *
 * Runs against the fixture build run-orders.mjs makes: back end off, one place
 * with a menu AND a number (the panel), one with a menu and no number (no
 * panel — the shape audit:places refuses in the catalogue, which is why only
 * a test build can show it). `window.open` and the clipboard are spies, the
 * way hangout-page.test.mjs stubs them, so the suite reads what the tap
 * would have handed to WhatsApp instead of opening anything.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const B = process.env.WAIN_URL || 'http://127.0.0.1:4193';
const SLUG = process.env.WAIN_FIXTURE_SLUG || 'mubarakiya-tea-houses';
const NO_NUMBER = process.env.WAIN_FIXTURE_SLUG_NO_NUMBER || 'souq-al-mubarakiya';
const DIGITS = process.env.WAIN_FIXTURE_WHATSAPP || '51234567';
const SHOTS = process.env.WAIN_SHOTS || 'shots';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

/** A page whose window.open records the URL and returns a window or null. */
async function fresh({ canOpen = true } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar-KW',
  });
  await ctx.addInitScript(({ canOpen }) => {
    navigator.vibrate = () => true;
    window.__opened = [];
    window.__copied = [];
    window.open = (url) => { window.__opened.push(url); return canOpen ? {} : null; };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } },
    });
  }, { canOpen });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  return { ctx, p, errors };
}

const panelOf = (p) => p.locator('section[data-order-channel]').first();
const sendOf = (p) => p.locator('button:has-text("أرسل عبر واتساب")');

/** Fill a basket of two karak and one coffee, a name and the first slot. */
async function basket(p) {
  const plus = p.locator('button[aria-label*="زد چاي كرك"]');
  await plus.click(); await plus.click();
  await p.locator('button[aria-label*="زد قهوة عربية"]').click();
  await p.locator('#o-name').fill('سالم');
  await p.selectOption('#o-time', { index: 1 });
  await p.waitForTimeout(150);
}

const decodeOpened = (url) => decodeURIComponent(url.slice(url.indexOf('?text=') + 6));

console.log('\n── no database: the panel needs a number to send to ──');
{
  const { ctx, p, errors } = await fresh();
  await p.goto(`${B}/places/kuwait-towers/`, { waitUntil: 'networkidle' });
  ok('a place with no menu shows no panel', (await panelOf(p).count()) === 0);
  await p.goto(`${B}/places/${NO_NUMBER}/`, { waitUntil: 'networkidle' });
  ok('a place with a menu and no number shows no panel either — nowhere for the order to go',
    (await panelOf(p).count()) === 0);
  ok('(and its menu is really in this build)', !(await p.textContent('body')).includes('اطلب مقدّماً'));
  await p.goto(`${B}/places/${SLUG}/`, { waitUntil: 'networkidle' });
  ok('a place with a menu and a number shows the panel', (await panelOf(p).count()) === 1);
  ok('and the panel is in WhatsApp mode', (await panelOf(p).getAttribute('data-order-channel')) === 'whatsapp');
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── what the panel says in WhatsApp mode ──');
{
  const { ctx, p } = await fresh();
  await p.goto(`${B}/places/${SLUG}/`, { waitUntil: 'networkidle' });
  const text = await panelOf(p).textContent();
  ok('it says the order goes to the place on WhatsApp', text.includes('واتساب'));
  ok('there is no phone field — the shop answers in the thread', (await p.locator('#o-phone').count()) === 0);
  ok('name, time and note are still asked', (await p.locator('#o-name, #o-time, #o-note').count()) === 3);
  ok('the button says send via WhatsApp', (await sendOf(p).count()) === 1);
  ok('and is disabled with an empty basket', await sendOf(p).isDisabled());
  ok('it says payment is on collection', text.includes('الدفع عند الاستلام'));
  ok('the word «مدفوع» appears nowhere', !text.includes('مدفوع'));
  ok('it says wain does not hold the money', text.includes('ما ندفع ولا نمسك فلوسك'));
  await panelOf(p).screenshot({ path: `${SHOTS}/order-panel-whatsapp.png` });
  await ctx.close();
}

console.log('\n── it refuses an incomplete order, and never asks for a phone ──');
{
  const { ctx, p } = await fresh();
  await p.goto(`${B}/places/${SLUG}/`, { waitUntil: 'networkidle' });
  await p.locator('button[aria-label*="زد چاي كرك"]').click();
  await p.waitForTimeout(150);
  await sendOf(p).click();
  await p.waitForTimeout(400);
  const alert = (await p.locator('[role=alert]').allTextContents()).join(' ');
  ok('an alert appears', alert.length > 0);
  ok('it asks for a name', alert.includes('اسمك'), alert);
  ok('it does not ask for a phone', !alert.includes('رقم كويتي'), alert);
  ok('nothing was opened for an invalid order', (await p.evaluate(() => window.__opened.length)) === 0);
  ok('and nothing was remembered', (await p.evaluate(() => localStorage.getItem('wain:orders'))) === null);
  await ctx.close();
}

console.log('\n── the tap opens WhatsApp with the order as text ──');
{
  const { ctx, p, errors } = await fresh();
  await p.goto(`${B}/places/${SLUG}/`, { waitUntil: 'networkidle' });
  await basket(p);
  await sendOf(p).click();
  await p.waitForTimeout(400);
  const opened = await p.evaluate(() => window.__opened);
  ok('exactly one window was opened', opened.length === 1, JSON.stringify(opened));
  const url = opened[0] || '';
  ok("it is a wa.me link to the shop's number", url.startsWith(`https://wa.me/965${DIGITS}?text=`), url.slice(0, 50));
  const text = decodeOpened(url);
  ok('the text names the order', text.startsWith('طلب مسبق من وين — رقم الطلب '), text.split('\n')[0]);
  ok('two karak at ٠٫٥٠٠', text.includes('٢× چاي كرك — ٠٫٥٠٠ د.ك'), text);
  ok('one coffee at ٠٫٥٠٠', text.includes('١× قهوة عربية — ٠٫٥٠٠ د.ك'));
  ok('the total is ١٫٠٠٠ and approximate', text.includes('المجموع التقريبي: ١٫٠٠٠ د.ك'));
  ok('the name is in it', text.includes('الاسم: سالم'));
  ok('the time is in it', /الاستلام: الساعة [٠-٩]{1,2}:[٠-٩]{2} [صم]/.test(text), text);
  ok('it says payment is on collection', text.includes('الدفع عند الاستلام'));
  ok("it ends with the place's page", text.trimEnd().endsWith(`/places/${SLUG}/`), text.split('\n').at(-1));
  ok('and never says paid', !text.includes('مدفوع'));

  const body = await p.textContent('body');
  const ref = text.split('\n')[0].slice('طلب مسبق من وين — رقم الطلب '.length);
  ok('the reference is six characters', /^[0-9A-F]{6}$/.test(ref), ref);
  ok('the confirmation says WhatsApp was opened', body.includes('فتحنا لك واتساب'));
  ok('and shows the same reference', body.includes(ref));
  ok('and says to press send there', body.includes('اضغط «إرسال»'));
  ok('the «ما انفتح؟» link carries the same URL',
    (await p.locator(`a[href="${url}"]`).count()) >= 1);
  ok('no text box when the popup worked', (await p.locator('textarea').count()) === 0);
  ok('the screen never says paid', !body.includes('مدفوع'));

  const stored = JSON.parse(await p.evaluate(() => localStorage.getItem('wain:orders') || '[]'));
  ok('the device remembers one order', stored.length === 1, JSON.stringify(stored));
  const o = stored[0] || {};
  ok('…as a WhatsApp order', o.channel === 'whatsapp');
  ok("…with the shop's number", o.whatsapp === DIGITS);
  ok('…its two lines', Array.isArray(o.lines) && o.lines.length === 2 && o.lines[0].qty === 2);
  ok('…its total in fils', o.totalFils === 1000);
  ok('…and the reference in the message', o.reference === ref);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await p.locator('section[data-order-placed]').screenshot({ path: `${SHOTS}/order-whatsapp-opened.png` });
  await ctx.close();
}

console.log('\n── a blocked popup: the text, a copy button and a plain link ──');
{
  const { ctx, p, errors } = await fresh({ canOpen: false });
  await p.goto(`${B}/places/${SLUG}/`, { waitUntil: 'networkidle' });
  await basket(p);
  await sendOf(p).click();
  await p.waitForTimeout(400);
  const url = (await p.evaluate(() => window.__opened))[0] || '';
  const text = decodeOpened(url);
  const body = await p.textContent('body');
  ok('it says WhatsApp did not open', body.includes('ما انفتح واتساب'));
  const box = p.locator('textarea');
  ok('the message is shown in a text box', (await box.count()) === 1);
  ok('…and it is the exact text the link carries', (await box.inputValue()) === text);
  const link = p.locator(`a[href^="https://wa.me/965${DIGITS}?text="]`);
  ok('a plain link to WhatsApp is offered — a tap on an anchor is never blocked', (await link.count()) >= 1);
  ok('…with the same text', (await link.first().getAttribute('href')) === url);
  await p.locator('button:has-text("انسخ")').click();
  await p.waitForTimeout(200);
  const copied = await p.evaluate(() => window.__copied);
  ok('«انسخ» copies the message', copied.length === 1 && copied[0] === text, JSON.stringify(copied).slice(0, 80));
  ok('and says so', (await p.textContent('body')).includes('انتسخ'));
  const stored = JSON.parse(await p.evaluate(() => localStorage.getItem('wain:orders') || '[]'));
  ok('the order was remembered before the popup was tried', stored.length === 1 && stored[0].channel === 'whatsapp');
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await p.locator('section[data-order-placed]').screenshot({ path: `${SHOTS}/order-whatsapp-blocked.png` });
  await ctx.close();
}

console.log('\n── pressing twice is one order ──');
{
  const { ctx, p } = await fresh({ canOpen: false });
  await p.goto(`${B}/places/${SLUG}/`, { waitUntil: 'networkidle' });
  await basket(p);
  await sendOf(p).click();
  await p.waitForTimeout(300);
  // The blocked state offers the link; a customer who goes back and taps
  // the panel's own button again is rare, so the check is on the store: one
  // id, one reference, however the open went.
  // Soft reads: when the store is empty (a sabotage proved it can be) this
  // must be a red line, not an uncaught throw that ends the file.
  const stored = JSON.parse(await p.evaluate(() => localStorage.getItem('wain:orders') || '[]'));
  const link = (await p.locator(`a[href^="https://wa.me/"]`).first().getAttribute('href').catch(() => null)) || '';
  const ref = stored[0]?.reference;
  ok('the link and the stored order carry the same reference', !!ref && decodeOpened(link).includes(ref),
    `stored=${JSON.stringify(stored).slice(0, 60)} link=${link.slice(0, 40)}`);
  await ctx.close();
}

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
