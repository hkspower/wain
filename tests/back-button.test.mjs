import { chromium } from 'playwright';

/**
 * The back button (BackButton.tsx): a round, fixed button at the top-start
 * corner of every page but the home page, asked for on 3 October.
 *
 * What this holds it to:
 *   - every page but `/` has exactly one, and `/` has none;
 *   - it is where it says — the top corner on the start side, which is the
 *     right in Arabic — and still there after the page scrolls;
 *   - at rest it covers nothing the page draws: no heading, no breadcrumb,
 *     no field, no other control;
 *   - it goes BACK when the previous page is ours, and to a sensible page
 *     when it is not (a place opened from a shared link has nothing of ours
 *     behind it, and history.back() there would leave the site);
 *   - an open call covers it.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const ROUTES = ['/explore/', '/search/', '/places/kuwait-towers/', '/about/', '/privacy/', '/add/', '/orders/', '/queue/', '/find/', '/salem/'];

async function open(path, width = 390, height = 844) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600, locale: 'ar-KW' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${B}${path}`, { waitUntil: 'networkidle' });
  return { ctx, p, errors };
}

const backs = (p) => p.locator('[data-back-button]').evaluateAll((els) => els.filter((e) => {
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
}).map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }));

// Everything visible the button could sit on: headings, fields, links,
// buttons, images — skipping itself and anything fixed (which is chrome).
const covered = (p) => p.evaluate(() => {
  const btn = document.querySelector('[data-back-button]');
  const b = btn.getBoundingClientRect();
  const hits = [];
  for (const el of document.querySelectorAll('h1,h2,p,input,textarea,a,button,img,nav')) {
    if (el === btn || btn.contains(el) || el.contains(btn)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.closest('.sr-only')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const ix = Math.min(r.right, b.right) - Math.max(r.left, b.left);
    const iy = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
    if (ix > 1 && iy > 1) hits.push(`${el.tagName.toLowerCase()} «${(el.textContent || el.getAttribute('alt') || '').trim().slice(0, 20)}»`);
  }
  return hits;
});

console.log('\n── on every page but home ──');
for (const width of [390, 320, 1280]) {
  {
    const { ctx, p } = await open('/', width);
    ok(`${width}px /: no back button on the home page`, (await backs(p)).length === 0);
    await ctx.close();
  }
  for (const route of ROUTES) {
    const { ctx, p, errors } = await open(route, width);
    const found = await backs(p);
    ok(`${width}px ${route}: one back button`, found.length === 1, JSON.stringify(found));
    if (found.length !== 1) { await ctx.close(); continue; }
    const [b] = found;
    ok(`${width}px ${route}: a full-size target`, b.w >= 44 && b.h >= 44, `${b.w}×${b.h}`);
    ok(`${width}px ${route}: at the top, on the start (right) side`, b.y < 80 && b.x > width / 2, JSON.stringify(b));
    const hits = await covered(p);
    ok(`${width}px ${route}: covers nothing on the page at rest`, hits.length === 0, hits.join(', '));
    const tall = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    if (tall > 300 && route !== '/salem/') {
      await p.evaluate(() => scrollTo(0, 300));
      await p.waitForTimeout(150);
      const [after] = await backs(p);
      ok(`${width}px ${route}: still there after scrolling`, after && Math.abs(after.y - b.y) < 1 && Math.abs(after.x - b.x) < 1, JSON.stringify(after));
    }
    ok(`${width}px ${route}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

console.log('\n── it goes back, or somewhere sensible ──');
{
  // Through /search, not /explore: a place's fallback IS /explore, so a
  // button that never went back would pass a check that came from there.
  const { ctx, p } = await open('/search/?q=' + encodeURIComponent('قهوة'));
  const first = p.locator('main a[href^="/places/"]').first();
  await first.click({ timeout: 5000 }).catch(() => {});
  await p.waitForURL('**/places/**', { timeout: 5000 }).catch(() => {});
  await p.locator('[data-back-button]').click({ timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(800);
  const back = new URL(p.url());
  ok('search → a place → back returns to the search, query and all', back.pathname === '/search/' && back.search.includes('q='), p.url());
  await ctx.close();
}
{
  const { ctx, p } = await open('/places/kuwait-towers/');
  await p.locator('[data-back-button]').click({ timeout: 5000 }).catch(() => {});
  await p.waitForURL('**/explore/', { timeout: 5000 }).catch(() => {});
  ok('a place opened from a link goes to explore, not out of the site', new URL(p.url()).pathname === '/explore/', p.url());
  await ctx.close();
}
{
  const { ctx, p } = await open('/salem/');
  await p.locator('[data-back-button]').click({ timeout: 5000 }).catch(() => {});
  await p.waitForURL('**/find/', { timeout: 5000 }).catch(() => {});
  ok('/salem opened from a link goes to /find', new URL(p.url()).pathname === '/find/', p.url());
  await ctx.close();
}
{
  const { ctx, p } = await open('/about/');
  await p.locator('[data-back-button]').click({ timeout: 5000 }).catch(() => {});
  await p.waitForURL((u) => new URL(u).pathname === '/', { timeout: 5000 }).catch(() => {});
  ok('any other page opened from a link goes home', new URL(p.url()).pathname === '/', p.url());
  await ctx.close();
}

console.log('\n── an open call covers it ──');
{
  const { ctx, p } = await open('/find/');
  await p.evaluate(() => window.dispatchEvent(new Event('wain-ai:call')));
  await p.locator('.wain-ai-panel').waitFor({ timeout: 5000 }).catch(() => {});
  const top = await p.evaluate(() => {
    const b = document.querySelector('[data-back-button]')?.getBoundingClientRect();
    if (!b) return 'gone';
    const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return el?.closest('[data-back-button]') ? 'button' : 'sheet';
  });
  ok('the call sheet is on top of it', top !== 'button', top);
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
