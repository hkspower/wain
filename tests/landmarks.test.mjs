import { chromium } from 'playwright';

/**
 * «معالم الكويت» — the owner's picks on the 3 October canvas, built before
 * their pictures exist:
 *
 *   - the slideshow under the home hero, direction A «القصة»: the picture edge
 *     to edge, progress bars across its top that are also the way to jump, the
 *     name over a dark fade, a pause button with a word, swipe;
 *   - the five «معالم الكويت» cards carry their picture in the 56px band the
 *     icon sat in, everywhere a card appears;
 *   - the top of those five places' pages is the picture, whole, at 3:2;
 *   - every generated picture is tagged «صورة توضيحية» (a solid dark chip).
 *
 * Two builds, told apart by the marker a preview build puts on <html>:
 *
 *   normal   the pictures are still drawn stand-ins, so NONE of it shows —
 *            no slideshow, icons on the cards, drawings on the page tops, and
 *            not one request for a picture file;
 *   preview  NEXT_PUBLIC_SHOW_STANDINS=1 npm run build — all of it shows, on
 *            the stand-ins, and is checked here.
 *
 * Every read is soft: a locator that matches nothing makes `.evaluate()` wait
 * 30s and throw, which ends the run and silently skips every section after it
 * — the coverage hole CLAUDE.md records four times.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const ORDER = ['kuwait-towers', 'liberation-tower', 'grand-mosque', 'seif-palace', 'souq-al-mubarakiya', 'marina-beach'];
const SLOTS = ['kuwait-towers', 'liberation-tower', 'seif-palace', 'al-hamra-tower', 'sheikh-jaber-causeway'];

async function open(path, { width = 390, height = 844, touch = width < 600, ...opts } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch, locale: 'ar-KW', ...opts });
  const p = await ctx.newPage();
  const errors = [];
  const pictures = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('request', (r) => { if (r.url().includes('/home/landmarks/')) pictures.push(r.url()); });
  await p.route('**openstreetmap.org**', (r) => r.abort());
  await p.goto(`${B}${path}`, { waitUntil: 'networkidle' });
  return { ctx, p, errors, pictures };
}

/** A read that cannot throw: `fn(first match, arg)`, or null when nothing matches. */
const one = (p, sel, fn, arg) =>
  p.locator(sel).evaluateAll((els, [src, a]) => (els[0] ? new Function('return ' + src)()(els[0], a) : null), [fn.toString(), arg]);

const preview = await (async () => {
  const { ctx, p } = await open('/');
  const marked = (await p.locator('html[data-preview="stand-ins"]').count()) > 0;
  await ctx.close();
  return marked;
})();
console.log(`\n(${preview ? 'preview build — the stand-ins are shown, marked' : 'normal build — the stand-ins must not show anywhere'})`);

if (!preview) {
  console.log('\n── a normal build shows none of it ──');
  {
    const { ctx, p, pictures, errors } = await open('/');
    ok('no slideshow under the hero', (await p.locator('section[aria-labelledby="landmarks-h"]').count()) === 0);
    ok('no «صورة توضيحية» tag on the home page', (await p.locator('[data-illustrative]').count()) === 0);
    const kt = await one(p, 'main a[href="/places/kuwait-towers/"] [data-card-band]', (e) => e.getAttribute('data-card-band'));
    ok('أبراج الكويت\'s card on the home rail keeps its icon', kt === 'icon', String(kt));
    ok('and the page asks for no picture file', pictures.length === 0, pictures.slice(0, 2).join(' '));
    ok('no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  for (const path of ['/explore/', '/search/']) {
    const { ctx, p, pictures } = await open(path);
    const bands = await p.locator('[data-card-band]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-band')));
    ok(`${path}: every card shows its icon`, bands.length > 0 && bands.every((b) => b === 'icon'), `${bands.length} cards, ${bands.filter((b) => b !== 'icon').length} not icons`);
    ok(`${path}: no picture file is asked for`, pictures.length === 0, pictures.slice(0, 2).join(' '));
    await ctx.close();
  }
  for (const slug of SLOTS) {
    const { ctx, p, pictures } = await open(`/places/${slug}/`);
    const hero = await one(p, '[data-place-hero]', (e) => {
      const b = e.getBoundingClientRect();
      return { kind: e.getAttribute('data-hero-kind'), ratio: b.width / b.height };
    });
    ok(`${slug}: the page top is still its drawing, at 18:5`, hero?.kind === 'drawing' && Math.abs(hero.ratio - 3.6) < 0.02, JSON.stringify(hero));
    ok(`${slug}: no tag, no picture file`, (await p.locator('[data-illustrative]').count()) === 0 && pictures.length === 0, pictures.slice(0, 2).join(' '));
    await ctx.close();
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
}

/* ═══════════════════════ the preview build ═══════════════════════ */

// The slideshow's state, read in one go.
const show = (p) => p.evaluate(() => {
  const slides = [...document.querySelectorAll('[data-landmark]')];
  if (!slides.length) return null;
  const box = document.querySelector('[data-landmark-box]').getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  const segs = [...document.querySelectorAll('[aria-label="اختر معلم"] button')];
  return {
    order: slides.map((s) => s.dataset.landmark),
    on: slides.filter((s) => s.classList.contains('is-on')).map((s) => s.dataset.landmark),
    inert: slides.filter((s) => s.inert).length,
    under: hit?.closest('[data-landmark]')?.dataset.landmark ?? null,
    current: segs.findIndex((b) => b.getAttribute('aria-current') === 'true'),
    fill: document.getAnimations().filter((a) => a.animationName === 'landmark-fill').map((a) => a.playState),
  };
});
// End the bar that is running, which is what moves the show on.
const finishBar = (p) => p.evaluate(() => {
  for (const a of document.getAnimations()) if (a.animationName === 'landmark-fill') a.finish();
});

console.log('\n── the slideshow: six, one at a time ──');
{
  const { ctx, p, errors } = await open('/');
  // The box itself, not its heading: the middle of the box has to be on the
  // screen for elementFromPoint to say what a tap there would land on.
  await p.locator('[data-landmark-box]').scrollIntoViewIfNeeded().catch(() => {});
  let s = await show(p);
  ok('the section is there, headed «معالم الكويت»', s !== null && (await p.locator('#landmarks-h').innerText().catch(() => '')).trim() === 'معالم الكويت');
  ok('six slides, in the order the owner kept', JSON.stringify(s?.order) === JSON.stringify(ORDER), JSON.stringify(s?.order));
  const hrefs = await p.locator('[data-landmark]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  ok('each one links to its own place page', hrefs.every((h, i) => h === `/places/${ORDER[i]}/`), JSON.stringify(hrefs));
  ok('the first is on screen, and the five others are inert', JSON.stringify(s?.on) === '["kuwait-towers"]' && s?.inert === 5, JSON.stringify(s));
  ok('…and the middle of the box belongs to it', s?.under === 'kuwait-towers', String(s?.under));
  ok('its bar is the one running', s?.current === 0 && s?.fill.length === 1 && s.fill[0] === 'running', JSON.stringify(s));

  await finishBar(p);
  await p.waitForTimeout(150);
  s = await show(p);
  ok('when its bar fills, the show moves on to the second', JSON.stringify(s?.on) === '["liberation-tower"]' && s?.current === 1, JSON.stringify(s));
  ok('…and a tap now lands on the second, not on the first under it', s?.under === 'liberation-tower', String(s?.under));

  await p.locator('[aria-label="اختر معلم"] button').nth(4).click({ timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(150);
  s = await show(p);
  ok('tapping the fifth bar jumps to the fifth', JSON.stringify(s?.on) === '["souq-al-mubarakiya"]' && s?.current === 4, JSON.stringify(s));
  const label = await one(p, '[aria-label="اختر معلم"] button[aria-current="true"]', (e) => e.getAttribute('aria-label'));
  ok('…and the bar says where it is, in words', label === '٥ من ٦، سوق المباركية', String(label));

  const first = await one(p, '[data-landmark="kuwait-towers"] img', (e) => ({ w: e.naturalWidth, src: e.currentSrc, alt: e.getAttribute('alt') }));
  ok('the first picture loaded, from its generated files', first?.w > 0 && /\/home\/landmarks\/kuwait-towers-[0-9a-f]{10}-(480|960|1440)\.(avif|webp)$/.test(first.src), JSON.stringify(first));
  ok('…with an empty alt: the link names the place', first?.alt === '', JSON.stringify(first));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── it can be stopped ──');
{
  const { ctx, p } = await open('/');
  const btn = p.getByRole('button', { name: 'وقّف العرض' });
  ok('a stop button, with a word on it', (await btn.count()) === 1 && (await btn.innerText().catch(() => '')).includes('وقّف'));
  const box = await btn.boundingBox().catch(() => null);
  ok('a full-size target for a finger', box && box.height >= 40, JSON.stringify(box));
  await btn.click({ timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(100);
  let s = await show(p);
  ok('pressed, the running bar stops', s?.fill.length === 1 && s.fill[0] === 'paused', JSON.stringify(s?.fill));
  const drift = await p.evaluate(() => [...new Set(document.getAnimations().filter((a) => a.animationName === 'kb-a' || a.animationName === 'kb-b').map((a) => a.playState))]);
  ok('…and so does the picture\'s drift', JSON.stringify(drift) === '["paused"]', JSON.stringify(drift));
  ok('…and the button now offers «كمّل»', (await p.getByRole('button', { name: 'كمّل العرض' }).count()) === 1);
  await p.getByRole('button', { name: 'كمّل العرض' }).click({ timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(100);
  s = await show(p);
  ok('pressed again, it runs again', s?.fill[0] === 'running', JSON.stringify(s?.fill));
  await ctx.close();
}
{
  const { ctx, p } = await open('/', { width: 1280, height: 800, touch: false });
  await p.locator('[data-landmark-box]').scrollIntoViewIfNeeded().catch(() => {});
  await p.locator('[data-landmark-box]').hover({ timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(100);
  const s = await show(p);
  ok('a mouse resting on it holds it', s?.fill[0] === 'paused', JSON.stringify(s?.fill));
  await p.mouse.move(5, 5);
  await p.waitForTimeout(100);
  ok('…and lets go when it leaves', (await show(p))?.fill[0] === 'running');
  await ctx.close();
}

console.log('\n── swipe ──');
{
  const { ctx, p } = await open('/', { width: 1280, height: 800, touch: false });
  // On a computer the hero is two screens tall: a drag at the box's page
  // position would land below the window and move nothing.
  await p.locator('[data-landmark-box]').scrollIntoViewIfNeeded().catch(() => {});
  const box = await p.locator('[data-landmark-box]').boundingBox().catch(() => null);
  const y = box ? box.y + box.height / 2 : 0;
  const drag = async (from, to) => {
    await p.mouse.move(from, y);
    await p.mouse.down();
    await p.mouse.move((from + to) / 2, y, { steps: 4 });
    await p.mouse.move(to, y, { steps: 4 });
    await p.mouse.up();
    await p.waitForTimeout(200);
  };
  if (box) {
    await drag(box.x + box.width * 0.3, box.x + box.width * 0.7);
    const moved = JSON.stringify((await show(p))?.on);
    ok('a drag towards the right moves on (the row reads right to left)', moved === '["liberation-tower"]', moved);
    ok('…and does not open the place it started on', !p.url().includes('/places/'), p.url());
    // From the second, so «goes back» cannot pass by never having moved.
    await drag(box.x + box.width * 0.7, box.x + box.width * 0.3);
    const back = JSON.stringify((await show(p))?.on);
    ok('a drag towards the left goes back', moved === '["liberation-tower"]' && back === '["kuwait-towers"]', back);
    ok('…still without opening it', !p.url().includes('/places/'), p.url());
  } else ok('the box is there to drag', false);
  const action = await one(p, '[data-landmark-box]', (e) => getComputedStyle(e).touchAction);
  ok('an up-and-down drag is left to the page (touch-action: pan-y)', action === 'pan-y', String(action));
  await ctx.close();
}
{
  // A real finger: touch events through CDP, so the pointer events are a touch's.
  const { ctx, p } = await open('/');
  const cdp = await ctx.newCDPSession(p);
  await p.locator('[data-landmark-box]').scrollIntoViewIfNeeded().catch(() => {});
  const box = await p.locator('[data-landmark-box]').boundingBox().catch(() => null);
  if (box) {
    const y = box.y + box.height / 2;
    const pts = (x) => [{ x, y }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(box.x + 100) });
    for (const x of [140, 190, 240, 290]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(box.x + x) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(250);
    ok('a finger swiping right on a phone moves on', JSON.stringify((await show(p))?.on) === '["liberation-tower"]', JSON.stringify((await show(p))?.on));
    ok('…and lands on no place page', !p.url().includes('/places/'), p.url());
  } else ok('the box is there to swipe', false);
  await ctx.close();
}

console.log('\n── reduced motion ──');
{
  const { ctx, p } = await open('/', { reducedMotion: 'reduce' });
  await p.locator('[data-landmark-box]').scrollIntoViewIfNeeded().catch(() => {});
  await p.waitForTimeout(700);
  const s = await show(p);
  ok('the first landmark stays on screen — not an empty box, not a spin through all six', JSON.stringify(s?.on) === '["kuwait-towers"]' && s?.under === 'kuwait-towers', JSON.stringify(s));
  ok('nothing in it runs: no bar, no drift', (await p.evaluate(() => document.getAnimations().filter((a) => ['landmark-fill', 'kb-a', 'kb-b'].includes(a.animationName)).length)) === 0);
  const full = await one(p, '[aria-label="اختر معلم"] button[aria-current="true"] .landmark-seg > span', (e) => getComputedStyle(e).transform);
  ok('its bar stands full, to say which one it is', full === 'none' || /^matrix\(1, 0, 0, 1/.test(String(full)), String(full));
  // A tap, not a click: Playwright's click is a mouse even on a phone, and a
  // mouse resting on the box holds the show — which would hide the very spin
  // this is here to catch. A bar tapped under reduced motion starts no
  // animation; if one ran, the global rule would end it at once and the show
  // would race through all six.
  // Counted, not sampled once: a show racing through six slides lands on the
  // one asked for one time in six, and a single read would pass it.
  await p.evaluate(() => {
    window.__fillEnds = 0;
    document.addEventListener('animationend', (e) => { if (e.animationName === 'landmark-fill') window.__fillEnds++; }, true);
  });
  await p.locator('[aria-label="اختر معلم"] button').nth(2).tap({ timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(600);
  const after = JSON.stringify((await show(p))?.on);
  const ends = await p.evaluate(() => window.__fillEnds);
  ok('the bars still work, and nothing moves on after a tap', after === '["grand-mosque"]' && ends === 0, `${after}, ${ends} bar(s) ended`);
  await ctx.close();
}

console.log('\n── the tag, the words and the shape, at four widths ──');
for (const [width, height] of [[320, 640], [390, 844], [768, 1024], [1280, 800], [1920, 1080]]) {
  const { ctx, p } = await open('/', { width, height, touch: width < 600 });
  await p.locator('[data-landmark-box]').scrollIntoViewIfNeeded().catch(() => {});
  const m = await one(p, '[data-landmark-box]', (e) => {
    const b = e.getBoundingClientRect();
    const on = e.querySelector('[data-landmark].is-on');
    const tag = on?.querySelector('[data-illustrative]');
    const ts = tag && getComputedStyle(tag);
    // The drift at its far end — scaled up the most — before the preview's
    // flag is measured: inside the drifting picture, it was carried half out.
    for (const a of document.getAnimations()) if (['kb-a', 'kb-b'].includes(a.animationName)) a.currentTime = 6900;
    const flag = on?.querySelector('[data-stand-in]')?.getBoundingClientRect();
    return {
      w: b.width, h: b.height, over: document.documentElement.scrollWidth - innerWidth,
      tag: tag ? { bg: ts.backgroundColor, color: ts.color, size: parseFloat(ts.fontSize), text: tag.textContent.trim(), hidden: tag.getAttribute('aria-hidden') } : null,
      flag: flag ? { inside: flag.left >= b.left - 0.5 && flag.right <= b.right + 0.5 && flag.top >= b.top && flag.bottom <= b.bottom, left: flag.left - b.left, right: b.right - flag.right } : null,
    };
  });
  const want = width < 640 ? 6 / 5 : 2;
  ok(`${width}px: the box is ${width < 640 ? '6:5' : '2:1'}`, m && Math.abs(m.w / m.h - want) < 0.01, JSON.stringify(m && { w: m.w, h: m.h }));
  if (width >= 1152) ok(`${width}px: inside the page's width, not edge to edge`, m && m.w <= 1120.5, String(m?.w));
  ok(`${width}px: no sideways scroll`, m && m.over <= 0, String(m?.over));
  ok(`${width}px: «صورة توضيحية» on the slide, a solid dark chip of 11px or more`,
    m?.tag?.text === 'صورة توضيحية' && m.tag.bg === 'rgb(20, 18, 15)' && m.tag.color === 'rgb(255, 255, 255)' && m.tag.size >= 11 && m.tag.hidden === 'true', JSON.stringify(m?.tag));
  ok(`${width}px: the preview's «رسم مؤقت» stays whole in the box, even at the far end of the drift`, m?.flag?.inside === true, JSON.stringify(m?.flag));
  await ctx.close();
}

console.log('\n── a tap opens the place ──');
{
  const { ctx, p } = await open('/');
  await p.locator('[data-landmark-box]').scrollIntoViewIfNeeded().catch(() => {});
  const box = await p.locator('[data-landmark-box]').boundingBox().catch(() => null);
  if (box) await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.6).catch(() => {});
  await p.waitForURL('**/places/kuwait-towers/**', { timeout: 5000 }).catch(() => {});
  ok('tapping the slide on screen lands on its page', p.url().includes('/places/kuwait-towers'), p.url());
  await ctx.close();
}

console.log('\n── the cards: the picture in the band the icon sat in ──');
{
  const { ctx, p } = await open('/explore/');
  const bands = await p.locator('[data-card-band]').evaluateAll((els) => els.map((e) => ({
    slug: e.closest('a')?.getAttribute('href')?.split('/')[2], kind: e.getAttribute('data-card-band'),
  })));
  const pics = bands.filter((b) => b.kind === 'picture');
  ok('/explore: the five «معالم الكويت» cards carry their picture', JSON.stringify(pics.map((b) => b.slug).sort()) === JSON.stringify([...SLOTS].sort()), JSON.stringify(pics.map((b) => b.slug)));
  ok('…and the other 47 keep their icon', bands.filter((b) => b.kind === 'icon').length === 47, String(bands.filter((b) => b.kind === 'icon').length));
  // Each measured on screen: a card off it is skipped by content-visibility
  // (.card-defer), and what it reports there is its placeholder, not its band.
  const heights = [];
  for (const slug of [...SLOTS, 'souq-al-mubarakiya', 'al-shaheed-park']) {
    const band = p.locator(`a[href="/places/${slug}/"] [data-card-band]`);
    await band.scrollIntoViewIfNeeded().catch(() => {});
    heights.push(Math.round(((await band.boundingBox().catch(() => null))?.height ?? 0) * 10) / 10);
  }
  ok('…in the same 56px band as an icon', heights.every((h) => Math.abs(h - 56) < 0.5), JSON.stringify(heights));
  await p.evaluate(() => scrollTo(0, 0));
  const row = await p.evaluate(() => {
    const card = document.querySelector('a[href="/places/kuwait-towers/"]');
    const r = card.getBoundingClientRect();
    const mates = [...document.querySelectorAll('a[href^="/places/"]')].map((a) => a.getBoundingClientRect()).filter((b) => Math.abs(b.top - r.top) < 1);
    return { h: r.height, mates: mates.map((b) => b.height) };
  });
  ok('…so its card is exactly as tall as the one beside it', row.mates.length >= 2 && row.mates.every((h) => Math.abs(h - row.h) < 0.5), JSON.stringify(row));
  const card = await one(p, 'a[href="/places/kuwait-towers/"] [data-card-band]', (e) => {
    const tag = e.querySelector('[data-illustrative]');
    const chip = e.querySelector('[aria-label^="التقييم"]');
    const img = e.querySelector('img');
    const a = tag?.getBoundingClientRect();
    const b = chip?.getBoundingClientRect();
    const overlap = a && b ? !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top) : null;
    return { tag: tag?.textContent.trim(), bg: tag && getComputedStyle(tag).backgroundColor, chip: !!chip, overlap, alt: img?.getAttribute('alt'), loading: img?.getAttribute('loading') };
  });
  ok('…tagged «صورة توضيحية», a solid dark chip', card?.tag === 'صورة توضيحية' && card.bg === 'rgb(20, 18, 15)', JSON.stringify(card));
  ok('…not over the rating, which stays where it was', card?.chip === true && card.overlap === false, JSON.stringify(card));
  ok('…with an empty alt and a lazy load', card?.alt === '' && card.loading === 'lazy', JSON.stringify(card));
  await ctx.close();
}
{
  const { ctx, p } = await open('/');
  const rail = await p.locator('main a[href^="/places/"] [data-card-band]').evaluateAll((els) => Object.fromEntries(els.map((e) => [e.closest('a').getAttribute('href').split('/')[2], e.getAttribute('data-card-band')])));
  ok('the home rail: أبراج الكويت\'s card has its picture', rail['kuwait-towers'] === 'picture', JSON.stringify(rail));
  ok('…while the souq and the beach, in the slideshow but not the category, keep their icon', rail['souq-al-mubarakiya'] === 'icon' && rail['marina-beach'] === 'icon', JSON.stringify(rail));
  await ctx.close();
}
{
  const { ctx, p } = await open('/places/liberation-tower/');
  const similar = await p.locator('section:has(h2:text("أماكن مشابهة")) [data-card-band]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-band')));
  ok('«أماكن مشابهة» on a landmark\'s page shows the pictures too', similar.length === 3 && similar.every((b) => b === 'picture'), JSON.stringify(similar));
  await ctx.close();
}
{
  const { ctx, p } = await open('/search/');
  const kt = await one(p, 'main a[href="/places/kuwait-towers/"] [data-card-band]', (e) => e.getAttribute('data-card-band'));
  ok('/search\'s picks show it', kt === 'picture', String(kt));
  await ctx.close();
}
{
  const { ctx, p } = await open('/salem/');
  const box = p.locator('#salem-q');
  await box.fill('أبراج الكويت', { timeout: 5000 }).catch(() => {});
  await box.press('Enter').catch(() => {});
  await p.locator('[role="log"] [data-card-band]').first().waitFor({ timeout: 12000 }).catch(() => {});
  const bands = await p.locator('[role="log"] a[href="/places/kuwait-towers/"] [data-card-band]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-band')));
  ok('…and so do سالم\'s answers', bands.length > 0 && bands.every((b) => b === 'picture'), JSON.stringify(bands));
  await ctx.close();
}

console.log('\n── the top of a landmark\'s page: the picture, whole ──');
for (const [width, height] of [[390, 844], [1280, 800]]) {
  const { ctx, p } = await open('/places/liberation-tower/', { width, height, touch: width < 600 });
  const h = await one(p, '[data-place-hero]', (e) => {
    const b = e.getBoundingClientRect();
    const img = e.querySelector('img');
    const h1 = document.querySelector('h1').getBoundingClientRect();
    return {
      kind: e.getAttribute('data-hero-kind'), w: b.width, h: b.height,
      alt: img?.getAttribute('alt'), loading: img?.getAttribute('loading'), priority: img?.getAttribute('fetchpriority'),
      loaded: img?.complete && img.naturalWidth > 0, tagged: !!e.querySelector('[data-illustrative]'), h1Bottom: h1.bottom,
    };
  });
  ok(`${width}px: the hero holds the picture`, h?.kind === 'picture' && h.loaded, JSON.stringify(h));
  ok(`${width}px: at 3:2, no wider than 576`, h && Math.abs(h.w / h.h - 1.5) < 0.01 && h.w <= 576.5, JSON.stringify(h && { w: h.w, h: h.h }));
  ok(`${width}px: tagged, its alt saying what it is, and loaded first`, h?.tagged && /^(صورة توضيحية: |رسم مؤقت: )/.test(h.alt) && h.loading === 'eager' && h.priority === 'high', JSON.stringify(h));
  ok(`${width}px: the name is still on the first screen`, h && h.h1Bottom <= height, String(h?.h1Bottom));
  await ctx.close();
}
{
  const { ctx, p } = await open('/places/grand-mosque/');
  const kind = await one(p, '[data-place-hero]', (e) => e.getAttribute('data-hero-kind'));
  ok('the mosque — in the slideshow, not the category — keeps its drawing', kind === 'drawing', String(kind));
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
