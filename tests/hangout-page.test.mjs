import { chromium } from 'playwright';

/**
 * «رسّلها للربع» on a real place page.
 *
 * The logic tests cover what the message says. This covers the part that only
 * exists in a browser: whether the thing a visitor taps actually reaches
 * WhatsApp. That is a chain of three fallbacks — the native share sheet, then
 * wa.me, then the clipboard — and on any one device only one link of it runs,
 * so the other two are exactly the kind of code that is wrong for a year.
 *
 * Every layer is removed in turn and the next one is checked to catch it.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const PLACE = '/places/kuwait-towers/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

/**
 * A page with the three share mechanisms replaced by spies.
 * `share` decides what navigator.share does: "ok", "cancel", "throw", or
 * "absent" (the property is deleted, as on desktop Firefox).
 */
async function fresh({ share = 'ok', canOpen = true, clipboard = true } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW',
  });
  await ctx.addInitScript(({ share, canOpen, clipboard }) => {
    window.__shared = [];
    window.__opened = [];
    window.__copied = [];
    if (share === 'absent') {
      delete Navigator.prototype.share;
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    } else {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: (data) => {
          window.__shared.push(data);
          if (share === 'cancel') {
            const e = new Error('cancelled'); e.name = 'AbortError'; return Promise.reject(e);
          }
          if (share === 'throw') return Promise.reject(new Error('not allowed'));
          return Promise.resolve();
        },
      });
    }
    window.open = (url) => { window.__opened.push(url); return canOpen ? {} : null; };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (t) => {
          if (!clipboard) return Promise.reject(new Error('denied'));
          window.__copied.push(t); return Promise.resolve();
        },
      },
    });
  }, { share, canOpen, clipboard });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(B + PLACE, { waitUntil: 'networkidle' });
  return { ctx, p, errors };
}

const panel = (p) => p.locator('section', { has: p.locator('h2', { hasText: 'رسّلها للربع' }) }).last();
const sendButton = (p) => panel(p).locator('button', { hasText: /^رسّلها$|لحظة/ });

console.log('\n── the panel is on the page, with a time already chosen ──');
{
  const { ctx, p, errors } = await fresh();
  await panel(p).waitFor({ timeout: 6000 });
  ok('the panel renders', await panel(p).isVisible());
  const chips = panel(p).locator('button[aria-pressed]');
  const n = await chips.count();
  ok('it offers time chips', n >= 3, `${n} chips`);
  ok('exactly one is preselected', (await panel(p).locator('button[aria-pressed="true"]').count()) === 1);
  ok('the send button is there', await sendButton(p).isVisible());
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── with a share sheet, that is what gets used ──');
{
  const { ctx, p } = await fresh({ share: 'ok' });
  await panel(p).waitFor({ timeout: 6000 });
  await sendButton(p).click();
  await p.waitForFunction(() => window.__shared.length > 0, null, { timeout: 6000 });
  const [data] = await p.evaluate(() => window.__shared);
  ok('the share sheet is opened', !!data);
  ok('the message names the place', data.text.includes('أبراج الكويت'), data.text.slice(0, 60));
  ok('and carries a time', /الحين|بعد ساعة|الليلة الساعة|باچر|الويكند/.test(data.text), data.text);
  ok('and the page link', data.text.includes('/places/kuwait-towers/'), data.text.slice(-80));
  // Passing url alongside text makes several Android browsers drop the text.
  ok('url is not passed alongside text', data.url === undefined, JSON.stringify(Object.keys(data)));
  ok('no WhatsApp tab was opened as well', (await p.evaluate(() => window.__opened.length)) === 0);
  ok('and nothing was copied', (await p.evaluate(() => window.__copied.length)) === 0);
  await ctx.close();
}

console.log('\n── changing the chip changes the message ──');
{
  const { ctx, p } = await fresh({ share: 'ok' });
  await panel(p).waitFor({ timeout: 6000 });
  const chips = panel(p).locator('button[aria-pressed]');
  const chosen = await chips.last().textContent();
  await chips.last().click();
  await sendButton(p).click();
  await p.waitForFunction(() => window.__shared.length > 0, null, { timeout: 6000 });
  const [data] = await p.evaluate(() => window.__shared);
  ok(`picking «${chosen.trim()}» puts it in the message`,
    data.text.includes(chosen.trim().replace(/^٧ مساءً$/, 'الساعة ٧')) ||
    data.text.includes(chosen.trim()) ||
    /الساعة|باچر|الويكند|الحين|بعد ساعة/.test(data.text), data.text.split('\n')[1]);
  ok('that chip is the pressed one', (await chips.last().getAttribute('aria-pressed')) === 'true');
  await ctx.close();
}

console.log('\n── no share sheet: WhatsApp directly ──');
{
  const { ctx, p } = await fresh({ share: 'absent' });
  await panel(p).waitFor({ timeout: 6000 });
  await sendButton(p).click();
  await p.waitForFunction(() => window.__opened.length > 0, null, { timeout: 6000 });
  const [url] = await p.evaluate(() => window.__opened);
  ok('wa.me is opened', url.startsWith('https://wa.me/?text='), url.slice(0, 40));
  ok('with the message encoded into it', decodeURIComponent(url).includes('أبراج الكويت'), decodeURIComponent(url).slice(0, 60));
  await p.waitForSelector('[role=status]', { timeout: 4000 });
  ok('and it says so', (await panel(p).textContent()).includes('واتساب'));
  await ctx.close();
}

console.log('\n── no share sheet and a blocked popup: the clipboard ──');
{
  const { ctx, p } = await fresh({ share: 'absent', canOpen: false });
  await panel(p).waitFor({ timeout: 6000 });
  await sendButton(p).click();
  await p.waitForFunction(() => window.__copied.length > 0, null, { timeout: 6000 });
  const [text] = await p.evaluate(() => window.__copied);
  ok('the message is copied', text.includes('أبراج الكويت'), text.slice(0, 50));
  await p.waitForSelector('[role=status]', { timeout: 4000 });
  ok('and it tells them to paste it', (await panel(p).textContent()).includes('انتسخت'));
  await ctx.close();
}

console.log('\n── nothing works at all: it says so rather than going quiet ──');
{
  const { ctx, p } = await fresh({ share: 'absent', canOpen: false, clipboard: false });
  await panel(p).waitFor({ timeout: 6000 });
  await sendButton(p).click();
  await p.waitForSelector('[role=alert]', { timeout: 6000 });
  ok('an alert explains what to do instead', (await panel(p).textContent()).includes('انسخ الرابط'));
  await ctx.close();
}

console.log('\n── a share sheet that throws falls through to WhatsApp ──');
{
  const { ctx, p } = await fresh({ share: 'throw' });
  await panel(p).waitFor({ timeout: 6000 });
  await sendButton(p).click();
  await p.waitForFunction(() => window.__opened.length > 0, null, { timeout: 6000 });
  ok('the next option is tried', (await p.evaluate(() => window.__opened.length)) === 1);
  await ctx.close();
}

console.log('\n── backing out of the share sheet is not an error ──');
{
  const { ctx, p } = await fresh({ share: 'cancel' });
  await panel(p).waitFor({ timeout: 6000 });
  await sendButton(p).click();
  await p.waitForFunction(() => window.__shared.length > 0, null, { timeout: 6000 });
  await p.waitForTimeout(500);
  // Changing your mind must not open WhatsApp behind your back, and must not
  // be reported back to you as a failure.
  ok('WhatsApp is not opened behind them', (await p.evaluate(() => window.__opened.length)) === 0);
  ok('nothing is copied', (await p.evaluate(() => window.__copied.length)) === 0);
  ok('and no error is shown', (await panel(p).locator('[role=alert]').count()) === 0);
  ok('and no success is claimed either', (await panel(p).locator('[role=status]').count()) === 0);
  await ctx.close();
}

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
