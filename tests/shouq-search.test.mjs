import { chromium } from 'playwright';

/**
 * شوق, on the search page rather than beside it.
 *
 * `answerParts` builds a real reply to every search — it names the best place
 * and says why, gives the best time, warns about the Kuwaiti summer where the
 * place is open to it, and offers one alternative. The page computed that and
 * did exactly one thing with it: `speak()`.
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
  await p.route('**openstreetmap.org**', (r) => r.abort());
  await p.goto(`${B}/search/?q=${encodeURIComponent('قهوة هادية')}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);

  const a = await read(p);
  ok('her answer is on the page at all', a.found, 'no section labelled شوق');
  ok('and صوت وين really is off — this is not the spoken path',
    await p.evaluate(() => !JSON.parse(localStorage.getItem('wain:voice') ?? 'false')));
  ok('she opens with the recommendation, not a result count',
    a.text.includes('أقترح عليك'), a.text.slice(0, 80));
  ok('she gives the best time', a.text.includes('أحلى وقت'), a.text);
  ok('and offers exactly one alternative',
    (a.text.match(/وإذا تبي غيره/g) || []).length === 1, a.text);

  /**
   * The one thing that makes this an answer rather than a caption: she must
   * recommend what the search actually ranked first. Two code paths, one
   * conclusion — if they ever disagree, the page argues with itself.
   */
  ok('the place she recommends is the one the search ranked first',
    !!a.topResult && a.links[0] === a.topResult, `${a.links[0]} vs ${a.topResult}`);

  ok('both places she names are links to those places',
    a.links.length === 2 && a.links.every((h) => h?.startsWith('/places/')), a.links.join(' · '));

  console.log('\n── and the page announces one thing, not two ──');
  ok('exactly one live region on the page', a.liveRegions === 1, `${a.liveRegions} regions`);
  ok('and it is hers', a.live === 'polite' && a.atomic === 'true', `${a.live}/${a.atomic}`);
  await ctx.close();
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

console.log('\n── the box listens, with the same engine her call uses ──');
{
  /**
   * A stubbed recogniser. The real one needs a microphone and a permission
   * grant, neither of which a headless browser has — but every line of wiring
   * between the button and the query box is ours, and that is the part that
   * breaks. The stub reports `ar-KW` back so the locale cannot be dropped: a
   * mic set to the browser's UI language transcribes Kuwaiti Arabic as
   * whatever it thought it heard, which looks like bad recognition rather
   * than a missing line of setup.
   */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'ar-KW', isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.route('**openstreetmap.org**', (r) => r.abort());
  await p.addInitScript(() => {
    window.__rec = { started: 0, stopped: 0, lang: null };
    class Stub {
      constructor() { this.onstart = null; this.onresult = null; this.onerror = null; this.onend = null; }
      start() {
        window.__rec.started++;
        window.__rec.lang = this.lang;
        window.__live = this;
        setTimeout(() => this.onstart?.(), 10);
      }
      stop() { window.__rec.stopped++; setTimeout(() => this.onend?.(), 10); }
      abort() { this.onend?.(); }
    }
    // BOTH names. Chromium ships `SpeechRecognition` unprefixed, and
    // getRecognition prefers it — stubbing only the webkit spelling replaced
    // the branch this browser does not take, so the real engine ran, found no
    // microphone, and the whole section measured nothing.
    Object.defineProperty(window, 'SpeechRecognition', { value: Stub, configurable: true, writable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: Stub, configurable: true, writable: true });
  });
  await p.goto(`${B}/search/`, { waitUntil: 'networkidle' });

  const mic = p.locator('button[aria-label="اسأل شوق بصوتك"]');
  ok('the box has a mic', (await mic.count()) === 1);

  await mic.click();
  await p.waitForTimeout(150);
  ok('pressing it starts listening', (await p.evaluate(() => window.__rec.started)) === 1);
  ok('in Kuwaiti Arabic, not the browser default',
    (await p.evaluate(() => window.__rec.lang)) === 'ar-KW',
    await p.evaluate(() => window.__rec.lang));
  ok('and it says so', (await p.locator('button[aria-label="إيقاف الاستماع"]').count()) === 1);

  // Interim results, exactly as an engine delivers them mid-sentence.
  await p.evaluate(() => window.__live.onresult({ results: [[{ transcript: 'مطاعم' }]] }));
  await p.waitForTimeout(500);
  ok('what she hears lands in the box',
    (await p.locator('input[role="combobox"]').inputValue()) === 'مطاعم');
  ok('and the search runs on it while the sentence is still going',
    (await p.locator('[role="option"]').count()) > 0);

  await p.evaluate(() => window.__live.onresult({ results: [[{ transcript: 'مطاعم' }], [{ transcript: 'السالمية' }]] }));
  await p.waitForTimeout(600);
  ok('a second segment joins the first with a space, not glued to it',
    (await p.locator('input[role="combobox"]').inputValue()) === 'مطاعم السالمية',
    await p.locator('input[role="combobox"]').inputValue());

  const spoken = await read(p);
  ok('and شوق answers what was said out loud', spoken.found && spoken.text.includes('أقترح عليك'));

  await p.locator('button[aria-label="إيقاف الاستماع"]').click();
  await p.waitForTimeout(150);
  ok('pressing again stops it', (await p.evaluate(() => window.__rec.stopped)) === 1);
  ok('and the mic offers itself again', (await mic.count()) === 1);
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
