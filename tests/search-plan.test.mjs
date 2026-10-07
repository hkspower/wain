import { chromium } from 'playwright';

/**
 * «رسّلها للربع» ON the search page — the errand finished where it started.
 *
 * The place-page panel is covered by hangout-page.test.mjs: the share sheet,
 * wa.me, the clipboard, the expiring hours. None of that is repeated here,
 * because it is the same component and testing it twice only makes it twice as
 * slow to change.
 *
 * What is only true here is the target. On a place page the place is settled by
 * the URL; on search it is whichever of forty results the visitor means, and it
 * moves — with the chips, and with the map and the list, which already point at
 * each other. Every assertion below is about that: which place the panel is
 * about, and whether the message that leaves actually names it.
 *
 * The failure this is written against is a quiet one. A panel that always sends
 * the top result no matter which chip is lit still looks completely correct —
 * the chip moves, the heading is right — and the group receives the wrong place.
 *
 * «the map and the list, which already point at each other» sat in this
 * paragraph as a fact about the SOURCE for a long time before anything here
 * proved it reaches the panel too — `activeSlug` is shared code, not a
 * tested claim, and the two are not the same thing. Both maps (the static
 * embed, and `LiveMap` once opened — see live-map.test.mjs) tap a pin and
 * check the panel's own selection follows it, and the reverse: choosing a
 * place in the panel is what the map then shows as current. «integrate
 * hangout with the map» closed exactly that gap.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

/** A search page whose share sheet is a spy. */
async function fresh(q) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW',
  });
  await ctx.addInitScript(() => {
    window.__shared = [];
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data) => { window.__shared.push(data); return Promise.resolve(); },
    });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${B}/search/?q=${encodeURIComponent(q)}`, { waitUntil: 'networkidle' });
  // The chips are behind «غيّر» since 7 October, and this suite is about
  // them. Soft: a missing button is the assertions' failure, not a throw.
  await p.locator('#share-plan').getByRole('button', { name: 'غيّر' }).click({ timeout: 6000 }).catch(() => {});
  return { ctx, p, errors };
}

const panel = (p) => p.locator('section', { has: p.locator('h2', { hasText: 'رسّلها للربع' }) }).last();
const sendButton = (p) => panel(p).locator('button', { hasText: /^رسّلها$|لحظة/ });
/** The place chips live under «أي مكان؟»; the time chips under «متى؟». */
const placeField = (p) => panel(p).locator('fieldset', { has: p.locator('legend', { hasText: 'أي مكان؟' }) });
const placeChips = (p) => placeField(p).locator('button');
/** aria-pressed is on the chip itself, not on anything inside it. */
const chosenPlace = (p) => placeField(p).locator('button[aria-pressed="true"]');
const otherPlace = (p) => placeField(p).locator('button[aria-pressed="false"]');

console.log('\n── a search you can act on without leaving it ──');
{
  const { ctx, p, errors } = await fresh('قهوة');
  await panel(p).waitFor({ timeout: 8000 });
  ok('the panel is on the search page', await panel(p).isVisible());
  ok('it offers a choice of place', (await placeChips(p).count()) > 1);
  ok('exactly one place is selected', (await chosenPlace(p).count()) === 1);
  // Inside the two questions (which place, when): the panel also carries
  // the «مكان واحد / خلّهم يختارون» switch, which is pressed too (3 October).
  ok('and a time is already chosen', (await panel(p).locator('fieldset button[aria-pressed="true"]').count()) === 2,
    'one place + one time');
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── it sends the place it says it is about ──');
{
  const { ctx, p } = await fresh('قهوة');
  await panel(p).waitFor({ timeout: 8000 });
  const target = (await chosenPlace(p).first().textContent()).trim();
  await sendButton(p).click();
  await p.waitForFunction(() => window.__shared.length > 0, null, { timeout: 8000 });
  const [data] = await p.evaluate(() => window.__shared);
  ok('the share sheet opens from search', !!data);
  ok(`the message names the selected place «${target}»`,
    data.text.includes(target), data.text.slice(0, 80));
  ok('and carries a time', /الحين|بعد ساعة|الليلة الساعة|باچر|الويكند/.test(data.text), data.text);
  ok('url is not passed alongside text', data.url === undefined);
  await ctx.close();
}

console.log('\n── picking a different place sends THAT one ──');
{
  const { ctx, p } = await fresh('قهوة');
  await panel(p).waitFor({ timeout: 8000 });
  // The first chip that is not the one already selected.
  const unselected = otherPlace(p).first();
  const wanted = (await unselected.textContent()).trim();
  const before = (await chosenPlace(p).first().textContent()).trim();
  await unselected.click();
  await p.waitForFunction(
    (w) => {
      const el = [...document.querySelectorAll('button[aria-pressed="true"]')];
      return el.some((b) => b.textContent.trim() === w);
    },
    wanted,
    { timeout: 6000 }
  );
  ok(`«${wanted}» is now the selected place`,
    (await chosenPlace(p).first().textContent()).trim() === wanted);
  await sendButton(p).click();
  await p.waitForFunction(() => window.__shared.length > 0, null, { timeout: 8000 });
  const [data] = await p.evaluate(() => window.__shared);
  ok(`the message names «${wanted}»`, data.text.includes(wanted), data.text.slice(0, 80));
  ok(`and not the one it replaced («${before}»)`, !data.text.includes(before),
    data.text.slice(0, 80));
  await ctx.close();
}

console.log('\n── the map and the panel share one target: tapping a pin retargets it ──');
{
  // This is the claim the file's own header makes in passing — "with the map
  // and the list, which already point at each other" — and until now nothing
  // here actually tapped a pin to prove it reaches the hangout panel too. A
  // panel whose target silently stopped following the map would still look
  // correct: the chip row would just be stale, one tap behind what the
  // visitor is pointing at.
  const { ctx, p } = await fresh('قهوة');
  await panel(p).waitFor({ timeout: 8000 });
  // The phone's map is a bar until tapped.
  await p.getByRole('button', { name: /اعرض الخريطة/ }).tap();
  const map = p.locator('section[aria-labelledby="search-map-heading"]');
  await map.waitFor({ timeout: 8000 });

  const before = (await chosenPlace(p).first().textContent()).trim();
  // MapPin's aria-label is `${nameAr} — ${areaAr}` — see MapPin.tsx.
  const pins = map.locator('a[href^="/places/"]');
  const n = await pins.count();
  let target = null;
  for (let i = 0; i < n; i++) {
    const label = await pins.nth(i).getAttribute('aria-label');
    const name = (label ?? '').split(' — ')[0];
    if (name && name !== before) { target = { loc: pins.nth(i), name }; break; }
  }
  ok('found a pin for a place other than the panel\'s current one', !!target, `panel on ${before}, ${n} pins`);
  if (target) {
    // A single tap on a touch context selects rather than navigates — see
    // map-pin.test.mjs. That selection is `activeSlug`, the same state
    // SearchPlan's own `target` reads.
    await target.loc.click();
    await p.waitForFunction(
      (w) => [...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => b.textContent.trim() === w),
      target.name,
      { timeout: 6000 }
    );
    ok(`tapping the pin moved the panel's own selection to «${target.name}»`,
      (await chosenPlace(p).first().textContent()).trim() === target.name);

    // And the reverse: choosing a place back in the panel is what the map
    // itself should then show as current, closing the loop both ways.
    const back = otherPlace(p).first();
    const backName = (await back.textContent()).trim();
    await back.click();
    await p.waitForTimeout(300);
    const currentPinLabel = await map.locator('a[aria-current="true"]').first().getAttribute('aria-label');
    ok(`choosing «${backName}» in the panel makes its own pin the current one on the map`,
      (currentPinLabel ?? '').startsWith(backName), currentPinLabel);
  }
  await ctx.close();
}

console.log('\n── the LIVE map, once opened, shares the same target ──');
{
  // Opt-in and Leaflet-backed rather than the static embed — see
  // live-map.test.mjs. Both render pins through the same `renderPin` in
  // SearchMap.tsx, so this is a different transport for the same claim, not
  // a different mechanism — and it is the map a caller of شوق's who taps
  // «حرّك الخريطة» is actually looking at.
  const { ctx, p } = await fresh('قهوة');
  await panel(p).waitFor({ timeout: 8000 });
  await p.getByRole('button', { name: /اعرض الخريطة/ }).tap();
  const map = p.locator('section[aria-labelledby="search-map-heading"]');
  await map.waitFor({ timeout: 8000 });
  await map.getByRole('button', { name: /حرّك الخريطة/ }).click();
  await p.locator('.leaflet-container').waitFor({ timeout: 15000 });

  const before = (await chosenPlace(p).first().textContent()).trim();
  const pins = map.locator('a[href^="/places/"]');
  const n = await pins.count();
  let target = null;
  for (let i = 0; i < n; i++) {
    const label = await pins.nth(i).getAttribute('aria-label');
    const name = (label ?? '').split(' — ')[0];
    if (name && name !== before) { target = { loc: pins.nth(i), name }; break; }
  }
  ok('a pin is reachable on the live map too', !!target, `${n} pins, panel on ${before}`);
  if (target) {
    await target.loc.click();
    await p.waitForFunction(
      (w) => [...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => b.textContent.trim() === w),
      target.name,
      { timeout: 6000 }
    );
    ok(`tapping a pin on the LIVE map moved the panel's selection to «${target.name}»`,
      (await chosenPlace(p).first().textContent()).trim() === target.name);
  }
  await ctx.close();
}

console.log('\n── a result from the last place is not a result about this one ──');
{
  const { ctx, p } = await fresh('قهوة');
  await panel(p).waitFor({ timeout: 8000 });
  await sendButton(p).click();
  await p.waitForFunction(() => window.__shared.length > 0, null, { timeout: 8000 });
  // navigator.share resolving counts as sent, and the panel says so somewhere.
  await otherPlace(p).first().click();
  await p.waitForTimeout(300);
  const stale = await panel(p).locator('[role="status"]').count();
  ok('switching place clears the previous outcome line', stale === 0,
    `${stale} status lines still showing`);
  await ctx.close();
}

console.log('\n── nothing to plan, nothing shown ──');
{
  // «خصوصية» matches the privacy page and no place at all, so there is no
  // place to send and the panel must not invent one.
  const { ctx, p, errors } = await fresh('خصوصية');
  await p.waitForTimeout(1200);
  ok('no plan panel when no place matched', (await panel(p).count()) === 0);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── ordering is offered only where a business switched it on ──');
{
  // Against the catalogue, not against a zero: the link is drawn for the
  // panel's target (the first result) exactly when that place accepts orders
  // or runs a queue, and the data decides which — a greyed or dead «اطلب» on
  // a place that does not would teach the visitor to ignore the row. This
  // used to assert «0 of 52», which was true until the owner started sending
  // menus, and would then have failed on correct behaviour.
  const { places, acceptsOrders, takesQueue } = await import('./catalogue.mjs').then((m) => m.loadCatalogue());
  const { ctx, p } = await fresh('قهوة');
  await panel(p).waitFor({ timeout: 8000 });
  // The chosen chip carries the target's name; the catalogue says what it accepts.
  const chosenName = ((await chosenPlace(p).first().textContent().catch(() => '')) || '').trim();
  const target = places.find((x) => x.nameAr === chosenName);
  ok('the chosen place is a real place', !!target, chosenName);
  const order = await p.locator('a', { hasText: 'اطلب من' }).count();
  const queue = await p.locator('a', { hasText: 'خذ دورك' }).count();
  const wantOrder = target && acceptsOrders(target) ? 1 : 0;
  const wantQueue = target && takesQueue(target) ? 1 : 0;
  ok(`the order link is there exactly when the place accepts orders (${target?.slug}: ${wantOrder})`, order === wantOrder, `${order} shown`);
  ok(`the queue link is there exactly when the salon runs a queue (${wantQueue})`, queue === wantQueue, `${queue} shown`);
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
