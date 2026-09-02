import { chromium } from 'playwright';

/**
 * The pins, on a phone and on a desktop.
 *
 * They used to answer only to `mouseenter`, which meant a place's name was
 * readable on a desktop and nowhere else: on a phone the tap fired the link
 * immediately, so the label the map is built around had no moment in which it
 * could ever be seen. "The map and the list stay in step" was true of mice
 * only, on a site whose traffic is almost entirely phones.
 *
 * These are the two behaviours that must not drift back together: one tap on a
 * touch device selects, and one click on a desktop still opens.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const SEARCH = '/search/?q=' + encodeURIComponent('قهوة');

async function open({ touch }) {
  const ctx = await browser.newContext(
    touch
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW' }
      : { viewport: { width: 1200, height: 900 }, locale: 'ar-KW' }
  );
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(B + SEARCH, { waitUntil: 'networkidle' });
  const map = p.locator('section[aria-labelledby="search-map-heading"]');
  await map.waitFor({ timeout: 8000 });
  return { ctx, p, map, errors };
}

console.log('\n── the map is there, with a pin per result ──');
{
  const { ctx, p, map, errors } = await open({ touch: false });
  const pins = map.locator('a[href^="/places/"]');
  const n = await pins.count();
  ok('pins are drawn', n > 0, `${n} pins`);
  ok('every pin names its place for a screen reader',
    (await pins.first().getAttribute('aria-label'))?.includes('—'),
    await pins.first().getAttribute('aria-label'));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  void p;
  await ctx.close();
}

console.log('\n── on a phone, the first tap selects instead of leaving ──');
{
  const { ctx, p, map } = await open({ touch: true });
  const pin = map.locator('a[href^="/places/"]').first();
  const href = await pin.getAttribute('href');
  await pin.click();
  await p.waitForTimeout(400);
  ok('it did not navigate away', p.url().includes('/search'), p.url());
  ok('the pin reports itself as the current one', (await pin.getAttribute('aria-current')) === 'true');
  // The callout is the entire reason the first tap is spent this way.
  const callout = map.locator('a[aria-current="true"]').locator('xpath=..');
  ok('the callout carries the name', (await callout.textContent()).trim().length > 0);

  console.log('\n── and the second tap opens it ──');
  await pin.click();
  await p.waitForURL('**' + href + '**', { timeout: 8000 });
  ok('the place page opens on the second tap', p.url().includes(href), p.url());
  await ctx.close();
}

console.log('\n── on a desktop, one click still opens ──');
{
  const { ctx, p, map } = await open({ touch: false });
  const pin = map.locator('a[href^="/places/"]').first();
  const href = await pin.getAttribute('href');
  await pin.click();
  await p.waitForURL('**' + href + '**', { timeout: 8000 });
  ok('no second click is asked for', p.url().includes(href), p.url());
  await ctx.close();
}

console.log('\n── hovering still selects, for the mouse ──');
{
  const { ctx, p, map } = await open({ touch: false });
  const pin = map.locator('a[href^="/places/"]').first();
  ok('nothing is selected to begin with', (await map.locator('[aria-current="true"]').count()) === 0);
  await pin.hover();
  await p.waitForTimeout(300);
  ok('hovering selects it', (await pin.getAttribute('aria-current')) === 'true');
  await ctx.close();
}

console.log('\n── the pins are not all the same colour any more ──');
{
  // A map of eight kinds of place used to be one near-black dot repeated. The
  // tint comes from the category, so a mixed result set has to show more than
  // one — and this check is worth having because a wrong Record key would fall
  // back to nothing and quietly return the whole map to one colour.
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'ar-KW' });
  const p = await ctx.newPage();
  await p.goto(B + '/search/?q=' + encodeURIComponent('الكويت'), { waitUntil: 'networkidle' });
  const map = p.locator('section[aria-labelledby="search-map-heading"]');
  await map.waitFor({ timeout: 8000 });
  const colours = await map.locator('a[href^="/places/"]').evaluateAll(
    (els) => [...new Set(els.map((e) => getComputedStyle(e).backgroundColor))]
  );
  ok('a mixed result set shows more than one pin colour', colours.length > 1, colours.join(' | '));
  ok('and none of them is transparent — every category has a tone',
    !colours.some((c) => /rgba\(0, 0, 0, 0\)/.test(c)), colours.join(' | '));
  await ctx.close();
}

console.log('\n── the pin points at its own coordinate ──');
{
  // A disc centred on the point is mute about WHICH point — a crosshair drawn
  // at the true position vanishes under it. The pointer says it, and the whole
  // claim rests on the tip landing where the projection put it.
  //
  // This is exactly the assertion that caught the two things that were wrong:
  // reserving the nose's SIDE rather than half its diagonal left the tip 4.6px
  // short, and the head's 2px border — which an absolutely positioned child is
  // laid out against — took another 1.4px.
  const { ctx, map } = await open({ touch: false });
  const geom = await map.evaluate((section) => {
    const box = section.querySelector('[data-map-frame]');
    const br = box.getBoundingClientRect();
    return [...box.children]
      .filter((c) => c.style.left && c.style.top)
      .slice(0, 6)
      .map((pin) => {
        const wantedY = br.top + (parseFloat(pin.style.top) / 100) * br.height;
        const wantedX = br.left + (parseFloat(pin.style.left) / 100) * br.width;
        const a = pin.querySelector('a');
        const nose = a.querySelector('span[aria-hidden]');
        const nr = nose.getBoundingClientRect();
        const ar = a.getBoundingClientRect();
        return {
          dy: +(nr.bottom - wantedY).toFixed(2),
          dx: +((nr.left + nr.right) / 2 - wantedX).toFixed(2),
          headAbove: +(wantedY - ar.top).toFixed(1),
        };
      });
  });
  const worstY = Math.max(...geom.map((g) => Math.abs(g.dy)));
  const worstX = Math.max(...geom.map((g) => Math.abs(g.dx)));
  ok(`the tip sits on the coordinate, within a pixel (worst ${worstY}px)`, worstY <= 1.5,
    geom.map((g) => g.dy).join(', '));
  ok(`and is centred on it horizontally (worst ${worstX}px)`, worstX <= 1.5,
    geom.map((g) => g.dx).join(', '));
  // If this ever goes negative the pin has stopped standing above its point,
  // which means the -translate-y-full was lost and every pin is half a pin low.
  ok('the head stands above the point, not on top of it',
    geom.every((g) => g.headAbove > 20), geom.map((g) => g.headAbove).join(', '));
  await ctx.close();
}

console.log('\n── the frame on screen is the frame the bbox was built for ──');
{
  /**
   * The invariant the whole map rests on, checked where it actually matters.
   *
   * map-frame.test.mjs proves fitFrame RETURNS a bbox matching its aspect. It
   * cannot see whether the aspect then survives to the screen: the shape is
   * applied as an inline `aspect-ratio`, and any container that constrains
   * height — a max-height, a flex parent, an image beside it — would leave the
   * bbox and the box disagreeing. The embed fits the bbox to whatever box it
   * is given, so a disagreement of even a few percent slides every overlaid
   * pin off its place, silently and plausibly.
   *
   * So this measures the rendered rectangle against the bbox in the URL, on
   * real pages at both widths.
   */
  const rad = (d) => (d * Math.PI) / 180;
  const mercY = (l) => Math.log(Math.tan(Math.PI / 4 + rad(l) / 2));
  const probe = () =>
    [...document.querySelectorAll('[data-map-frame]')].map((box) => {
      const r = box.getBoundingClientRect();
      const ifr = box.querySelector('iframe');
      const pins = [...box.children].filter((c) => c.style.left && c.style.top);
      return {
        rendered: r.height > 0 ? r.width / r.height : null,
        bbox: ifr ? new URL(ifr.src).searchParams.get('bbox') : null,
        outside: pins.filter((c) => {
          const x = parseFloat(c.style.left), y = parseFloat(c.style.top);
          return x < 0 || x > 100 || y < 0 || y > 100;
        }).length,
        pins: pins.length,
      };
    });

  // A place page and a search page, on a phone and a desktop — the four shapes
  // the frame is actually asked to take.
  let worst = 0, where = null, checked = 0, invalid = [], escaped = 0;
  for (const touch of [true, false]) {
    const ctx = await browser.newContext(
      touch
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW' }
        : { viewport: { width: 1200, height: 900 }, locale: 'ar-KW' }
    );
    const p = await ctx.newPage();
    for (const url of ['/places/kuwait-towers/', '/places/khiran/', SEARCH]) {
      await p.goto(B + url, { waitUntil: 'networkidle' });
      for (const f of await p.evaluate(probe)) {
        if (!f.bbox) continue;
        checked++;
        escaped += f.outside;
        const [W, S, E, N] = f.bbox.split(',').map(Number);
        if (![W, S, E, N].every(Number.isFinite) || W < -180 || E > 180 || S < -90 || N > 90)
          invalid.push(`${url}: ${f.bbox}`);
        const err = Math.abs(f.rendered - (rad(E) - rad(W)) / (mercY(N) - mercY(S))) / f.rendered;
        if (err > worst) { worst = err; where = `${url} @${touch ? 390 : 1200}px`; }
      }
    }
    await ctx.close();
  }
  ok(`the rendered frame matches its bbox on all ${checked} maps (worst ${(worst * 100).toFixed(3)}%)`,
    worst < 0.01, `${(worst * 100).toFixed(3)}% at ${where}`);
  ok('every bbox is a real place on Earth', invalid.length === 0, invalid.join('; '));
  ok('and no pin is drawn outside its frame', escaped === 0, `${escaped} escaped`);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
