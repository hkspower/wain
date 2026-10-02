import { chromium } from 'playwright';

/**
 * Agent mode — the path that runs once NEXT_PUBLIC_ELEVENLABS_AGENT_ID is set.
 *
 * The ElevenLabs widget itself cannot run here: the agent id is fake and unpkg
 * is unreachable from this box. So the widget bundle is stubbed with a script
 * that defines the custom element and fires the same config event the real one
 * does. That exercises everything on wain's side of the contract — the mode
 * switch, the pinned URL, the element and its agent-id, and the two client
 * tools the agent drives the interface with — without pretending the third
 * party ran.
 *
 * THE STUB MUST BEHAVE LIKE THE WIDGET, NOT LIKE A CONVENIENCE. It used to
 * fire `elevenlabs-convai:call` from connectedCallback — at MOUNT — because
 * that was the quickest way to hand the page a config object. The real widget
 * (read out of the published 0.18.1 bundle) dispatches it from `startSession`,
 * after the visitor has pressed its own «بدء مكالمة» and cleared its terms
 * gate. So the stub made «mounted» and «call started» the same instant, the
 * page treated them as the same instant, and a caller who obeyed «متصل» spoke
 * to a widget that was not listening and got no word back. The suite pinned
 * that bug in place. The stub now renders an open-shadow Start button and
 * stays silent until it is clicked.
 */
const B = process.env.WAIN_URL || 'http://localhost:4190';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

/** One browser context wired the way a phone with the widget would be.
 *  `micError` is the DOMException name getUserMedia should reject with, or
 *  null for a working microphone. */
async function makeCtx(micError, seen) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW' });
  await c.route('**/unpkg.com/**', async (route) => {
    seen.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        class ConvaiStub extends HTMLElement {
          connectedCallback() {
            window.__convaiAgentId = this.getAttribute('agent-id');
            window.__convaiDefaultExpanded = this.getAttribute('default-expanded');
            if (this.shadowRoot) return;
            // Open shadow root and a Start button, like the real widget.
            // NOTHING is dispatched until it is pressed.
            const root = this.attachShadow({ mode: 'open' });
            root.innerHTML = '<button id="stub-start" type="button">بدء مكالمة</button>';
            root.getElementById('stub-start').addEventListener('click', () => {
              // Dispatched on the element and composed, as the real one does.
              const ev = new CustomEvent('elevenlabs-convai:call', { bubbles: true, composed: true, detail: { config: {} } });
              this.dispatchEvent(ev);
              window.__convaiConfig = ev.detail.config;
            });
          }
        }
        customElements.define('elevenlabs-convai', ConvaiStub);
        window.__convaiLoaded = true;
      `,
    });
  });
  await c.addInitScript((err) => {
    window.__vibrations = [];
    navigator.vibrate = () => true;
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak() {}, cancel() {}, getVoices: () => [] } });
    window.__micRequests = 0;
    window.__micStopped = 0;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          window.__micRequests++;
          if (err) throw Object.assign(new Error(err), { name: err });
          return { getTracks: () => [{ stop() { window.__micStopped++; } }] };
        },
      },
    });
  }, micError);
  return c;
}
/**
 * Every call is placed from /find — the one call button on the site since
 * 1 October — and the tap carries the caller on to /search, where her tools
 * put the answers. Soft: a tap that never lands is a red assertion, not a
 * throw that cancels every section after it.
 */
const onSearch = (u) => new URL(u).pathname.startsWith('/search');
const dial = async (page) => {
  await page.goto(B + '/find/', { waitUntil: 'networkidle' });
  await page.locator('button[aria-controls="wain-ai-panel"]').first().click();
  return page.waitForURL(onSearch, { timeout: 6000 }).then(() => true, () => false);
};

const requested = [];
const ctx = await makeCtx(null, requested);
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));

console.log('\n── with an agent configured, the call goes to her, not the recogniser ──');
await p.goto(B + '/find/', { waitUntil: 'networkidle' });
const fab = p.locator('button[aria-label*="وين AI"]');
await fab.click();
await p.waitForSelector('#wain-ai-panel', { timeout: 6000 });
ok('one tap places the call', true);
const landed = await p.waitForURL(onSearch, { timeout: 6000 }).then(() => true, () => false);
ok('and carries the caller on to /search, where her tools put the answers', landed, p.url());
// In agent mode the tap opens a conversation; it must NOT fall through to the
// dictation flow, which would push a query. Every tap lands on /search, so
// «did it reach /search» proves nothing — the absence of ?q= does.
ok('it stays put rather than searching', !p.url().includes('q='), p.url());

const panel = await p.locator('#wain-ai-panel').textContent();
ok('she introduces herself as شوق', panel.includes('شوق'));
// Which of the two appears depends on whether the stubbed widget has finished
// loading yet — the greeting carries the ringing seconds, the examples take
// over once she is on the line. Either is her telling you what to say; which
// one is a race this assertion has no business caring about.
ok('she tells the visitor what to say — or what to press',
  panel.includes('قول لي وش تبي') || panel.includes('قهوة هادية') || panel.includes('بدء مكالمة'), panel.slice(0, 120));
ok('the microphone note is shown', panel.includes('المايك'));
ok('and the call can be hung up', panel.includes('إنهاء المكالمة'));
// next.config sets trailingSlash, so the rendered href is "/privacy/".
ok('the privacy page is one tap away', (await p.locator('#wain-ai-panel a[href^="/privacy"]').count()) === 1);

console.log('\n── the widget is loaded on demand, from a pinned URL ──');
await p.waitForFunction(() => window.__convaiLoaded === true, null, { timeout: 8000 });
ok('the bundle is fetched only after she is opened', requested.length === 1, requested.join(', '));
/* This assertion used to be /convai-widget-embed@\d/ and it passed for months
   on `@elevenlabs/convai-widget-embed@1` — a semver RANGE, matching no
   published version of a package that has never had a 1.x. Every real call
   404'd at the CDN and told the caller «ما قدرنا نوصلك بشوق». `@\d` cannot
   tell a pin from a range, so it must be x.y.z, and the entry file has to be
   named too or unpkg answers two redirects before 451KB starts arriving. */
ok('the URL names an exact version, not a range',
  /convai-widget-embed@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\//.test(requested[0]), requested[0]);
ok('and the entry file, so nothing redirects on the way to it',
  /\/dist\/[^/]+\.js$/.test(requested[0]), requested[0]);
await p.waitForFunction(() => !!window.__convaiAgentId, null, { timeout: 8000 });
ok('the element is created with the configured agent', (await p.evaluate(() => window.__convaiAgentId)) === 'agent_test_0123456789');

console.log('\n── mounting the widget is NOT the call connecting ──');
// Wait for the sheet to leave «يرن…»: the ring-back stops once the widget is
// mounted, and what replaces it must not be «متصل».
// A throw here would take the process down and cancel every section after it,
// so a sheet that never reaches «جاهزة» is a red assertion, not a crash.
const reachedReady = await p.waitForFunction(
  () => document.querySelector('#wain-ai-panel header')?.textContent.includes('جاهزة'),
  null, { timeout: 8000 }
).then(() => true, () => false);
ok('once the widget is mounted the sheet says READY, not connected', reachedReady);
const readyHeader = await p.locator('#wain-ai-panel header').textContent();
const readyPanel = await p.locator('#wain-ai-panel').textContent();
ok('with the widget mounted and nobody having pressed Start, the status says she is READY',
  readyHeader.includes('جاهزة'), readyHeader);
ok('and does not claim the call is connected', !readyHeader.includes('متصل'), readyHeader);
ok('no clock is running over a call that has not started', !/[٠-٩]{2}:[٠-٩]{2}/.test(readyHeader), readyHeader);
ok('the sheet tells the caller to press Start, in the widget\'s own words',
  readyPanel.includes('اضغط «بدء مكالمة»'), readyPanel.slice(0, 200));
ok('it does not invite her to speak yet', !readyPanel.includes('قهوة هادية'), readyPanel.slice(0, 200));
ok('and offers no voice switch on a call that has not begun', !readyPanel.includes('بصوت سالم'));
// Measured against the REAL widget (0.18.1, the agent's own config): expanded
// it covers the sheet and shrinks the call control to an unlabelled icon;
// collapsed it is a labelled «بدء مكالمة» card under the sheet's own text.
ok('the widget is left at its own collapsed default, not force-expanded over the sheet',
  (await p.evaluate(() => window.__convaiDefaultExpanded)) === null);
ok('the microphone was asked for INSIDE the tap, once',
  (await p.evaluate(() => window.__micRequests)) === 1);
ok('and released at once — it was a permission probe, not a capture',
  (await p.evaluate(() => window.__micStopped)) === 1);
const startBtn = p.locator('#wain-ai-panel elevenlabs-convai >> #stub-start');
ok('the widget\'s Start button is visible inside the sheet', await startBtn.isVisible());

// Nothing on the sheet can press the widget's Start (it sits behind its own
// consent gate), so a caller who never sees it used to wait on «اضغط بدء
// مكالمة» for ever. After 15 seconds the sheet points at it again.
ok('the Start nudge is not shown straight away', !readyPanel.includes('للحين ما بدأت المكالمة'));
const nudged = await p
  .waitForFunction(() => document.querySelector('#wain-ai-panel')?.textContent.includes('للحين ما بدأت المكالمة'),
    null, { timeout: 20000 })
  .then(() => true, () => false);
ok('after 15 seconds on the ready screen it points at Start again', nudged);

await startBtn.click();
await p.waitForFunction(
  () => document.querySelector('#wain-ai-panel')?.textContent.includes('متصل'),
  null, { timeout: 8000 }
);
ok('once the widget STARTS the call, the sheet reports it connected', true);
ok('and the ready wording is gone', !(await p.locator('#wain-ai-panel header').textContent()).includes('جاهزة'));
await p.waitForFunction(
  () => /[٠-٩]{2}:[٠-٩]{2}/.test(document.querySelector('#wain-ai-panel header')?.textContent ?? ''),
  null, { timeout: 4000 }
);
ok('and the timer is running', true);
ok('and she now invites the caller to speak',
  (await p.locator('#wain-ai-panel').textContent()).includes('قهوة هادية'));
// She speaks first — her greeting — so «قول وش تبي…» told the caller to talk
// over her. The line says it is open, and asks for nothing.
{
  const live = await p.locator('#wain-ai-panel').textContent();
  ok('without telling the caller to talk over her greeting', !live.includes('قول وش تبي'), live.slice(0, 160));
  ok('the line says it is open instead', live.includes('كلّمها عادي'), live.slice(0, 160));
  ok('and the Start nudge is gone once the call has started', !live.includes('للحين ما بدأت المكالمة'));
}

console.log('\n── what the call TELLS you, and what it must not claim ──');
{
  /**
   * The status line is announced; the clock must not be.
   *
   * It used to read «متصل · ٠٠:٠٧» inside `aria-live="polite"`, so the region
   * changed once a second and a screen reader re-read it once a second, over
   * whatever شوق was saying. Measured before the fix on this build: **six
   * distinct values in five seconds** — a live region narrating a stopwatch.
   */
  const heard = await p.evaluate(
    () =>
      new Promise((res) => {
        const r = [...document.querySelectorAll('#wain-ai-panel [aria-live]')];
        const seen = r.map(() => new Set());
        const tick = () => r.forEach((el, i) => seen[i].add(el.textContent.trim()));
        tick();
        const iv = setInterval(tick, 100);
        setTimeout(() => { clearInterval(iv); res(seen.map((s) => [...s])); }, 3400);
      })
  );
  const chatty = heard.filter((v) => v.length > 1);
  ok('no live region changes while the call just sits there',
    chatty.length === 0, chatty.map((v) => v.join(' | ')).join('  //  '));
  ok('and the announced one says the call is connected',
    heard.some((v) => v.includes('متصل')), JSON.stringify(heard));
  // Not announced is not the same as not there: it stays on screen and in the
  // accessibility tree, reachable by navigating to it.
  ok('while the duration is still on screen',
    /[٠-٩]{2}:[٠-٩]{2}/.test(await p.locator('#wain-ai-panel header').textContent()));

  /**
   * And she must not be drawn speaking when nothing here knows that she is.
   *
   * `live` is the caller's turn, and in agent mode it is the whole call. The
   * widget keeps `isSpeaking` in its own state and dispatches only
   * `elevenlabs-convai:call` — read out of the published 0.18.1 bundle — so
   * there is no signal to animate from, and a mouth that moves for the whole
   * call is decoration wearing the clothes of a status light.
   */
  const talking = await p.evaluate(() =>
    [...document.querySelectorAll('.shouq')].filter((f) => f.classList.contains('shouq--talking')).length);
  ok('her mouth does not move on a call nobody here can hear', talking === 0, `${talking} faces talking`);
}

console.log('\n── she changes the screen, and now says so ──');
{
  /**
   * The call is full screen now — `fixed inset-0` — so the page she is
   * driving is ENTIRELY behind it, more so than when this was a 22rem card
   * over a 24.4rem viewport. `show_places` navigated and `open_place` opened
   * a profile, and the only account of either was شوق saying so out loud —
   * which a caller with the volume down, or who cannot hear her, never got.
   *
   * This is the one thing the call can report honestly, because it is our own
   * code doing it: the handler has the count and the name in hand.
   */
  const said = await p.evaluate(async () => window.__convaiConfig.clientTools.show_places({ query: 'قهوة' }));
  // Caught, not left to throw. An uncaught waitForFunction timeout takes the
  // whole process with it, so one red assertion would silently cancel every
  // section after it — which is exactly what this did the first time it was
  // deliberately failed, and is the same hole CLAUDE.md records under the
  // shouq-flow correction and again in live-map.test.mjs.
  const note = await p
    .waitForFunction(
      () => [...document.querySelectorAll('#wain-ai-panel [aria-live]')]
        .map((e) => e.textContent.trim()).find((t) => t.includes('دوّرت')) ?? null,
      null, { timeout: 5000 }
    )
    .then((h) => h.jsonValue())
    .catch(() => '');
  ok('the caller is told what she just searched for', note.includes('قهوة'), note || 'nothing was announced');
  // countAr, not a hand-written «٤ مكان». place-kit records this exact
  // agreement rule being got wrong by hand three separate times, the last of
  // them on /search's own result count.
  ok('with the count in agreeing Arabic', /[٠-٩]+ أماكن|مكان واحد|مكانين|[٠-٩]+ مكان|ما فيه أماكن/.test(note), note);
// The two names she is about to read out, so the sheet and her voice agree.
ok('and the names she reads out', /: \S+/.test(note), note);
  // `note` was read out of an [aria-live] element above, so «is it announced»
  // is already carried. An `ok(…, true)` beside it was written here first and
  // deleted: it passed under a build with the whole feature removed, which is
  // the one thing an assertion must never do.
  ok('while she is still told the same thing in her own words', /الخريطة/.test(String(said)), String(said).slice(0, 80));
}

console.log('\n── the agent can drive the interface ──');
const tools = await p.evaluate(() => Object.keys(window.__convaiConfig?.clientTools ?? {}));
ok('both client tools are registered before the widget loads', tools.includes('show_places') && tools.includes('open_place'), tools.join(', '));

const shown = await p.evaluate(() => window.__convaiConfig.clientTools.show_places({ query: 'قهوة هادية' }));
// Waiting for «/search» returns instantly from /search, and the assertion
// underneath then read the URL before the push had landed. Wait for the thing
// the tool actually changes.
await p.waitForURL((u) => decodeURIComponent(u.href).includes('قهوة هادية'), { timeout: 8000 });
ok('show_places puts the results on screen', decodeURIComponent(p.url()).includes('قهوة هادية'));
ok('show_places reports back to the agent', /قهوة هادية/.test(String(shown)), String(shown));
// The result is the model's cue for its post-tool turn. A bare status left
// that turn empty in every measured run — she had answered, the tool
// "succeeded", and the caller heard the screen change and then silence. So
// the result must say what is on the screen and tell her to hand the turn
// back; both halves are what the next turn is for.
ok('and tells her what the screen now shows', /على الخريطة/.test(String(shown)), String(shown));
ok('and tells her to hand the turn back', /يرجّع له الدور/.test(String(shown)), String(shown));
// And it tells her what is really there — the count the search page will
// show and the first names — rather than «the matching places» whatever the
// query. She used to confirm places on the map while the page said «ما لقينا
// شي».
ok('and tells her how many places matched, agreeing and in Arabic digits',
  /(مكان واحد مطابق|مكانين مطابقين|[٠-٩]+ أماكن مطابقة|[٠-٩]+ مكان مطابق)/.test(String(shown)), String(shown));
ok('and never the hand-written plural («40 أماكن»)', !/\d+ (مكان|أماكن)/.test(String(shown)), String(shown));
ok('and names the first of them', /أولها: \S+/.test(String(shown)), String(shown));
// Results are client-rendered, so wait for them rather than checking the
// instant the URL changes.
await p.waitForSelector('a[href^="/places/"]', { timeout: 8000 }).catch(() => {});
ok('the places really rendered', (await p.locator('a[href^="/places/"]').count()) > 0);

// The empty case comes AFTER the rendering check, because it navigates to a
// search that has nothing on it — asking «did places render» on that page is
// asking the wrong page. «زقزقة» is the query shouq-answers proves has no hit
// in the real index; a longer "nonsense" sentence is not nonsense to a fuzzy
// search, since «كلمة ما تطابق أي مكان» matched twenty places on «مكان» alone.
const none = await p.evaluate(() => window.__convaiConfig.clientTools.show_places({ query: 'زقزقة' }));
ok('a query that finds nothing says so, instead of claiming places are on the map',
  /ما لقيت ولا مكان/.test(String(none)) && !/الحين على الخريطة/.test(String(none)), String(none));
ok('and tells her to try a wider word rather than go quiet', /كلمة أوسع/.test(String(none)) && /لا تسكتين/.test(String(none)), String(none));

const opened = await p.evaluate(() => window.__convaiConfig.clientTools.open_place({ slug: 'kuwait-towers' }));
await p.waitForURL('**/places/kuwait-towers/**', { timeout: 8000 });
ok('open_place opens the full profile', p.url().includes('/places/kuwait-towers/'));
ok('open_place reports back to the agent', /kuwait-towers/.test(String(opened)));
ok('and tells her the page is open and to hand the turn back',
  /مفتوحة/.test(String(opened)) && /يرجّع له الدور/.test(String(opened)), String(opened));
ok('and names the place that opened, so she can say it', /أبراج الكويت/.test(String(opened)), String(opened));
// A well-formed slug that is not in the catalogue used to navigate to a 404
// and then tell her the page was open.
const ghostBefore = p.url();
const ghost = await p.evaluate(() => window.__convaiConfig.clientTools.open_place({ slug: 'no-such-place-zz' }));
await p.waitForTimeout(600);
ok('a slug that is not a place is refused, not opened',
  /ما تغيّر شي على الشاشة/.test(String(ghost)) && !/مفتوحة قدام/.test(String(ghost)), String(ghost));
ok('and did not navigate', p.url() === ghostBefore, p.url());
// The sheet must not contradict her «ما لقيت» with an old «فتحت لك صفحة …».
const refusedNote = await p
  .waitForFunction(
    () => [...document.querySelectorAll('#wain-ai-panel [aria-live]')]
      .map((e) => e.textContent.trim()).find((t) => t.includes('ما لقيت هالمكان')) ?? null,
    null, { timeout: 4000 }
  )
  .then((h) => h.jsonValue())
  .catch(() => '');
ok('the sheet says the place was not found, instead of keeping the last page it opened', !!refusedNote, refusedNote);

console.log('\n── the tools refuse nonsense rather than acting on it ──');
const before = p.url();
// The tools are async now (they load the search index), so the refusals are
// promises and have to be awaited before String() — «[object Promise]» is
// what a missing await looks like here.
const bad = await p.evaluate(() => Promise.all([
  window.__convaiConfig.clientTools.open_place({ slug: '../../etc/passwd' }),
  window.__convaiConfig.clientTools.open_place({ slug: 'Kuwait Towers' }),
  window.__convaiConfig.clientTools.open_place({}),
  window.__convaiConfig.clientTools.show_places({ query: '   ' }),
]).then((results) => results.map(String)));
await p.waitForTimeout(600);
// A refusal is also a tool result she speaks from, so it says the one thing
// that matters to the caller — nothing on the screen changed — rather than a
// status code in a language she does not answer in.
const refused = (s) => /ما تغيّر شي على الشاشة/.test(s) && !/الحين على الخريطة|مفتوحة قدام/.test(s);
ok('a traversal slug is rejected', refused(bad[0]), bad[0]);
ok('a slug with spaces and capitals is rejected', refused(bad[1]), bad[1]);
ok('a missing slug is rejected', refused(bad[2]), bad[2]);
ok('an empty query is rejected', refused(bad[3]), bad[3]);
ok('none of them navigated anywhere', p.url() === before, p.url());

/**
 * What happens BEFORE the tap, and what happens when the bundle never comes.
 *
 * Both are about the same seconds. The chain used to be strictly serial and to
 * start at the tap — chunk, mount, cold DNS+TLS to the CDN, 451KB, then a cold
 * DNS+TLS to ElevenLabs — with the caller listening to ring-back through all
 * of it. And when it failed there was no failure: the script's error was never
 * turned into one, so the sheet rang for the full twenty-second dial timeout
 * and then blamed the microphone.
 */
console.log('\n── the call is warmed before it is placed ──');
{
  const warmCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-KW' });
  const fetched = [];
  await warmCtx.route('**/unpkg.com/**', async (route) => {
    fetched.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  const w = await warmCtx.newPage();
  // /find: the one page with a button to warm from.
  await w.goto(B + '/find/', { waitUntil: 'networkidle' });

  const links = () => w.evaluate(() => [...document.querySelectorAll('link[rel=preconnect]')]
    .map((l) => `${new URL(l.href).origin}${l.crossOrigin ? ' [cors]' : ''}`));
  ok('nothing is warmed for a visitor who never reaches for her',
    !(await links()).some((l) => /unpkg|elevenlabs/.test(l)) && fetched.length === 0,
    (await links()).join(', '));

  await w.locator('button[aria-controls="wain-ai-panel"]').first().hover();
  await w.waitForTimeout(200);
  const warm = await links();
  // The CDN is reached by a plain <script> — a no-CORS request — so warming it
  // WITH crossorigin would open a pool entry the script cannot use. The API's
  // fetches are CORS and need the opposite. Getting this backwards is the
  // classic way to make a preconnect cost a connection instead of saving one.
  ok('a hover warms the CDN, without crossorigin', warm.includes('https://unpkg.com'), warm.join(', '));
  ok('and the session host, with it', warm.includes('https://api.elevenlabs.io [cors]'), warm.join(', '));
  ok('but a hover does not pull half a megabyte', fetched.length === 0, fetched.join(', '));

  await w.mouse.down();
  await w.waitForTimeout(400);
  ok('a finger already down does fetch it', fetched.length === 1, fetched.join(', '));
  await w.mouse.up();
  await warmCtx.close();
}

console.log('\n── a bundle that never arrives fails the call, quickly ──');
{
  // A working microphone, so the failure under test is the bundle's and not
  // the preflight's; the later-registered route wins over makeCtx's stub.
  const deadCtx = await makeCtx(null, []);
  await deadCtx.route('**/unpkg.com/**', (route) => route.abort('failed'));
  const d = await deadCtx.newPage();
  await d.goto(B + '/find/', { waitUntil: 'networkidle' });
  const t0 = Date.now();
  await d.locator('button[aria-controls="wain-ai-panel"]').first().click();
  let took = -1;
  try {
    await d.waitForFunction(
      () => document.querySelector('#wain-ai-panel')?.textContent.includes('ما قدرنا نوصلك'),
      null, { timeout: 12000 }
    );
    took = Date.now() - t0;
  } catch { /* left at -1 */ }
  // DIAL_TIMEOUT_MS is 20s and is the LAST resort, for a call that hangs. A
  // load that has already errored must not wait for it.
  ok(`it says so in seconds, not at the 20s dial timeout (${took}ms)`, took >= 0 && took < 10000, String(took));
  const after = await d.locator('#wain-ai-panel').textContent();
  ok('and offers the call again', after.includes('اتصل مرة ثانية'), after.slice(0, 120));
  await deadCtx.close();
}

console.log('\n── a microphone that cannot be had is SAID, not swallowed ──');
/* «She didn't hear my voice and nothing told me.» With the mic refused, absent
   or held by another app, the widget reports it (if at all) inside its own
   small UI — and the sheet, meanwhile, would sit there looking connected. The
   preflight turns each into the sentence the local path already uses. */
for (const [name, want, label] of [
  ['NotAllowedError', 'ما وصلنا صوتك', 'refused'],
  ['NotFoundError', 'ما لقينا مايك', 'absent'],
  ['NotReadableError', 'المايك مشغول', 'held by another app'],
]) {
  const mctx = await makeCtx(name, []);
  const m = await mctx.newPage();
  await dial(m);
  let text = '';
  try {
    await m.waitForFunction(
      (w) => document.querySelector('#wain-ai-panel [role="alert"]')?.textContent.includes(w),
      want, { timeout: 8000 }
    );
    text = await m.locator('#wain-ai-panel [role="alert"]').textContent();
  } catch { text = (await m.locator('#wain-ai-panel').textContent()).slice(0, 140); }
  ok(`a microphone ${label} says so (${name})`, text.includes(want), text);
  ok(`and does not offer to talk to a widget that cannot hear (${name})`,
    !(await m.locator('#wain-ai-panel').textContent()).includes('اضغط «بدء مكالمة»'));
  await mctx.close();
}

ok('no page errors anywhere in agent mode', errors.length === 0, errors.join(' | '));

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
