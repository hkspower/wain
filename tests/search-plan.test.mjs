import { chromium } from 'playwright';

/**
 * «رسّلها للربع» ON the search page — the errand finished where it started.
 *
 * The place-page panel is covered by hangout-page.test.mjs: the share sheet,
 * wa.me, the clipboard, the expiring hours. None of that is repeated here,
 * because it is the same component and testing it twice only makes it twice as
 * slow to change.
 *
 * What is only true here is the target. On a place page the place is settled by
 * the URL; on search it is whichever of forty results the visitor means, and it
 * moves — with the chips, and with the map and the list, which already point at
 * each other. Every assertion below is about that: which place the panel is
 * about, and whether the message that leaves actually names it.
 *
 * The failure this is written against is a quiet one. A panel that always sends
 * the top result no matter which chip is lit still looks completely correct —
 * the chip moves, the heading is right — and the group receives the wrong place.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

/** A search page whose share sheet is a spy. */
async function fresh(q) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW',
  });
  await ctx.addInitScript(() => {
    window.__shared = [];
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data) => { window.__shared.push(data); return Promise.resolve(); },
    });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${B}/search/?q=${encodeURIComponent(q)}`, { waitUntil: 'networkidle' });
  return { ctx, p, errors };
}

const panel = (p) => p.locator('section', { has: p.locator('h2', { hasText: 'رسّلها للربع' }) }).last();
const sendButton = (p) => panel(p).locator('button', { hasText: /^رسّلها$|لحظة/ });
/** The place chips live under «أي مكان؟»; the time chips under «متى؟». */
const placeField = (p) => panel(p).locator('fieldset', { has: p.locator('legend', { hasText: 'أي مكان؟' }) });
const placeChips = (p) => placeField(p).locator('button');
/** aria-pressed is on the chip itself, not on anything inside it. */
const chosenPlace = (p) => placeField(p).locator('button[aria-pressed="true"]');
const otherPlace = (p) => placeField(p).locator('button[aria-pressed="false"]');

console.log('\n── a search you can act on without leaving it ──');
{
  const { ctx, p, errors } = await fresh('قهوة');
  await panel(p).waitFor({ timeout: 8000 });
  ok('the panel is on the search page', await panel(p).isVisible());
  ok('it offers a choice of place', (await placeChips(p).count()) > 1);
  ok('exactly one place is selected', (await chosenPlace(p).count()) === 1);
  ok('and a time is already chosen', (await panel(p).locator('button[aria-pressed="true"]').count()) === 2,
    'one place + one time');
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── it sends the place it says it is about ──');
{
  const { ctx, p } = await fresh('قهوة');
  await panel(p).waitFor({ timeout: 8000 });
  const target = (await chosenPlace(p).first().textContent()).trim();
  await sendButton(p).click();
  await p.waitForFunction(() => window.__shared.length > 0, null, { timeout: 8000 });
  const [data] = await p.evaluate(() => window.__shared);
  ok('the share sheet opens from search', !!data);
  ok(`the message names the selected place «${target}»`,
    data.text.includes(target), data.text.slice(0, 80));
  ok('and carries a time', /الحين|بعد ساعة|الليلة الساعة|باچر|الويكند/.test(data.text), data.text);
  ok('url is not passed alongside text', data.url === undefined);
  await ctx.close();
}

console.log('\n── picking a different place sends THAT one ──');
{
  const { ctx, p } = await fresh('قهوة');
  await panel(p).waitFor({ timeout: 8000 });
  // The first chip that is not the one already selected.
  const unselected = otherPlace(p).first();
  const wanted = (await unselected.textContent()).trim();
  const before = (await chosenPlace(p).first().textContent()).trim();
  await unselected.click();
  await p.waitForFunction(
    (w) => {
      const el = [...document.querySelectorAll('button[aria-pressed="true"]')];
      return el.some((b) => b.textContent.trim() === w);
    },
    wanted,
    { timeout: 6000 }
  );
  ok(`«${wanted}» is now the selected place`,
    (await chosenPlace(p).first().textContent()).trim() === wanted);
  await sendButton(p).click();
  await p.waitForFunction(() => window.__shared.length > 0, null, { timeout: 8000 });
  const [data] = await p.evaluate(() => window.__shared);
  ok(`the message names «${wanted}»`, data.text.includes(wanted), data.text.slice(0, 80));
  ok(`and not the one it replaced («${before}»)`, !data.text.includes(before),
    data.text.slice(0, 80));
  await ctx.close();
}

console.log('\n── a result from the last place is not a result about this one ──');
{
  const { ctx, p } = await fresh('قهوة');
  await panel(p).waitFor({ timeout: 8000 });
  await sendButton(p).click();
  await p.waitForFunction(() => window.__shared.length > 0, null, { timeout: 8000 });
  // navigator.share resolving counts as sent, and the panel says so somewhere.
  await otherPlace(p).first().click();
  await p.waitForTimeout(300);
  const stale = await panel(p).locator('[role="status"]').count();
  ok('switching place clears the previous outcome line', stale === 0,
    `${stale} status lines still showing`);
  await ctx.close();
}

console.log('\n── nothing to plan, nothing shown ──');
{
  // «خصوصية» matches the privacy page and no place at all, so there is no
  // place to send and the panel must not invent one.
  const { ctx, p, errors } = await fresh('خصوصية');
  await p.waitForTimeout(1200);
  ok('no plan panel when no place matched', (await panel(p).count()) === 0);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── ordering is offered only where a business switched it on ──');
{
  // Zero of the fifty-two do today. A greyed or dead «اطلب» on every result
  // would teach the visitor to ignore the row, so the correct count is none.
  const { ctx, p } = await fresh('قهوة');
  await panel(p).waitFor({ timeout: 8000 });
  const order = await p.locator('a', { hasText: 'اطلب من' }).count();
  const queue = await p.locator('a', { hasText: 'خذ دورك' }).count();
  ok('no order link while no place accepts orders', order === 0, `${order} shown`);
  ok('no queue link while no salon runs a queue', queue === 0, `${queue} shown`);
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
