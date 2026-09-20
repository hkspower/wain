import { chromium } from 'playwright';

/**
 * Kuwait by area — the page, and the filter it opens.
 *
 * Two things are worth proving here and they are different. The first is that
 * /areas draws every area the catalogue actually uses, which `audit:areas`
 * already holds at the data level; this asks the rendered page, because an
 * audit that reads a module cannot see a card that failed to render.
 *
 * The second is the one that can rot quietly: **an area card must open onto
 * that area and nothing else.** `?area=` is an exact match on `areaAr`, not a
 * search for its name, and the difference is invisible until it is wrong —
 * «شرق» as free text also matches «سوق شرق», which is in مدينة الكويت. A
 * filter that silently includes one place from somewhere else looks exactly
 * like a filter that works.
 */

const B = process.env.WAIN_URL || 'http://localhost:4192';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

/** Neither the map frame nor the font CDN is reachable from CI, and nothing
 *  measured here needs them; without this `networkidle` waits for timeouts. */
const offline = (ctx) =>
  ctx.route('**', (route) => (route.request().url().startsWith(B) ? route.continue() : route.abort()));

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar-KW' });
await ctx.addInitScript(() => { navigator.vibrate = () => true; });
await offline(ctx);
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));

const visit = async (route) => {
  await p.goto(B + route, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(500);
};

console.log('\n── the page ──');
await visit('/areas/');
let body = await p.textContent('body');
ok('it exists and is titled مناطق الكويت', body.includes('مناطق الكويت'));
const cards = p.locator('a[href^="/explore/?area="]');
const cardCount = await cards.count();
ok('every area has a card', cardCount === 21, `${cardCount} cards`);
ok('the areas people actually name are on it',
  ['السالمية', 'مدينة الكويت', 'حولي', 'الفحيحيل', 'شارع الخليج'].every((a) => body.includes(a)),
  body.slice(0, 200));

console.log('\n── each card carries a drawing and a count ──');
// The band is never empty: photograph → the hero place's own drawing → its
// category's. There is no photograph of any Kuwaiti area that this project can
// license (see photos.ts), so today every one of these is the third or second
// rung — which must still render, or the grid is 21 coloured rectangles.
const art = await p.locator('a[href^="/explore/?area="] svg, a[href^="/explore/?area="] img').count();
ok('every card has art', art >= cardCount, `${art} for ${cardCount} cards`);
const firstCard = await cards.first().textContent();
ok('and a count in Arabic digits', /[٠-٩]/.test(firstCard), firstCard);

console.log('\n── a card opens onto its own area, exactly ──');
// حولي holds 2 and شرق holds 2, and شرق is the one that catches a name-search
// pretending to be a filter: «سوق شرق» is in مدينة الكويت.
for (const [id, name, expected] of [['hawally', 'حولي', 2], ['sharq', 'شرق', 2], ['salmiya', 'السالمية', 9]]) {
  await visit(`/explore/?area=${id}`);
  const results = await p.locator('a[href^="/places/"]').count();
  ok(`?area=${id} shows exactly its ${expected}`, results === expected, `${results} results`);
  const chip = await p.textContent('body');
  ok(`and says «${name}» on screen`, chip.includes(name));
}

console.log('\n── the filter can be seen and undone ──');
await visit('/explore/?area=hawally');
const clear = p.locator('button:has-text("شوف كل المناطق")');
ok('there is a way out of it', (await clear.count()) === 1);
await clear.click();
await p.waitForTimeout(400);
ok('and it gives the whole catalogue back',
  (await p.locator('a[href^="/places/"]').count()) === 52,
  `${await p.locator('a[href^="/places/"]').count()} results`);
ok('the chip goes with it', (await clear.count()) === 0);

console.log('\n── an area nobody has heard of is not an empty page ──');
// A bad ?area= used to be the shape that hurts: filter on a name that matches
// nothing and the reader gets «ما لقينا شي» for a query they never typed.
await visit('/explore/?area=not-an-area');
ok('an unknown area filters nothing', (await p.locator('a[href^="/places/"]').count()) === 52);
ok('and draws no chip for it', !(await p.textContent('body')).includes('شوف كل المناطق'));

console.log('\n── the hub offers areas, and no longer offers «كل الأماكن» ──');
// The hub is drawn on /search's dead end, which needs a query that finds
// nothing. Asserted in a browser as well as in tests/mcp.test.mjs because the
// MCP test reads the module — it cannot see a row that failed to render.
await visit('/search/?q=zzzzqqq');
body = await p.textContent('body');
ok('«مناطق الكويت» is offered', body.includes('مناطق الكويت'));
ok('«تصفّح كل الأماكن» is gone', !body.includes('تصفّح كل الأماكن'));
ok('and the row goes to /areas/', (await p.locator('a[href="/areas/"]:visible').count()) >= 1);

ok('no page errors throughout', errors.length === 0, errors.join(' | '));

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
