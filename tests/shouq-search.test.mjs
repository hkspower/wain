import { chromium } from 'playwright';

/**
 * شوق, on the search page rather than beside it.
 *
 * `answerParts` builds a real reply to every search — the place to try and
 * where it is, then when to go, or the Kuwaiti summer's warning instead where
 * the place is open to it. The page computed that and did exactly one thing
 * with it: `speak()`.
 *
 * صوت وين is off unless you turn it on, so for almost everyone the answer was
 * built and thrown away. Her call hands you here — «the search page's own
 * summary is the reply» — and the summary was inaudible and invisible at the
 * same time. A typed search met a list of cards with no sign that anybody had
 * been asked anything.
 *
 * And the mic went one way. Her call owned the only microphone on the site, so
 * the page she sends you to could be REACHED by voice and then only used by
 * typing.
 *
 * These are the two claims that must not quietly come apart again: she answers
 * in writing whether or not the voice is on, and the box listens.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const ANSWER = 'section[aria-label*="شوق"]';

const read = (p) =>
  p.evaluate((sel) => {
    const sec = document.querySelector(sel);
    return {
      found: !!sec,
      live: sec?.getAttribute('aria-live') ?? null,
      atomic: sec?.getAttribute('aria-atomic') ?? null,
      text: sec ? sec.textContent.replace(/\s+/g, ' ').trim() : '',
      links: sec ? [...sec.querySelectorAll('a')].map((a) => a.getAttribute('href')) : [],
      liveRegions: document.querySelectorAll('[aria-live]').length,
      // The first result the SEARCH ranked, to compare against what she says.
      topResult: document.querySelector('[role="option"]')?.getAttribute('href') ?? null,
    };
  }, ANSWER);

console.log('\n── she answers in writing, with the voice switched off ──');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'ar-KW', isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  // Her answer reads Kuwait's month and hour (3 October): January, two in the
  // afternoon, so the season cannot move what this section asserts.
  await p.clock.setFixedTime(new Date('2026-01-15T11:00:00Z'));
  await p.route('**openstreetmap.org**', (r) => r.abort());
  await p.goto(`${B}/search/?q=${encodeURIComponent('قهوة هادية')}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);

  const a = await read(p);
  ok('her answer is on the page at all', a.found, 'no section labelled شوق');
  ok('and صوت وين really is off — this is not the spoken path',
    await p.evaluate(() => !JSON.parse(localStorage.getItem('wain:voice') ?? 'false')));
  ok('she opens with «جرّب» and the place, not a result count',
    /^شوق ?جرّب /.test(a.text), a.text.slice(0, 80));
  // The header said «شوق — أقترح عليك:» until 3 October, the spoken intro
  // echoed on screen. The intro went from the answer and the header with it.
  ok('the header is her name alone',
    (await p.locator(`${ANSWER} h2`).textContent()) === 'شوق', await p.locator(`${ANSWER} h2`).textContent());
  ok('she says when to go, as «روح …»', a.text.includes('روح '), a.text);
  ok('and offers no second place — that is the next card in the list',
    !a.text.includes('وإذا تبي غيره'), a.text);

  /**
   * The one thing that makes this an answer rather than a caption: she must
   * recommend what the search actually ranked first. Two code paths, one
   * conclusion — if they ever disagree, the page argues with itself.
   */
  ok('the place she recommends is the one the search ranked first',
    !!a.topResult && a.links[0] === a.topResult, `${a.links[0]} vs ${a.topResult}`);

  ok('the one place she names is a link to it',
    a.links.length === 1 && a.links[0]?.startsWith('/places/'), a.links.join(' · '));

  console.log('\n── and the page announces one thing, not two ──');
  ok('exactly one live region on the page', a.liveRegions === 1, `${a.liveRegions} regions`);
  ok('and it is hers', a.live === 'polite' && a.atomic === 'true', `${a.live}/${a.atomic}`);
  await ctx.close();
}

console.log('\n── the season and the hour are Kuwait\'s, and they change the answer ──');
{
  /* «قهوة» at two in an August afternoon led with a tea house in an open
     courtyard and then said «لا تروح إلا بعد المغرب» about it — after «أحلى
     وقت: العصر». Now the heat line replaces the best time, a place the sun
     ruins is not first by day, and at night neither applies. */
  const at = async (q, iso) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'ar-KW', isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.clock.setFixedTime(new Date(iso));
    await p.route('**openstreetmap.org**', (r) => r.abort());
    await p.goto(`${B}/search/?q=${encodeURIComponent(q)}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(500);
    const r = await read(p);
    await ctx.close();
    return r;
  };
  const AFTERNOON = '2026-08-15T11:00:00Z'; // 14:00 in Kuwait
  const NIGHT = '2026-08-15T18:00:00Z'; //     21:00 in Kuwait
  const sea = await at('بحر', AFTERNOON);
  ok('a beach at two in an August afternoon: the heat line', sea.text.includes('لا تروح إلا عقب المغرب'), sea.text);
  ok('…instead of «go in the afternoon», not beside it', !/روح (من )?العصر/.test(sea.text), sea.text);
  const seaNight = await at('بحر', NIGHT);
  ok('the same beach at nine at night is not told to wait for sunset', !seaNight.text.includes('لا تروح إلا عقب المغرب'), seaNight.text);
  const coffee = await at('قهوة', AFTERNOON);
  ok('«قهوة» in an August afternoon does not lead with an open courtyard',
    !coffee.text.includes('مقاهي المباركية') && !coffee.text.includes('كافيهات شارع الخليج'), coffee.text);
  ok('and what she names is still the first result on the page', coffee.links[0] === coffee.topResult, `${coffee.links[0]} vs ${coffee.topResult}`);
  /* «وين أروح الحين» found nothing and she said «ما لقيت شي». */
  const now = await at('وين أروح الحين', AFTERNOON);
  ok('«وين أروح الحين» gets a place, not «ما لقيت شي»', now.links.length === 1 && !now.text.includes('ما لقيت'), now.text);
  ok('and the list leads with the same place', now.links[0] === now.topResult, `${now.links[0]} vs ${now.topResult}`);
}

console.log('\n── an empty box gets nothing; a failed search gets the most important turn ──');
/**
 * This used to assert the opposite of what it asserts now, and the old
 * assertion was the bug.
 *
 * «nothing to answer means nothing to say» sounds right and is wrong for the
 * one case that matters. `answerParts` has a no-results branch returning the
 * line written for exactly this moment — «ما لقيت شي بهالكلمة. قول لي الجو
 * اللي تبيه — قهوة، بحر، مطعم، ولا طلعة عيال.» — which names the four things
 * she is good at instead of telling somebody their word was too long. It is
 * also `search-empty` in the clip library, so the generator would have paid to
 * record a sentence that could never play: the page guarded on `hits.length`
 * both when computing her answer AND when rendering it.
 *
 * A service call never goes quiet on a failed lookup. An empty box is not a
 * failed lookup — nobody has asked anything yet — so that half stands.
 */
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'ar-KW' });
  const p = await ctx.newPage();
  await p.route('**openstreetmap.org**', (r) => r.abort());
  await p.goto(`${B}/search/`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  ok('an empty box gets no answer block', !(await read(p)).found);

  await p.goto(`${B}/search/?q=${encodeURIComponent('زقزقة')}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  const none = await read(p);
  ok('a query with no results still gets an answer from her', none.found, JSON.stringify(none.text));
  ok('and it is the line that says what to try, not that the search failed',
    none.text.includes('قول لي الجو اللي تبيه'), none.text);
  ok('she names things she can actually find', ['قهوة', 'بحر', 'مطعم'].every((w) => none.text.includes(w)));
  ok('she recommends no place, having found none', none.links.length === 0, none.links.join(' '));
  ok('the empty-state card is still there to browse from',
    (await p.locator('text=ما لقينا شي').count()) === 1);
  // The card's own advice line moved into hers — one «try this», not two.
  ok('and its advice is not repeated underneath her',
    (await p.locator('text=جرّب كلمة أقصر').count()) === 0);
  await ctx.close();
}

console.log('\n── the box carries no voice control; the call is one link away ──');
{
  /**
   * This block used to drive the query box's own microphone: stub the engine,
   * press the mic, feed interim results, watch them land in the field while
   * the search ran on them mid-sentence.
   *
   * That mic went first, for شوق's call button in its place. The call button
   * went next, 1 October: the owner asked for ONE way to call her, and that is
   * /find's. A call placed there still ends here — the sentence in the box and
   * the answer read back, measured end to end in shouq-flow.test.mjs.
   *
   * So the box carries no voice control at all, «كلّمي شوق» above it is a link
   * to /find, and the button's own promises are asserted where it now lives.
   */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'ar-KW', isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.route('**openstreetmap.org**', (r) => r.abort());
  await p.goto(`${B}/search/`, { waitUntil: 'networkidle' });

  const shouq = (pg) => pg.locator('button[aria-label*="\u0648\u064a\u0646 AI"]');
  // Was «the box carries her call button»; it is the opposite since 1 October.
  ok('the box carries no call button', (await shouq(p).count()) === 0);
  ok('and names the call as a link to /find instead',
    await p.locator('a[href="/find/"]', { hasText: 'كلّمي شوق' }).isVisible());

  ok('the old dictation mic is gone',
    (await p.locator('button[aria-label="\u0627\u0633\u0623\u0644 \u0634\u0648\u0642 \u0628\u0635\u0648\u062a\u0643"]').count()) === 0);
  ok('and no second voice button took its place',
    (await p.locator('button[aria-label*="\u0627\u0633\u062a\u0645\u0627\u0639"]').count()) === 0);

  // The two promises the box's button made, read off the one that is left.
  await p.goto(`${B}/find/`, { waitUntil: 'networkidle' });
  ok('/find carries her call button', (await shouq(p).count()) === 1);
  // evaluateAll: with no button a bare getAttribute waits 30s and throws,
  // cancelling the section after this one.
  const attr = (n) => shouq(p).evaluateAll((es, n) => es[0]?.getAttribute(n) ?? null, n);
  ok('it points at the panel it opens', (await attr('aria-controls')) === 'wain-ai-panel');
  ok('and reports itself closed until it is pressed', (await attr('aria-expanded')) === 'false');
  await ctx.close();
}

console.log('\n── a question asked out loud is repeated back ──');
{
  /**
   * شوق's call hands the question over in session storage so she can echo what
   * she heard. That echo was audio-only too, so arriving from a spoken
   * question looked identical to typing one.
   */
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'ar-KW' });
  const p = await ctx.newPage();
  await p.route('**openstreetmap.org**', (r) => r.abort());
  await p.addInitScript(() => {
    try { sessionStorage.setItem('wain:asked', 'قهوة هادية'); } catch { /* private mode */ }
  });
  await p.goto(`${B}/search/?q=${encodeURIComponent('قهوة هادية')}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const a = await read(p);
  ok('she repeats the question she was asked', a.text.includes('قهوة هادية؟'), a.text.slice(0, 90));
  await ctx.close();
}

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
