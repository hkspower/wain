import { chromium } from 'playwright';

/**
 * One box system — the owner's picks from the boxes canvas, 7 October.
 *
 * Measured before: the place card was 15px while the share panel under it was
 * 20, the map frame 15 beside a 20px panel, شوق's answer the only box on the
 * site with a gradient, the share panel's plan line filled with sand-50 —
 * which is #ffffff, the panel's own white, so it showed only by a hairline —
 * and a card that rose 4px into an xl shadow on hover, the heaviest motion on
 * the site for its smallest box.
 *
 * Read off computed styles, not classes, so a token that moves under the
 * same class name is caught too.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const OUTER = '20px';
const INNER = '15px';

/** Computed style of the first match, or null — never throws. */
const style = (p, sel, props) =>
  p.evaluate(({ sel, props }) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const out = {};
    for (const k of props) out[k] = cs[k];
    const parent = el.parentElement?.closest('section, [data-plan-host]');
    out.parentBg = parent ? getComputedStyle(parent).backgroundColor : null;
    return out;
  }, { sel, props });

const open = async (ctx, path) => {
  const p = await ctx.newPage();
  await p.route(/openstreetmap/, (r) => r.abort());
  await p.goto(B + path);
  await p.waitForTimeout(400);
  return p;
};

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

console.log('\n── a place card ──');
{
  const p = await open(ctx, '/explore/');
  const card = 'main a[href^="/places/"].card-defer';
  const s = await style(p, card, ['borderTopLeftRadius', 'boxShadow']);
  ok('a card has the outer corner, 20px', s?.borderTopLeftRadius === OUTER, JSON.stringify(s));
  const badge = await style(p, `${card} [aria-label^="التقييم"]`, ['borderTopLeftRadius', 'boxShadow']);
  ok('its rating badge is round and casts no shadow', badge && parseFloat(badge.borderTopLeftRadius) > 100 && badge.boxShadow === 'none', JSON.stringify(badge));
  const first = p.locator(card).first();
  const before = await first.boundingBox().catch(() => null);
  await first.hover().catch(() => {});
  await p.waitForTimeout(450);
  const after = await first.boundingBox().catch(() => null);
  const lift = before && after ? Math.round((before.y - after.y) * 10) / 10 : null;
  ok('hovering lifts it 2px, not 4', lift !== null && lift > 1 && lift < 3, `lift=${lift}`);
  await p.close();
}

console.log('\n── /search: شوق\'s answer, the map, the share panel ──');
{
  const p = await open(ctx, '/search/?q=' + encodeURIComponent('قهوة'));
  await p.locator('[data-map-frame]').first().waitFor({ timeout: 10000 }).catch(() => {});
  const answer = await style(p, 'section[aria-live="polite"]', ['backgroundImage', 'borderTopLeftRadius', 'backgroundColor']);
  ok('شوق\'s answer has no gradient', answer?.backgroundImage === 'none', JSON.stringify(answer));
  ok('and the outer corner', answer?.borderTopLeftRadius === OUTER, JSON.stringify(answer));
  const map = await style(p, '[data-map-frame]', ['borderTopLeftRadius']);
  ok('the map frame has the outer corner, like the panel under it', map?.borderTopLeftRadius === OUTER, JSON.stringify(map));
  const panel = await style(p, 'section:has(> [data-plan-line])', ['borderTopLeftRadius', 'backgroundColor']);
  const line = await style(p, '[data-plan-line]', ['borderTopLeftRadius', 'backgroundColor', 'boxShadow']);
  ok('the share panel has the outer corner', panel?.borderTopLeftRadius === OUTER, JSON.stringify(panel));
  ok('its plan line has the inner corner', line?.borderTopLeftRadius === INNER, JSON.stringify(line));
  ok('and a fill that differs from the panel it sits in', line && panel && line.backgroundColor !== panel.backgroundColor,
    `line ${line?.backgroundColor} on panel ${panel?.backgroundColor}`);
  ok('drawn by its fill, not a ring', line?.boxShadow === 'none', line?.boxShadow);
  await p.close();
}

console.log('\n── a place page ──');
{
  const p = await open(ctx, '/places/marina-beach/');
  const line = await style(p, '[data-plan-line]', ['backgroundColor']);
  const panel = await style(p, 'section:has(> [data-plan-line])', ['backgroundColor']);
  ok('the plan line shows on the place page too', line && panel && line.backgroundColor !== panel.backgroundColor,
    `line ${line?.backgroundColor} on panel ${panel?.backgroundColor}`);
  await p.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
