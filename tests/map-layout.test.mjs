import { chromium } from 'playwright';

/**
 * The maps' boxes — measured on the built export, 7 October.
 *
 * Rendered with every box outlined before anything changed, the four maps
 * showed:
 *  - pins on the frame's edge: /search «قهوة» at 390 drew one 10px from the
 *    left border with half of it over the line, and /pick's lowest tip sat on
 *    the bottom border (the fit kept 15% of the spread and 2% of the height,
 *    which on a phone is almost nothing);
 *  - a desktop map taller than the screen: 22 results for «بحر» made the sticky
 *    map 686px, which a 1280×720 laptop cuts off at the bottom;
 *  - the place page's map card with a third band in it — the voice buttons —
 *    so the card answering «where» also held the controls for the voice;
 *  - /pick's map a 230px strip on a phone.
 *
 * The map picture itself is refused here, so this measures the frame and the
 * pins over it, which is what the layout is.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

/** The smallest clear room between any pin and the frame's sides and bottom. */
const pinRoom = (p) =>
  p.evaluate(() => {
    const frame = document.querySelector('[data-map-frame]');
    if (!frame) return null;
    const f = frame.getBoundingClientRect();
    const pins = [...frame.querySelectorAll('a[href^="/places/"], [data-count]')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0);
    if (!pins.length) return null;
    return {
      n: pins.length,
      side: Math.round(Math.min(...pins.map((r) => Math.min(r.left - f.left, f.right - r.right)))),
      foot: Math.round(Math.min(...pins.map((r) => f.bottom - r.bottom))),
      h: Math.round(f.height),
      w: Math.round(f.width),
    };
  });

const open = async (ctx, path, { bar = false } = {}) => {
  const p = await ctx.newPage();
  await p.route(/openstreetmap/, (r) => r.abort());
  await p.goto(B + path);
  if (bar) {
    const b = p.getByRole('button', { name: /اعرض الخريطة/ });
    await b.waitFor({ timeout: 10000 }).catch(() => {});
    await b.click().catch(() => {});
  }
  await p.locator('[data-map-frame] a[href^="/places/"]').first().waitFor({ timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(300);
  return p;
};

// PIN_EDGE_PX is 12; a pixel under it for rounding and the hovered scale.
const MIN_SIDE = 11;
const MIN_FOOT = 11;

console.log('\n── no pin stands on the frame\'s edge ──');
for (const [w, h] of [[390, 844], [320, 640], [1280, 800]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const phone = w < 1024;
  for (const [name, path, bar] of [
    ['/search «قهوة»', `/search/?q=${encodeURIComponent('قهوة')}`, phone],
    ['/search «بحر»', `/search/?q=${encodeURIComponent('بحر')}`, phone],
    ['/pick', '/pick/?p=kuwait-towers,souq-al-mubarakiya,marina-beach&when=tomorrow', false],
    ['a place page', '/places/kuwait-towers/', false],
  ]) {
    const p = await open(ctx, path, { bar });
    const r = await pinRoom(p);
    ok(`${name} @${w}: every pin ${MIN_SIDE}px+ from the sides and ${MIN_FOOT}px+ above the bottom`,
      r && r.side >= MIN_SIDE && r.foot >= MIN_FOOT, JSON.stringify(r));
    await p.close();
  }
  await ctx.close();
}

console.log('\n── a desktop map never outgrows the screen ──');
for (const [w, h] of [[1280, 720], [1366, 768], [1440, 900]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const p = await open(ctx, `/search/?q=${encodeURIComponent('بحر')}`);
  const box = await p.evaluate(() => {
    const r = document.querySelector('[data-map-frame]')?.getBoundingClientRect();
    return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } : null;
  });
  ok(`«بحر» @${w}×${h}: the map ends on the screen`, box && box.bottom <= h, JSON.stringify(box));
  ok(`and is still tall enough to read`, box && box.h >= 400, JSON.stringify(box));
  await ctx.close();
}

console.log('\n── the place page\'s map card is the map ──');
for (const w of [390, 1280]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const p = await open(ctx, '/places/kuwait-towers/');
  const r = await p.evaluate(() => {
    const sec = document.getElementById('map');
    const card = sec?.querySelector('.rounded-3xl');
    const voice = sec?.querySelector('[data-place-voice]');
    const speak = [...(sec?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('اسمع الاقتراح'));
    return {
      voice: !!voice,
      speakInCard: !!(card && speak && card.contains(speak)),
      speakBelowCard: !!(card && speak && speak.getBoundingClientRect().top >= card.getBoundingClientRect().bottom),
    };
  });
  ok(`@${w}: the voice buttons are under the card, not in it`, r.voice && !r.speakInCard && r.speakBelowCard, JSON.stringify(r));
  await ctx.close();
}

console.log('\n── /pick\'s map is a map on a phone, not a strip ──');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await open(ctx, '/pick/?p=kuwait-towers,souq-al-mubarakiya,marina-beach&when=tomorrow');
  const r = await pinRoom(p);
  ok('the frame is at least 280px tall at 390', r && r.h >= 280, JSON.stringify(r));
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  ✗ ${f}`); process.exit(1); }
