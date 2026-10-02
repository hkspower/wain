import { chromium } from 'playwright';

/**
 * «معالم الكويت», the slideshow under the home hero (LandmarksShow.tsx).
 *
 * Six landmarks share one box and take turns: a CSS loop crossfades them and
 * a button stops it. What can go wrong without anything looking broken:
 *
 *   - the slides that are not showing still take taps, so the link under a
 *     finger is a place the visitor cannot see (why `visibility` is keyframed
 *     with the opacity, and why this file asks the browser what is under the
 *     middle of the box at two moments of the loop);
 *   - the pause button changes its label and nothing stops;
 *   - under reduced motion every slide ends on its last frame, hidden, and the
 *     show is an empty dark box;
 *   - a caption with no background of its own, which audit:color cannot
 *     measure against a picture.
 *
 * The loop is moved with the Web Animations API (`currentTime`), not by
 * waiting: 36 seconds per assertion would make this the slowest suite here
 * and still prove only one frame.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const ORDER = ['kuwait-towers', 'liberation-tower', 'grand-mosque', 'seif-palace', 'souq-al-mubarakiya', 'marina-beach'];

async function open(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600, locale: 'ar-KW', ...opts });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${B}/`, { waitUntil: 'networkidle' });
  return { ctx, p, errors };
}

// Every slide's visibility, and which slide the middle of the box belongs to.
const state = (p) => p.evaluate(() => {
  const slides = [...document.querySelectorAll('[data-landmark]')];
  const box = slides[0].parentElement.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 3);
  return {
    shown: slides.filter((s) => getComputedStyle(s).visibility === 'visible' && +getComputedStyle(s).opacity > 0.5).map((s) => s.dataset.landmark),
    under: hit?.closest('[data-landmark]')?.dataset.landmark ?? null,
  };
});

// Put every animation of the loop at the same moment, `ms` into it.
const seek = (p, ms) => p.evaluate((t) => {
  for (const a of document.getAnimations()) {
    if (a.animationName === 'landmark-fade' || a.animationName === 'landmark-dot') {
      a.pause();
      a.currentTime = t;
    }
  }
}, ms);

console.log('\n── six landmarks, one at a time ──');
{
  const { ctx, p, errors } = await open({ width: 390, height: 844 });
  const section = p.locator('section[aria-labelledby="landmarks-h"]');
  ok('the section is there, headed «معالم الكويت»', (await p.locator('#landmarks-h').innerText()).trim() === 'معالم الكويت');
  const slugs = await section.locator('[data-landmark]').evaluateAll((els) => els.map((e) => e.dataset.landmark));
  ok('six slides, in the order the owner picked', JSON.stringify(slugs) === JSON.stringify(ORDER), JSON.stringify(slugs));
  const hrefs = await section.locator('[data-landmark]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  ok('each one is a link to its own place page', hrefs.every((h, i) => h === `/places/${ORDER[i]}/`), JSON.stringify(hrefs));

  const heroBottom = await p.locator('main section').first().evaluate((e) => e.getBoundingClientRect().bottom + scrollY);
  const showTop = await section.evaluate((e) => e.getBoundingClientRect().top + scrollY);
  ok('it sits under the hero, not on it', showTop >= heroBottom - 0.5, `${showTop} vs ${heroBottom}`);

  await section.scrollIntoViewIfNeeded();
  await seek(p, 3000);
  let s = await state(p);
  ok('3s in: only the first is showing', JSON.stringify(s.shown) === '["kuwait-towers"]', JSON.stringify(s.shown));
  ok('…and it is the one a tap would land on', s.under === 'kuwait-towers', s.under);
  await seek(p, 6000 + 3000);
  s = await state(p);
  ok('9s in: only the second is showing', JSON.stringify(s.shown) === '["liberation-tower"]', JSON.stringify(s.shown));
  ok('…and a tap lands on the second, not on the first under it', s.under === 'liberation-tower', s.under);
  await seek(p, 33000);
  s = await state(p);
  ok('33s in: the last one', JSON.stringify(s.shown) === '["marina-beach"]', JSON.stringify(s.shown));

  const kb = await section.locator('[data-landmark] img').evaluateAll((els) => els.map((e) => getComputedStyle(e).animationName));
  ok('every picture drifts, neighbours in opposite directions', kb.every((n, i) => n === (i % 2 ? 'kb-b' : 'kb-a')), JSON.stringify(kb));

  const first = await section.locator('[data-landmark] img').first().evaluate((e) => ({ w: e.naturalWidth, src: e.currentSrc }));
  ok('the first picture loads, from its generated files', first.w > 0 && /\/home\/landmarks\/kuwait-towers-[0-9a-f]{10}-\d+\.(avif|webp)$/.test(first.src), JSON.stringify(first));

  const cap = await section.locator('[data-landmark="kuwait-towers"]').getByText('أبراج الكويت', { exact: true }).evaluate((e) => {
    // Up to the slide and no further: the section around it has a sand
    // background of its own, which says nothing about what is behind the words.
    for (let n = e; n && !n.matches('[data-landmark]'); n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    }
    return null;
  });
  ok('the caption stands on a background of its own, not on the picture', cap !== null && cap !== 'rgb(255, 255, 255)', String(cap));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── it can be stopped ──');
{
  const { ctx, p } = await open({ width: 390, height: 844 });
  const btn = p.getByRole('button', { name: 'وقّف الحركة' });
  ok('a stop button, named', await btn.isVisible());
  const box = await btn.boundingBox();
  ok('it is a full-size target', box.width >= 44 && box.height >= 44, `${box.width}×${box.height}`);
  await btn.click();
  const after = p.getByRole('button', { name: 'شغّل الحركة' });
  ok('pressed, it says so and offers to start again', (await after.getAttribute('aria-pressed')) === 'true');
  const states = await p.evaluate(() => {
    const names = ['landmark-fade', 'landmark-dot', 'kb-a', 'kb-b'];
    return [...new Set(document.getAnimations().filter((a) => names.includes(a.animationName)).map((a) => a.playState))];
  });
  ok('and every animation of the show has stopped, the pictures included', JSON.stringify(states) === '["paused"]', JSON.stringify(states));
  await after.click();
  const again = await p.evaluate(() => [...new Set(document.getAnimations().filter((a) => a.animationName === 'landmark-fade').map((a) => a.playState))]);
  ok('pressed again, it runs again', JSON.stringify(again) === '["running"]', JSON.stringify(again));
  await ctx.close();
}

console.log('\n── reduced motion ──');
{
  const { ctx, p } = await open({ width: 390, height: 844 }, { reducedMotion: 'reduce' });
  await p.locator('section[aria-labelledby="landmarks-h"]').scrollIntoViewIfNeeded();
  await p.waitForTimeout(300);
  const s = await state(p);
  ok('the first landmark stays on screen — not an empty box', JSON.stringify(s.shown) === '["kuwait-towers"]', JSON.stringify(s.shown));
  ok('…and it is the one under a tap', s.under === 'kuwait-towers', s.under);
  const moving = await p.evaluate(() => document.getAnimations().filter((a) => ['landmark-fade', 'kb-a', 'kb-b'].includes(a.animationName)).length);
  ok('nothing in it moves', moving === 0, String(moving));
  await ctx.close();
}

console.log('\n── sizes ──');
for (const width of [320, 390, 1280]) {
  const { ctx, p } = await open({ width, height: 900 });
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(`${width}px: no sideways scroll`, over <= 0, `${over}px`);
  const h = await p.locator('[data-landmark]').first().evaluate((e) => e.parentElement.getBoundingClientRect().height);
  const want = width >= 1024 ? 560 : 330;
  ok(`${width}px: the box is ${want}px tall`, Math.abs(h - want) < 1, String(h));
  const pill = p.locator('[data-landmark="kuwait-towers"]').getByText('شوف المكان').filter({ visible: true });
  ok(`${width}px: one «شوف المكان» shows on the first slide`, (await pill.count()) === 1, String(await pill.count()));
  await ctx.close();
}

console.log('\n── a tap opens the place ──');
{
  const { ctx, p } = await open({ width: 390, height: 844 });
  await p.locator('#landmarks-h').scrollIntoViewIfNeeded();
  await seek(p, 2000);
  // Soft: on a build where another slide covers this one the tap times out,
  // and an uncaught throw here would end the run with no count at all.
  await p.locator('[data-landmark="kuwait-towers"]').tap({ timeout: 5000 }).catch(() => {});
  await p.waitForURL('**/places/kuwait-towers/**', { timeout: 5000 }).catch(() => {});
  ok('tapping the slide on screen lands on its page', p.url().includes('/places/kuwait-towers'), p.url());
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
