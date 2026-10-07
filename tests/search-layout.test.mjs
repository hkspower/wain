import { chromium } from 'playwright';

/**
 * Where the results are on /search — measured, at the widths people use.
 *
 * Until 2 October the page put, between the box and the first result row:
 * شوق's answer, the whole «رسلها للربع» panel and the map. On a 390px phone
 * the first row of the list sat at about 1250px, a screen and a half below
 * the box the visitor had just typed into, so a search looked like it had
 * answered with a share form. On a desktop it was one 736px column with the
 * map pushing the list below the fold.
 *
 * The list is the answer; the panel acts on it and the map draws it. So the
 * list comes first, the panel after it, and from `lg` the map stands beside
 * the list and stays there while it scrolls.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const QUERY = 'قهوة';

const measure = (p) =>
  p.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top + scrollY), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height) };
    };
    const list = document.getElementById('wain-search-results');
    return {
      vh: innerHeight,
      row: box(list?.querySelector('[role="option"]')),
      plan: box([...document.querySelectorAll('h2, h3')].find((h) => h.textContent.includes('رسّلها للربع'))),
      map: box(document.querySelector('[aria-labelledby="search-map-heading"]')),
      scrollW: document.documentElement.scrollWidth,
    };
  });

for (const [w, h] of [[390, 844], [320, 640]]) {
  console.log(`\n── a phone, ${w}px: the answer is on the first screen ──`);
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  await p.route(/openstreetmap/, (r) => r.abort());
  await p.goto(`${B}/search/?q=${encodeURIComponent(QUERY)}`);
  await p.locator('#wain-search-results [role="option"]').first().waitFor({ timeout: 10000 }).catch(() => {});
  const m = await measure(p);
  ok('the first result row starts on the first screen', m.row && m.row.top < m.vh, m.row ? `row at ${m.row.top}px, screen ${m.vh}px` : 'no row');
  ok('the share panel comes after the list, not before it', m.row && m.plan && m.plan.top > m.row.top, `row ${m.row?.top}, panel ${m.plan?.top}`);
  // 7 October: the map used to be the last thing on a phone (1480px of a
  // 1722px page, behind the list and the share panel). It is one bar under the
  // result count now, above the first row, and opens in place.
  const bar = p.getByRole('button', { name: /اعرض الخريطة/ });
  ok('the map is a bar until it is asked for', (await bar.count()) === 1 && m.map === null, `bars ${await bar.count()}, frame ${JSON.stringify(m.map)}`);
  const barBox = await bar.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), h: Math.round(r.height) }; });
  ok('the bar sits above the first result, under the count', m.row && barBox.top < m.row.top, `bar ${barBox.top}, row ${m.row?.top}`);
  ok('and the bar is a finger-sized target', barBox.h >= 40, `${barBox.h}px`);
  await bar.click();
  await p.locator('[data-map-frame]').waitFor({ timeout: 8000 });
  const open = await p.evaluate(() => { const r = document.querySelector('[data-map-frame]').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  ok('opened, the map is taller than it is wide-ish — not the old 218px strip', open.h >= 300, `${open.w}×${open.h}`);
  await p.getByRole('button', { name: 'إخفاء' }).click();
  ok('and it folds back into the bar', (await p.locator('[data-map-frame]').count()) === 0 && (await bar.count()) === 1);
  ok('nothing slides sideways', m.scrollW <= w, `${m.scrollW}px wide`);
  await ctx.close();
}

console.log('\n── a desktop, 1280px: the map beside the list ──');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.route(/openstreetmap/, (r) => r.abort());
  await p.goto(`${B}/search/?q=${encodeURIComponent(QUERY)}`);
  await p.locator('#wain-search-results [role="option"]').first().waitFor({ timeout: 10000 }).catch(() => {});
  const m = await measure(p);
  const beside = m.row && m.map && (m.map.right <= m.row.left || m.map.left >= m.row.right);
  ok('the map stands beside the list, not above it', beside, JSON.stringify({ row: m.row, map: m.map }));
  ok('the first result row starts on the first screen', m.row && m.row.top < m.vh, `row at ${m.row?.top}px`);
  ok('the map is tall enough to read, not a 245px letterbox', m.map && m.map.h >= 400, `map ${m.map?.h}px`);
  // Sticky: scroll the list and the map stays in view.
  await p.evaluate(() => scrollTo(0, 700));
  await p.waitForTimeout(150);
  const top = await p.evaluate(() => document.querySelector('[aria-labelledby="search-map-heading"]')?.getBoundingClientRect().top ?? -1);
  ok('the map stays in view while the list scrolls', top >= 0 && top < 200, `map top ${Math.round(top)}px after scrolling 700px`);
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  ✗ ${f}`); process.exit(1); }
