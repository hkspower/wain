import { chromium } from 'playwright';

/**
 * The keyboard, on both things that search.
 *
 * Two surfaces search this site — the ⌘K palette and the /search page — and
 * only one of them answered the keyboard. The palette moved a highlight with
 * ↑ and ↓; the page, which is the one built for searching, did nothing at
 * all, so anyone who learned the keys in the overlay lost them on arrival.
 *
 * And the palette's version was half a feature: the highlight moved, focus
 * never did, and no element was ever named as current — so a screen reader
 * announced nothing while the selection travelled down the list. Keyboard
 * navigation that only works if you can see it working is not keyboard
 * navigation; it is a colour.
 *
 * So this checks both halves on both surfaces: that the keys move the
 * selection and open the right thing, and that `aria-activedescendant` names
 * the option that moved — which is the entire mechanism by which a combobox
 * is audible.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const QUERY = 'قهوة';

/** What the input claims is selected, and what the list agrees is selected. */
const state = (p) =>
  p.evaluate(() => {
    const input = document.querySelector('input[role="combobox"]');
    const listId = input?.getAttribute('aria-controls');
    const list = listId ? document.getElementById(listId) : null;
    const named = input?.getAttribute('aria-activedescendant') || null;
    const options = list ? [...list.querySelectorAll('[role="option"]')] : [];
    const selected = options.filter((o) => o.getAttribute('aria-selected') === 'true');
    return {
      expanded: input?.getAttribute('aria-expanded'),
      named,
      options: options.length,
      namedExists: named ? !!document.getElementById(named) : false,
      namedIsSelected: named ? selected.length === 1 && selected[0].id === named : false,
      namedHref: named ? document.getElementById(named)?.getAttribute('href') : null,
      listRole: list?.getAttribute('role') ?? null,
    };
  });

for (const surface of ['page', 'palette']) {
  console.log(`\n── the ${surface === 'page' ? '/search page' : '⌘K palette'} answers the keyboard ──`);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'ar-KW' });
  const p = await ctx.newPage();
  await p.route('**openstreetmap.org**', (r) => r.abort());

  if (surface === 'page') {
    await p.goto(`${B}/search/?q=${encodeURIComponent(QUERY)}`, { waitUntil: 'networkidle' });
  } else {
    await p.goto(`${B}/`, { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'بحث' }).first().click();
    await p.locator('input[role="combobox"]').waitFor({ timeout: 8000 });
    await p.locator('input[role="combobox"]').type(QUERY, { delay: 20 });
  }
  // Tolerated, not asserted here: if the options never appear the assertions
  // below say exactly which part of the contract is missing, which is more
  // use than a timeout stack from inside a locator.
  await p.locator('[role="option"]').first().waitFor({ timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(250);

  const first = await state(p);
  ok(`the box is a combobox owning a listbox (${first.options} options)`,
    first.listRole === 'listbox' && first.options > 1, JSON.stringify(first));
  ok('it reports itself expanded', first.expanded === 'true', String(first.expanded));
  ok('and names a real option as current',
    !!first.named && first.namedExists && first.namedIsSelected, JSON.stringify(first));

  await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(120);
  const second = await state(p);
  ok('↓ moves the named option', second.named !== first.named, `${first.named} → ${second.named}`);
  ok('and the list still agrees with the box',
    second.namedIsSelected && second.namedExists, JSON.stringify(second));

  await p.keyboard.press('ArrowUp');
  await p.waitForTimeout(120);
  ok('↑ moves it back', (await state(p)).named === first.named);

  await p.keyboard.press('End');
  await p.waitForTimeout(120);
  const last = await state(p);
  ok('End reaches the last result in one press',
    first.options > 0 &&
      last.named === `${await p.evaluate(() => document.querySelector('input[role="combobox"]')?.getAttribute('aria-controls') ?? '')}-o${first.options - 1}`,
    last.named);

  await p.keyboard.press('Home');
  await p.waitForTimeout(120);
  ok('Home comes back to the first', (await state(p)).named === first.named);

  // Enter must open the thing the reader arrowed to — not the first result,
  // which is the bug you get from reading `hits[0]` in the handler.
  await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(120);
  const chosen = await state(p);
  await p.keyboard.press('Enter');
  await p.waitForURL((u) => u.pathname !== '/search/' && u.pathname !== '/', { timeout: 8000 }).catch(() => {});
  ok('Enter opens the arrowed result, not the first one',
    new URL(p.url()).pathname.replace(/\/$/, '') === (chosen.namedHref || '').replace(/\/$/, ''),
    `${p.url()} vs ${chosen.namedHref}`);

  await ctx.close();
}

console.log('\n── the cursor cannot point past the end of the list ──');
{
  /**
   * The list changes under the cursor with every keystroke. Arrow to the
   * ninth result, type one more letter, and the list can drop to two — with
   * `active` still at 8. Enter then reads `hits[8]`, gets undefined, and the
   * press does nothing at all, which reads as the search being broken rather
   * than the results having changed.
   */
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'ar-KW' });
  const p = await ctx.newPage();
  await p.route('**openstreetmap.org**', (r) => r.abort());
  // A word, not a letter: tokenize() drops single characters on purpose, so
  // «م» returns nothing and the case would test the empty state instead.
  await p.goto(`${B}/search/?q=${encodeURIComponent('الكويت')}`, { waitUntil: 'networkidle' });
  await p.locator('[role="option"]').first().waitFor({ timeout: 8000 }).catch(() => {});

  const wide = await state(p);
  for (let i = 0; i < 12; i++) await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(150);

  // Narrow it hard: a long specific query leaves very few results.
  await p.locator('input[role="combobox"]').fill('المتحف الوطني الكويتي');
  await p.waitForTimeout(700);
  const narrow = await state(p);
  ok(`the list narrowed (${wide.options} → ${narrow.options})`, narrow.options < wide.options,
    `${wide.options} → ${narrow.options}`);
  ok('the named option still exists in the shorter list',
    narrow.namedExists && narrow.namedIsSelected, JSON.stringify(narrow));

  await p.keyboard.press('Enter');
  await p.waitForURL((u) => u.pathname.startsWith('/places/'), { timeout: 8000 }).catch(() => {});
  ok('and Enter still opens something', p.url().includes('/places/'), p.url());
  await ctx.close();
}

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
