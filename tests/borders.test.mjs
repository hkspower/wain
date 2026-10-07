import { chromium } from 'playwright';

/**
 * One edge system — the owner's border picks, 7 October.
 *
 * Measured before: nine buttons and fields carried the cards' own line
 * (#dbd8d2, 1.42:1 on white) while 53 others carried line-control (3.30:1),
 * so /explore's search box and chips had no edge you could find while /search's
 * had one; and three controls were outlined by a 1px RING — a box-shadow,
 * which layout never sees — where every other box has a border.
 *
 * Read off computed styles. The hover half is static and lives in
 * audit:theme («── edges ──»), which reads every class string.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const CONTROL = 'rgb(146, 141, 132)'; // --color-line-control

/** The edge of the first match, or null — never throws. */
const edge = (loc) =>
  loc.first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: cs.borderTopWidth, color: cs.borderTopColor, shadow: cs.boxShadow };
  }, null, { timeout: 5000 }).catch(() => null);

const open = async (ctx, path) => {
  const p = await ctx.newPage();
  await p.route(/openstreetmap/, (r) => r.abort());
  await p.goto(B + path);
  await p.waitForTimeout(400);
  return p;
};

/** A ring is a box-shadow with a zero blur and a spread; an elevation is not. */
const hasRing = (s) => /\b0px 0px 0px [1-9]/.test(s ?? '');

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });

console.log('\n── /explore: the box and the chips ──');
{
  const p = await open(ctx, '/explore/');
  const box = await edge(p.locator('main input[type="search"], main input').first());
  ok('the search box has the control edge, like /search\'s', box?.color === CONTROL, JSON.stringify(box));
  const chip = await edge(p.locator('main button[aria-pressed="false"]'));
  ok('an unchosen category chip has the control edge', chip?.color === CONTROL && chip?.width === '1px', JSON.stringify(chip));
  await p.close();
}

console.log('\n── the home page ──');
{
  const p = await open(ctx, '/');
  const pill = await edge(p.getByRole('link', { name: 'دوّر باسم المكان' }));
  ok('«دوّر باسم المكان» is outlined by a border, not a ring', pill?.width === '1px' && !hasRing(pill?.shadow), JSON.stringify(pill));
  ok('and the border is the control edge', pill?.color === CONTROL, JSON.stringify(pill));
  await p.close();
}

console.log('\n── a place page ──');
{
  const p = await open(ctx, '/places/marina-beach/');
  const move = await edge(p.getByRole('button', { name: /حرّك الخريطة/ }));
  ok('«حرّك الخريطة» over the map has the control edge', move?.color === CONTROL, JSON.stringify(move));
  await p.getByRole('button', { name: 'غيّر' }).first().click({ timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(300);
  const when = await edge(p.locator('fieldset:has(legend:text-is("متى؟")) button[aria-pressed="false"]'));
  ok('an unchosen time chip is outlined by a border, not a ring', when?.width === '1px' && !hasRing(when?.shadow), JSON.stringify(when));
  ok('and the border is the control edge', when?.color === CONTROL, JSON.stringify(when));
  await p.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
