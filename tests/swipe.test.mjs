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
 * quietly making snapping do nothing at all — so this checks that the rail
 * still snaps. It does NOT check that a graze is left alone, though it used to
 * claim to: see the measured table further down for why that half cannot be
 * tested from here, and what replaced it.
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

console.log('\n── snapping is switched on and assisting ──');
/**
 * What this can and cannot measure — rewritten, because the version that stood
 * here claimed something that is not true and had a red line to prove it.
 *
 * It asserted that a 4px programmatic nudge is «left where it was put» under
 * proximity and would be corrected to 124px under mandatory, and it failed on
 * every run. Measured on this page, all four trials, the three modes side by
 * side:
 *
 *     x proximity    4→124   62→124   118→124   240→248
 *     x mandatory    4→124   62→124   118→124   240→248
 *     none           4→4     62→62    118→118   240→240
 *
 * Proximity and mandatory are IDENTICAL here. `scrollBy({behavior:'instant'})`
 * is a programmatic scroll, and Chrome re-snaps after one in the direction of
 * travel whatever the strictness — the file's own header said the spec re-snaps
 * «regardless of strictness» and then built an assertion on the two differing.
 * So the failing line was unreachable except by turning snapping off, and,
 * worse, the two GREEN lines beside it pass under mandatory too: the section
 * could not catch the revert it exists to catch.
 *
 * The felt difference is a compositor gesture — a drag that tracks the finger
 * and resolves on a fling — and `Input.synthesizeScrollGesture` moves nothing
 * in this headless browser, so it cannot be measured here at all.
 *
 * What IS measurable is the two things below, and the strictness itself is
 * already asserted from the computed value further up («snapping is proximity,
 * not mandatory»), which is the check that actually catches a revert.
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

  // 124px is the stride — a 112px card plus the 12px gap.
  const near = await trial(118);
  ok(`stopping 6px short of a card edge is assisted to it (118 → ${near})`,
    near === 124, `${near}`);
  const far = await trial(240);
  ok(`stopping 8px short of two cards is assisted to them (240 → ${far})`,
    far === 248, `${far}`);
  // The one trial that separates «snapping on» from «snapping off»: with
  // scroll-snap-type:none a 4px nudge stays at 4px, and it is the only mode
  // that leaves it there.
  const tiny = await trial(4);
  ok(`a nudge is resolved to a card edge rather than left mid-card (4 → ${tiny})`,
    tiny === 124, `landed ${tiny}px — snapping is off`);
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

console.log('\n── the home page fits in a pocket ──');
{
  // A budget, not a pixel count. The home page was 4130px on a 390px phone —
  // 4.9 screens — of which 1901px was six featured cards stacked one per row.
  // The rail below turned that into one card's height. This guards the shape
  // rather than the styling: 3000px still leaves generous room to add a
  // section, and catches a return to stacking, which costs 1500px at once.
  await page.goto(`${B}/`, { waitUntil: 'networkidle' });
  const m = await page.evaluate(() => {
    const ul = [...document.querySelectorAll('ul')].find((u) => u.querySelector('a[href^="/places/"]'));
    const lis = ul ? [...ul.children].map((li) => li.getBoundingClientRect()) : [];
    return {
      page: document.documentElement.scrollHeight,
      wide: document.documentElement.scrollWidth > innerWidth,
      cards: lis.length,
      rail: ul ? ul.scrollWidth > ul.clientWidth + 4 : false,
      heights: [...new Set(lis.map((r) => Math.round(r.height)))].length,
      firstVisible: lis.length ? Math.round(lis[0].width) : 0,
    };
  });
  ok(`the home page is under 3000px on a 390px phone (${m.page}px)`, m.page < 3000, `${m.page}px`);
  ok('and still does not slide sideways', !m.wide);
  ok(`all ${m.cards} featured places are still on it`, m.cards === 6, `${m.cards}`);
  ok('they are a rail, not a stack', m.rail);
  // The cards sit in <li>s that stretch; without h-full on the card itself the
  // short ones float above a ragged bottom edge.
  ok('and every card is the same height', m.heights === 1, `${m.heights} distinct heights`);
  ok('a card is wide enough to read at a glance', m.firstVisible >= 240, `${m.firstVisible}px`);
}

ok('no page errors', errors.length === 0, errors.join('\n      '));

await ctx.close();
await browser.close();
console.log(
  `\n${fails.length ? '✗' : '✓'} swipe: ${pass} passed` +
    (fails.length ? `, ${fails.length} failed\n  ${fails.join('\n  ')}` : '')
);
process.exit(fails.length ? 1 : 0);
