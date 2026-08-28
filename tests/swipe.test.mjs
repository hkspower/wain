import { chromium } from 'playwright';

/**
 * How the category rail feels under a thumb.
 *
 * The rail is the one horizontally-swiped surface on the site — nine category
 * cards on the home page, 112px wide, 3.15 of them to a 390px screen.
 * Everything else on the site wraps or grids.
 *
 * It used to be `snap-mandatory`, and mandatory means the rail is not allowed
 * to come to rest anywhere except an item edge. Measured: a 4px nudge was
 * corrected into a 120px jump — a whole card. Every small movement fought
 * back. Mandatory is right for a pager, where one panel fills the screen and
 * a half-scrolled state is meaningless; this is a browse rail, where it is not.
 *
 * Two more things were wrong and neither was visible without measuring:
 * `overscroll-behavior-x` was `auto`, so a swipe past the last card chained to
 * the page and could fire the browser's back gesture; and there was no
 * `scroll-padding` to match the rail's own 16px gutter, so the rail sat 16px
 * away from its start position on load, before anyone touched it.
 *
 * The risk in the fix is over-correcting — making the swipe comfortable by
 * quietly making snapping do nothing at all. So this tests BOTH directions: a
 * graze must be left alone, and a real flick must still be caught.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fails.push(n); console.log(`  ✗ ${n}${d ? `\n      ${d}` : ''}`); }
};

const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(B + '/', { waitUntil: 'networkidle' });

/** The rail: the one <ul> on the page that scrolls horizontally. */
const railHandle = await page.evaluateHandle(() =>
  [...document.querySelectorAll('ul')].find((u) => getComputedStyle(u).overflowX === 'auto')
);
ok('the category rail is there and scrolls horizontally', await railHandle.evaluate((el) => !!el));

console.log('\n── the rail is set up to be swiped ──');
{
  const s = await railHandle.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      snap: cs.scrollSnapType,
      overscroll: cs.overscrollBehaviorX,
      scrollPad: cs.scrollPaddingInlineStart,
      pad: cs.paddingInlineStart,
      overflowing: el.scrollWidth > el.clientWidth,
    };
  });
  // Chrome reports proximity as bare "x" — proximity is the initial strictness.
  ok(`snapping is proximity, not mandatory (${s.snap})`,
    s.snap === 'x' || /proximity/.test(s.snap), s.snap);
  ok('overscroll is contained, so a swipe past the end cannot trigger back-navigation',
    s.overscroll === 'contain', s.overscroll);
  ok(`scroll-padding matches the rail's own gutter (${s.scrollPad} vs ${s.pad})`,
    s.scrollPad === s.pad, `${s.scrollPad} vs ${s.pad}`);
  ok('the rail actually overflows on a phone — otherwise none of this is exercised',
    s.overflowing);
}

console.log('\n── it rests where it belongs ──');
{
  const at = await railHandle.evaluate((el) => Math.abs(el.scrollLeft));
  ok(`at rest the rail is at its start, not offset by the gutter (${at}px)`, at === 0, `${at}px`);
}

console.log('\n── the strictness actually took effect ──');
/**
 * What this can and cannot measure, stated plainly, because the distinction
 * caught me out while writing it.
 *
 * `scrollBy({behavior:'instant'})` is a PROGRAMMATIC scroll, and the spec
 * re-applies snap positions after those regardless of strictness. It is not the
 * path a thumb takes: a touch drag tracks the finger and resolves on release,
 * using where the fling comes to rest — which is exactly where mandatory and
 * proximity differ most, because mandatory MUST land on a snap point and
 * proximity may leave the rail wherever momentum ended.
 *
 * The real path is a compositor gesture, and
 * `Input.synthesizeScrollGesture` produces no scroll at all in this headless
 * browser — neither the rail nor the page moves — so the felt behaviour cannot
 * be measured here at all. Nothing below should be read as testing it.
 *
 * What the programmatic path does give is a reliable tripwire on the setting:
 * under `mandatory` a 4px scroll was corrected to 124px, a whole card; under
 * `proximity` it stays where it was put. That distinguishes the two modes, so
 * it catches a revert, which is what this test is for.
 */
{
  const trial = (px) =>
    railHandle.evaluate(
      (el, d) =>
        new Promise((res) => {
          el.scrollTo({ left: 0, behavior: 'instant' });
          setTimeout(() => {
            el.scrollBy({ left: -d, behavior: 'instant' }); // RTL: negative is forward
            setTimeout(() => res(Math.abs(el.scrollLeft)), 500);
          }, 400);
        }),
      px
    );
  const tiny = await trial(4);
  ok(`a 4px scroll is left where it was put (${tiny}px; mandatory corrected this to 124px)`,
    Math.abs(tiny - 4) <= 2, `landed ${tiny}px`);

  // The other half: proximity must still ASSIST, or the rail has simply lost
  // its snapping and the cards will come to rest half off the screen.
  // 124px is the stride — a 112px card plus the 12px gap.
  const near = await trial(118);
  ok(`stopping 6px short of a card edge is still assisted to it (118 → ${near})`,
    near === 124, `${near}`);
  const far = await trial(240);
  ok(`stopping 8px short of two cards is still assisted to them (240 → ${far})`,
    far === 248, `${far}`);
}

console.log('\n── and the desktop grid is untouched ──');
{
  const wide = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar-KW' });
  const wp = await wide.newPage();
  await wp.goto(B + '/', { waitUntil: 'networkidle' });
  const g = await wp.evaluate(() => {
    const ul = [...document.querySelectorAll('ul')].find((u) =>
      getComputedStyle(u).display === 'grid' && u.children.length === 9
    );
    if (!ul) return null;
    const cs = getComputedStyle(ul);
    return { display: cs.display, overflow: cs.overflowX, scrolls: ul.scrollWidth > ul.clientWidth };
  });
  ok('from lg up the rail is a grid, not a scroller', g && g.display === 'grid', JSON.stringify(g));
  ok('and it does not overflow', g && !g.scrolls, JSON.stringify(g));
  await wide.close();
}

ok('no page errors', errors.length === 0, errors.join('\n      '));

await ctx.close();
await browser.close();
console.log(
  `\n${fails.length ? '✗' : '✓'} swipe: ${pass} passed` +
    (fails.length ? `, ${fails.length} failed\n  ${fails.join('\n  ')}` : '')
);
process.exit(fails.length ? 1 : 0);
