import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/**
 * سالم, شوق, the hangout and the map as one thing — 3 October, on request
 * («improve full integrate salem with shoug for hangouts and map and all»).
 *
 *  1. سالم's chat has a map under each reply, and the pin, the card and the
 *     share panel point at one place together.
 *  2. He remembers his last answer: «أرخص», «غيره», «الثاني», «وين بالضبط؟».
 *  3. The chat survives a visit to a place page.
 *  4. The handoffs: /search → «كمّل مع سالم», /salem?q=, «كلّم شوق».
 *  5. His replies read aloud, in his voice, when asked.
 *  6. The shortlist: «خلّهم يختارون» on the share panel, and /pick where the
 *     group votes.
 *  7. شوق's answer on /search sends the place she named; an invitation leads
 *     to سالم and to the map.
 *
 * Every read is soft: a wait that times out fails its assertion and the run
 * goes on — an uncaught throw here once cancelled a whole file's sections.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };
const soft = async (f, fallback = null) => { try { return await f(); } catch { return fallback; } };

async function fresh(path, { viewport = { width: 390, height: 844 }, ctx: given } = {}) {
  const ctx = given ?? (await browser.newContext({ viewport, isMobile: true, hasTouch: true, locale: 'ar-KW' }));
  if (!given) {
    // The share sheet, captured: what would have gone to WhatsApp is the
    // thing under test. And the device voice, counted.
    await ctx.addInitScript(() => {
      window.__shared = [];
      navigator.share = async (d) => { window.__shared.push(d); };
      window.__spoken = [];
      // Only utterances with words: unlocking audio inside a tap speaks an
      // empty one, and that is not a reply being read.
      if (window.speechSynthesis) {
        window.speechSynthesis.speak = (u) => { if (u.text?.trim()) window.__spoken.push(u.text); };
      }
    });
  }
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await soft(() => p.goto(`${B}${path}`, { waitUntil: 'networkidle' }));
  return { ctx, p, errors };
}

/** Send a message in سالم's chat and wait for the reply (soft). */
async function ask(p, q) {
  const before = await soft(() => p.locator('[role="log"] [data-line]').count(), 0);
  await soft(async () => {
    await p.locator('#salem-q').fill(q, { timeout: 3000 });
    await p.locator('#salem-q').press('Enter', { timeout: 3000 });
  });
  await soft(() => p.waitForFunction((n) => document.querySelectorAll('[role="log"] [data-line]').length >= n + 2, before, { timeout: 8000 }));
  await p.waitForTimeout(400);
}
const lastPlaces = (p) => p.locator('[data-salem-places]').last();
const slugsOf = (loc) => soft(() => loc.locator('li[data-slug]').evaluateAll((els) => els.map((e) => e.dataset.slug)), []);

console.log('\n── 1. a map under each reply, pointing with the cards and the panel ──');
{
  const { ctx, p, errors } = await fresh('/salem/');
  await ask(p, 'مطعم');
  const block = lastPlaces(p);
  ok('the reply carries a map', (await soft(() => block.locator('[data-map-frame]').count(), 0)) === 1);
  const pins = await soft(() => block.locator('[data-map-frame] a, [data-map-frame] button').count(), 0);
  ok('with pins on it', pins > 0, `${pins}`);
  ok('and «شوف الكل بالبحث» to the same question on /search',
    (await soft(() => block.getByRole('link', { name: 'شوف الكل بالبحث' }).getAttribute('href'))) === `/search/?q=${encodeURIComponent('مطعم')}`);

  const slugs = await slugsOf(block);
  // Choose the second place from the share panel: its card is ringed, and
  // the map's pin for it is the current one.
  const second = await soft(() => block.locator('fieldset button[aria-pressed]').nth(1).textContent(), '');
  await soft(() => block.locator('fieldset button[aria-pressed]').nth(1).click());
  await p.waitForTimeout(300);
  const ringed = await soft(() => block.locator('li[data-slug].ring-2').getAttribute('data-slug'));
  ok('choosing a place in the panel rings its card', ringed === slugs[1], `${ringed} vs ${slugs[1]} (${second})`);
  const currentPin = await soft(() => block.locator('[data-map-frame] [aria-current="true"], [data-map-frame] [data-active]').count(), 0);
  ok('and marks its pin', currentPin >= 1, `${currentPin}`);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── 2. he remembers his last answer ──');
{
  const { ctx, p } = await fresh('/salem/');
  await ask(p, 'مطعم');
  const first = await slugsOf(lastPlaces(p));
  const chips = await soft(() => p.locator('[data-followups] button').allTextContents(), []);
  ok('follow-up chips under the reply', chips.length >= 2, chips.join(' | '));
  ok('«غيره» is one of them (the answer has more)', chips.includes('غيره'));
  ok('there is one chip row, under the newest answer only', (await soft(() => p.locator('[data-followups]').count(), 0)) === 1);

  await soft(() => p.locator('[data-followups] button', { hasText: 'غيره' }).click());
  await soft(() => p.waitForFunction(() => document.querySelectorAll('[data-salem-places]').length >= 2, null, { timeout: 8000 }));
  await p.waitForTimeout(300);
  const more = await slugsOf(lastPlaces(p));
  ok('«غيره» shows new places', more.length > 0 && more.every((s) => !first.includes(s)), `${first} → ${more}`);
  ok('and still one chip row', (await soft(() => p.locator('[data-followups]').count(), 0)) === 1);

  const onScreen = await slugsOf(lastPlaces(p));
  await ask(p, 'الثاني');
  const card = await soft(() => p.locator('[role="log"] a[href^="/places/"]').last().getAttribute('href'), '');
  ok('«الثاني» answers with the second place on screen', card === `/places/${onScreen[1]}/`, `${card} vs ${onScreen[1]}`);

  await ask(p, 'وين بالضبط؟');
  const directions = await soft(() => p.getByRole('link', { name: /الطريق/ }).last().getAttribute('href'), '');
  ok('«وين بالضبط؟» gives the way there', /google\.com\/maps\/dir/.test(directions ?? ''), directions);
  ok('on a map of its own', (await soft(() => p.locator('[role="log"] [data-map-frame]').count(), 0)) >= 3);

  await ask(p, 'قهوة');
  await ask(p, 'أرخص');
  const asked = await soft(() => lastPlaces(p).getByRole('link', { name: 'شوف الكل بالبحث' }).getAttribute('href'), '');
  ok('«أرخص» after «قهوة» narrows «قهوة» rather than searching for «أرخص» alone',
    decodeURIComponent((asked ?? '').replace('/search/?q=', '')) === 'قهوة أرخص', asked);
  await ctx.close();
}

console.log('\n── 3. the chat survives a visit to a place page ──');
{
  const { ctx, p } = await fresh('/salem/');
  await ask(p, 'بحر');
  const before = await soft(() => p.locator('[role="log"] [data-line]').count(), 0);
  await soft(() => lastPlaces(p).locator('li[data-slug] a').first().click());
  await soft(() => p.waitForURL(/\/places\//, { timeout: 5000 }));
  await soft(() => p.goBack({ waitUntil: 'networkidle' }));
  await soft(() => p.waitForSelector('[data-salem-places]', { timeout: 5000 }));
  const after = await soft(() => p.locator('[role="log"] [data-line]').count(), 0);
  ok('back from a place, the conversation is still there', after >= before && before > 0, `${before} → ${after}`);
  ok('and so is its map', (await soft(() => p.locator('[data-salem-places] [data-map-frame]').count(), 0)) >= 1);
  await ctx.close();
}

console.log('\n── 4. the handoffs ──');
{
  const { ctx, p } = await fresh(`/salem/?q=${encodeURIComponent('قهوة')}`);
  await soft(() => p.waitForSelector('[data-salem-places]', { timeout: 8000 }));
  ok('/salem?q= asks the question as the visitor\'s own line',
    (await soft(() => p.locator('[role="log"] p', { hasText: /^قهوة$/ }).count(), 0)) === 1);
  ok('and answers it', (await soft(() => p.locator('[data-salem-places]').count(), 0)) === 1);
  ok('the question leaves the address bar, so a reload does not ask it twice', !p.url().includes('q='), p.url());
  ok('«كلّم شوق» leads to the one call button, on /find',
    (await soft(() => p.locator('header a[href="/find/"]').count(), 0)) === 1);
  ok('and is not a second call button', (await soft(() => p.locator('[data-shouq-call], button[aria-label*="شوق"]').count(), 0)) === 0);
  await ctx.close();

  const s = await fresh(`/search/?q=${encodeURIComponent('قهوة')}`);
  const carry = await soft(() => s.p.getByRole('link', { name: 'كمّل مع سالم' }).getAttribute('href'));
  ok('/search: شوق\'s answer offers «كمّل مع سالم» with the same question', carry === `/salem/?q=${encodeURIComponent('قهوة')}`, carry);
  await s.ctx.close();
}

console.log('\n── 5. his replies, read aloud in his voice ──');
{
  const { ctx, p } = await fresh('/salem/');
  // The bridge answers with a real MP3, so the page takes the voice path and
  // the persona it asks for is on the wire to be read — with the bridge off,
  // «in his voice» would pass on zero requests.
  const tts = [];
  const mp3 = readFileSync(new URL('./fixtures/voice/shouq/hello.mp3', import.meta.url));
  await p.route('**/api/tts.php', (route) => {
    tts.push(route.request().postData() ?? '');
    return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: mp3 });
  });
  const toggle = p.getByRole('button', { name: 'اقرا لي الردود' });
  ok('off until asked', (await soft(() => toggle.getAttribute('aria-pressed'))) === 'false');
  await ask(p, 'قهوة');
  ok('so a reply is not read', tts.length === 0 && (await p.evaluate(() => window.__spoken.length)) === 0);
  await soft(() => toggle.click());
  ok('pressed, it says so', (await soft(() => toggle.getAttribute('aria-pressed'))) === 'true');
  await ask(p, 'بحر');
  await p.waitForTimeout(1200);
  const asked = tts.map((b) => { try { return JSON.parse(b).persona; } catch { return null; } });
  const spoken = await p.evaluate(() => window.__spoken.length);
  ok('then a reply is read, through the bridge', tts.length > 0, `${tts.length} bridge, ${spoken} device`);
  ok('in سالم\'s voice, whatever /search is set to', tts.length > 0 && asked.every((x) => x === 'salem'), asked.join(','));
  ok('and the choice is remembered', (await p.evaluate(() => localStorage.getItem('wain-salem-read'))) === '1');
  await ctx.close();
}

console.log('\n── 6. «خلّهم يختارون»: a shortlist, and /pick ──');
{
  const { ctx, p } = await fresh(`/search/?q=${encodeURIComponent('مطعم')}`);
  const panel = p.locator('#share-plan');
  await soft(() => panel.getByRole('button', { name: 'خلّهم يختارون' }).click());
  const chosen = await soft(() => panel.locator('fieldset').first().locator('button[aria-pressed="true"]').count(), 0);
  ok('the list starts with three places chosen', chosen === 3, `${chosen}`);
  const fourth = panel.locator('fieldset').first().locator('button[aria-pressed="false"]').first();
  ok('a fourth cannot be added', (await soft(() => fourth.isDisabled(), false)) === true);
  await soft(() => panel.getByRole('button', { name: 'رسّل القائمة' }).click());
  await p.waitForTimeout(300);
  const sent = await p.evaluate(() => window.__shared.at(-1)?.text ?? '');
  ok('the message asks the group to choose', sent.includes('اختاروا'), sent);
  ok('numbers the places', sent.includes('١.') && sent.includes('٢.') && sent.includes('٣.'));
  const link = /https?:\/\/\S+\/pick\/\?p=([a-z0-9,-]+)&when=([a-z0-9-]+)/.exec(sent);
  ok('and links to /pick with the three and the time', link && link[1].split(',').length === 3, sent);

  // Down to one: not a list.
  const on = panel.locator('fieldset').first().locator('button[aria-pressed="true"]');
  await soft(() => on.nth(2).click());
  await soft(() => on.nth(1).click());
  ok('with one place left, the list cannot be sent', await soft(() => panel.getByRole('button', { name: 'رسّل القائمة' }).isDisabled(), false));
  await ctx.close();

  if (link) {
    const v = await fresh(`/pick/?p=${link[1]}&when=tomorrow`);
    await soft(() => v.p.waitForSelector('ol li', { timeout: 5000 }));
    ok('/pick shows the three places, numbered', (await soft(() => v.p.locator('ol li').count(), 0)) === 3);
    ok('on a map', (await soft(() => v.p.locator('[data-map-frame]').count(), 0)) === 1);
    await soft(() => v.p.getByRole('button', { name: /^أنا مع ٢/ }).click());
    await v.p.waitForTimeout(300);
    const voted = await v.p.evaluate(() => window.__shared.at(-1)?.text ?? '');
    ok('a vote is one tap: «أنا مع ٢: …»', voted.startsWith('أنا مع ٢:') && voted.includes('باچر'), voted);
    ok('and none of the three leads to سالم', (await soft(() => v.p.getByRole('link', { name: 'اسأل سالم عن غيرها' }).getAttribute('href'), '')).startsWith('/salem/?q='));
    await v.ctx.close();
  }
  const bad = await fresh('/pick/?p=not-a-place,also-not');
  ok('a link with no real places says so, with a way on',
    (await soft(() => bad.p.getByRole('heading', { name: 'ما لقينا الأماكن اللي بالرابط' }).isVisible(), false)) === true);
  await bad.ctx.close();
}

console.log('\n── 7. شوق\'s answer sends the place she named; an invitation leads on ──');
{
  const { ctx, p } = await fresh(`/search/?q=${encodeURIComponent('بحر')}`);
  const named = await soft(() => p.locator('section[aria-live] a[href^="/places/"]').first().getAttribute('href'), '');
  await soft(() => p.getByRole('button', { name: 'رسّلها للربع' }).click());
  await p.waitForTimeout(600);
  const target = await soft(() => p.locator('#share-plan fieldset').first().locator('button[aria-pressed="true"]').textContent(), '');
  const inView = await soft(() => p.locator('#share-plan').evaluate((e) => { const r = e.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }), false);
  ok('«رسّلها للربع» in her answer brings the share panel into view', inView);
  const name = await soft(() => p.locator(`a[href="${named}"]`).first().textContent(), '');
  ok('with the place she named chosen', !!target && (name ?? '').includes(target.trim()), `${target} / ${name}`);
  await ctx.close();

  const inv = await fresh('/places/marina-beach/?when=tonight-8');
  const askHref = await soft(() => inv.p.getByRole('link', { name: 'اسأل سالم' }).getAttribute('href'), '');
  ok('an invitation offers «اسأل سالم» about the same kind of place', (askHref ?? '').startsWith('/salem/?q='), askHref);
  ok('and «شوفه على الخريطة» lands on the map', (await soft(() => inv.p.locator('a[href="#map"]').count(), 0)) === 1 &&
    (await soft(() => inv.p.locator('#map').count(), 0)) === 1);
  await inv.ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
