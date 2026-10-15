import { chromium } from 'playwright';

/**
 * Touch presses, and the transitions a phone keeps.
 *
 * On a phone (pointer: coarse) globals.css used to set `transition: transform
 * 120ms` and a transform press on every link and button. The rule was
 * unlayered, so it beat the `transition` utility: colour, background and shadow
 * stopped easing on touch, and the press stacked a second squeeze on top of
 * active:scale-95, which compiles to the individual `scale` property. The
 * default now sits in @layer base and presses with `scale`, so any utility
 * wins over it, and nothing stacks.
 *
 * The press is measured as the effective scale (transform × scale) while the
 * pointer is held down; the held state is the only one a finger shows.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

// Effective scale of an element right now: its transform's x-scale times its scale property.
const EFFECTIVE = (el) => {
  const cs = getComputedStyle(el);
  const m = cs.transform.match(/^matrix\(([^,]+)/);
  const t = m ? parseFloat(m[1]) : 1;
  const s = cs.scale === 'none' ? 1 : parseFloat(cs.scale);
  return +(t * s).toFixed(3);
};
const TRANSITIONS = (el) => getComputedStyle(el).transitionProperty.split(',').map((s) => s.trim());

// A fresh touch page for each press: pressing a control and releasing it
// navigates or starts a call, so a press is only ever measured while held.
async function heldScale(path, selector, { inject = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW' });
  const p = await ctx.newPage();
  await p.goto(`${B}${path}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  if (inject) {
    // A control with no classes at all: it gets only the base press.
    await p.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', '<button id="press-probe" style="position:fixed;left:8px;top:420px;width:140px;height:48px;z-index:9999">p</button>');
    });
  }
  const el = p.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await p.waitForTimeout(300);
  const box = await el.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(300);
  const held = { active: await el.evaluate((n) => n.matches(':active')), scale: await el.evaluate(EFFECTIVE) };
  await ctx.close();
  return held;
}

console.log('\n── on a phone, the transitions a button has are its own ──');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW' });
  const p = await ctx.newPage();
  await p.goto(`${B}/find/`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  ok('the context is a touch device', await p.evaluate(() => matchMedia('(pointer: coarse)').matches));
  const call = await p.locator('section[aria-label="اتصال"] button').first().evaluate(TRANSITIONS);
  ok('the call button keeps its colour and shadow transitions on touch', call.includes('background-color') && call.includes('box-shadow'), call.join(' '));
  const link = await p.locator('a[href="/salem/"]').first().evaluate(TRANSITIONS);
  ok('the typing link keeps its colour and shadow transitions on touch', link.includes('background-color') && link.includes('box-shadow'), link.join(' '));
  await ctx.close();
}

console.log('\n── a finger presses each control to its own depth ──');
{
  const callHeld = await heldScale('/find/', 'section[aria-label="اتصال"] button');
  ok('the call button is pressed by the utility alone (0.95), not squeezed twice', callHeld.active && Math.abs(callHeld.scale - 0.95) < 0.005, JSON.stringify(callHeld));
  const linkHeld = await heldScale('/find/', 'a[href="/salem/"]');
  ok('the typing link is pressed to 0.95', linkHeld.active && Math.abs(linkHeld.scale - 0.95) < 0.005, JSON.stringify(linkHeld));
  const plainHeld = await heldScale('/find/', '#press-probe', { inject: true });
  ok('a control with no press utility still gets the default 0.975', plainHeld.active && Math.abs(plainHeld.scale - 0.975) < 0.005, JSON.stringify(plainHeld));
}

console.log('\n── a mouse keeps its transitions and its hover ──');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-KW' });
  const p = await ctx.newPage();
  await p.goto(`${B}/find/`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  ok('the context is a mouse', await p.evaluate(() => matchMedia('(pointer: fine)').matches));
  const call = await p.locator('section[aria-label="اتصال"] button').first().evaluate(TRANSITIONS);
  ok('desktop: the call button keeps its colour and shadow transitions', call.includes('background-color') && call.includes('box-shadow'), call.join(' '));
  await ctx.close();
}

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
process.exit(fails.length ? 1 : 0);
