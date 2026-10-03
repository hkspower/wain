import { chromium } from 'playwright';

/**
 * The dial, then the choice it now leads to.
 *
 * The dial used to open its own panel — the five nearest places, ranked live
 * against a GPS fix. That panel is gone; the dial is a plain link to /find
 * now, and /find is where the real choice is: call شوق, or type to her. The
 * call half has to be proved doing a real call rather than assumed, because
 * the first draft nested the real ShouqCallButton inside a second, outer
 * <button> whose own onClick did the navigation — which silently made the
 * OUTER button the only thing that ever fired. Tapping it moved to /search
 * having placed no call at all. `wain-ai:call` firing is the proof that
 * would have caught it; a navigation to /search alone would not have,
 * because the outer button produced that too.
 *
 * The typing half's identity has moved three times, and this file has
 * asserted a different one of them each time — read `SALEM_VOICE_ID`'s own
 * comment in `lib/wain-ai.ts` for the full account before changing this
 * again. It shipped as سالم's, was corrected to شوق's, and was reversed
 * again on request, 30 September, back to his — his own regenerated photo,
 * his own pill and greeting, his own voice on the wire. What is real and
 * asserted below: the call half is شوق's, the typing half is سالم's, and the
 * real ShouqCallButton actually places a call rather than only navigating.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

async function fresh(path) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW',
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${B}${path}`, { waitUntil: 'networkidle' });
  return { ctx, p, errors };
}

console.log('\n── the dial no longer opens its own panel ──');
{
  const { ctx, p, errors } = await fresh('/');
  // The sun itself: since 3 October the home page has a second link to /find,
  // the desktop «ابدأ» bar (StartBar.tsx), hidden while the sun is in view.
  const dial = p.locator('a[href="/find/"][data-hero-sun]');
  ok('the dial is a link to /find', await dial.isVisible());
  ok('it no longer promises a distance figure', !(await p.locator('text=كم حواليك').count()));
  // Less text, on request: the question and one thing to do. It carried four
  // lines, one of them («اضغط ودوّر حواليك») untrue since the dial stopped
  // ranking places around you.
  const said = (await dial.innerText()).split('\n').map((t) => t.trim()).filter(Boolean);
  ok('the dial says two things: the question and «ابدأ»', JSON.stringify(said) === JSON.stringify(['إلى وين؟', 'ابدأ']), JSON.stringify(said));
  ok('and its name still says where it leads', (await dial.getAttribute('aria-label'))?.includes('كلّم شوق'));
  await dial.click();
  await p.waitForURL('**/find/**');
  ok('tapping it lands on /find', p.url().includes('/find'));
  ok('no page errors on the way', errors.length === 0);
  await ctx.close();
}

console.log('\n── /find offers exactly the two, equally ──');
{
  const { ctx, p, errors } = await fresh('/find/');
  // The real ShouqCallButton — its accessible name names شوق, which a
  // bespoke look-alike button would have no reason to get right.
  const shouqButton = p.getByRole('button', { name: /شوق/ });
  const typeLink = p.getByRole('link', { name: /ابدأ الكتابة/ });
  ok('كلّم شوق is offered, as the real call button', await shouqButton.isVisible());
  ok('typing to him is offered too', await typeLink.isVisible());
  ok('the call half is شوق\'s — the typing half\'s سالم text sits below it', await p.locator('section[aria-label="اتصال"]', { hasText: 'سالم' }).count() === 0);
  ok('and the typing half names سالم', await p.locator('section[aria-label="اكتب"]', { hasText: 'سالم' }).isVisible());
  const box = await shouqButton.boundingBox();
  // The big call variant (size-24, 96px) against the sm default (size-8,
  // 32px) — the one thing a screenshot proves and an accessible-name check
  // does not: that the prop actually reached the rendered button.
  ok('the button is the big call size, not the inline default', box.width >= 88);
  ok('no page errors', errors.length === 0);
  await ctx.close();
}

console.log('\n── the typing option leads to سالم\'s chat page ──');
{
  const { ctx, p } = await fresh('/find/');
  await p.getByRole('link', { name: /ابدأ الكتابة/ }).click();
  await p.waitForURL('**/salem/**');
  ok('landed on /salem', p.url().includes('/salem'));
  await ctx.close();
}

console.log('\n── the call half is a phone, with one big call button at its centre ──');
// On request, 2 October («one call icon, big, at the centre, a big mobile with
// "call"»). It was her photo full-bleed under a scrim, with an 80px portrait
// for a button. Each width a phone, a small phone and a desktop.
for (const [width, height] of [[390, 844], [320, 568], [1280, 800]]) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'ar-KW' });
  const p = await ctx.newPage();
  await p.goto(`${B}/find/`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700); // the reveal animations settle
  const m = await p.evaluate(() => {
    const sec = document.querySelector('section[aria-label="اتصال"]');
    const phone = sec?.querySelector('[data-phone]');
    const buttons = [...document.querySelectorAll('button[aria-controls="wain-ai-panel"]')];
    const btn = buttons[0];
    const r = (e) => e?.getBoundingClientRect();
    const label = [...(phone?.querySelectorAll('span') ?? [])].find((e) => e.textContent.trim() === 'اتصال');
    return {
      buttons: buttons.length,
      phone: phone ? { l: r(phone).left, rt: r(phone).right, w: r(phone).width } : null,
      sec: sec ? { l: r(sec).left, w: r(sec).width } : null,
      btn: btn ? { l: r(btn).left, w: r(btn).width, h: r(btn).height, top: r(btn).top } : null,
      inPhone: !!(phone && btn && phone.contains(btn)),
      photoOnScreen: !!phone?.querySelector('img[src*="shouq-face"]'),
      bg: btn ? getComputedStyle(btn).backgroundColor : null,
      btnImg: !!btn?.querySelector('img'),
      btnSvg: !!btn?.querySelector('svg'),
      labelBelow: !!(label && btn && r(label).top >= r(btn).bottom - 1),
      name: btn?.getAttribute('aria-label') ?? '',
    };
  });
  const tag = `${width}×${height}`;
  ok(`${tag}: one call button, and it is on the phone`, m.buttons === 1 && m.inPhone, JSON.stringify(m));
  ok(`${tag}: the phone sits centred in the half, inside the screen`,
    !!m.phone && !!m.sec && Math.abs((m.phone.l + m.phone.w / 2) - (m.sec.l + m.sec.w / 2)) <= 8 && m.phone.l >= 0 && m.phone.rt <= width,
    JSON.stringify(m.phone));
  ok(`${tag}: the button is centred on it and big (≥ 88px)`,
    !!m.btn && !!m.phone && Math.abs((m.btn.l + m.btn.w / 2) - (m.phone.l + m.phone.w / 2)) <= 8 && m.btn.w >= 88 && m.btn.h >= 88,
    JSON.stringify(m.btn));
  ok(`${tag}: it is a call button — green with a handset, not her portrait`, m.bg === 'rgb(31, 111, 61)' && m.btnSvg && !m.btnImg, `${m.bg} svg=${m.btnSvg} img=${m.btnImg}`);
  ok(`${tag}: her photo is on the phone's screen`, m.photoOnScreen);
  ok(`${tag}: «اتصال» is printed under it, and its name starts with that word`, m.labelBelow && m.name.startsWith('اتصال'), m.name);
  await ctx.close();
}

console.log('\n── كلّم شوق places a call, not just a navigation ──');
{
  const { ctx, p } = await fresh('/find/');
  const calledEvents = await p.evaluate(() => {
    window.__calls = 0;
    window.addEventListener('wain-ai:call', () => { window.__calls++; });
    return true;
  });
  ok('the listener attached', calledEvents === true);
  await p.getByRole('button', { name: /شوق/ }).click();
  await p.waitForURL('**/search/**', { timeout: 8000 });
  const calls = await p.evaluate(() => window.__calls);
  ok('the tap requested a real call (wain-ai:call fired)', calls === 1);
  ok('and it also landed on /search, where the answer appears', p.url().includes('/search'));
  await ctx.close();
}

console.log('\n── what it says depends on when it is read ──');
{
  // A frozen clock, so the hour is chosen rather than whatever the machine
  // says. 09:00 UTC on 15 July is noon in Kuwait — summer, and the heat of the
  // day, when the old page offered the beach.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-KW' });
  const p = await ctx.newPage();
  await p.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
  await p.goto(`${B}/find/`, { waitUntil: 'networkidle' });
  const call = () => p.locator('section[aria-label="اتصال"] p').first().textContent();
  const typed = () => p.locator('section[aria-label="اكتب"] p').first().textContent();
  ok('a July noon offers somewhere cool, and no sea', /مول مكيّف/.test(await call()) && !/بحر/.test(await call()), await call());
  ok('and both halves say the same moment', (await typed()).includes('مول مكيّف'), await typed());
  await ctx.close();

  // A January morning, the tab left open across noon: the line changes on
  // the hour without a reload.
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-KW' });
  const q = await ctx2.newPage();
  await q.clock.install({ time: new Date('2026-01-10T08:59:00Z') });
  await q.goto(`${B}/find/`, { waitUntil: 'networkidle' });
  const greet = () => q.locator('section[aria-label="اتصال"] p').first().textContent();
  const morning = await greet();
  ok('11:59 in Kuwait in January: good morning, and the walk by the sea',
    morning.startsWith('صباح الخير!') && morning.includes('مشي على البحر'), morning);
  await q.clock.runFor(2 * 60_000);
  const noon = await greet();
  ok('two minutes later, past noon, without a reload', noon.startsWith('هلا!') && noon.includes('غدا'), noon);
  await ctx2.close();

  // And the HTML, before any script: the line the call sheet already uses.
  const html = await (await fetch(`${B}/find/`)).text();
  ok('the static page carries today\'s greeting until it knows the hour',
    html.includes('هلا! أنا شوق. قول لي وش تبي — قهوة، بحر، طلعة عيال — وأدلّك.'));
}

console.log('\n── one call button, and it is here ──');
// 1 October, asked for: «keep call شوق only one button call». There were
// three — /find's, one in the /search box and one in the search dead end —
// one offer drawn three times. Every ShouqCallButton carries
// aria-controls="wain-ai-panel", so that is what is counted. The routes are
// the ones a visitor actually lands on, not only the page that was changed.
{
  const routes = [
    ['/find/', 1], ['/', 0], ['/search/', 0], ['/search/?q=قهوة', 0],
    ['/search/?q=صيدلية', 0], ['/explore/', 0], ['/places/kuwait-towers/', 0], ['/salem/', 0],
  ];
  for (const [path, want] of routes) {
    const { ctx, p } = await fresh(path);
    await p.waitForTimeout(300);
    const n = await p.locator('button[aria-controls="wain-ai-panel"]:visible').count();
    ok(`${path}: ${want} call button${want === 1 ? '' : 's'}`, n === want, `found ${n}`);
    await ctx.close();
  }
  // And the way from /search to it is a link to /find, not a second button.
  const { ctx, p } = await fresh('/search/');
  ok('/search still names the call, as a link to /find',
    await p.locator('a[href="/find/"]', { hasText: 'كلّمي شوق' }).isVisible());
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : '\nكل شي تمام');
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
