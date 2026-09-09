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
 */
const B = process.env.WAIN_URL || 'http://localhost:4190';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW' });
const requested = [];
await ctx.route('**/unpkg.com/**', async (route) => {
  requested.push(route.request().url());
  await route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      class ConvaiStub extends HTMLElement {
        connectedCallback() {
          window.__convaiAgentId = this.getAttribute('agent-id');
          // The real widget dispatches this so the host can inject client tools.
          const ev = new CustomEvent('elevenlabs-convai:call', { detail: { config: {} } });
          window.dispatchEvent(ev);
          window.__convaiConfig = ev.detail.config;
        }
      }
      customElements.define('elevenlabs-convai', ConvaiStub);
      window.__convaiLoaded = true;
    `,
  });
});
await ctx.addInitScript(() => {
  window.__vibrations = [];
  navigator.vibrate = () => true;
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak() {}, cancel() {}, getVoices: () => [] } });
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));

console.log('\n── with an agent configured, the call goes to her, not the recogniser ──');
await p.goto(B + '/search/', { waitUntil: 'networkidle' });
const fab = p.locator('button[aria-label*="وين AI"]');
await fab.click();
await p.waitForSelector('#wain-ai-panel', { timeout: 6000 });
ok('one tap places the call', true);
// In agent mode the tap opens a conversation; it must NOT fall through to the
// dictation flow, which would push a query. The call is placed from /search
// now, so «is it still off /search» proves nothing — the absence of ?q= does.
ok('it stays put rather than searching', !p.url().includes('q='), p.url());

const panel = await p.locator('#wain-ai-panel').textContent();
ok('she introduces herself as شوق', panel.includes('شوق'));
// Which of the two appears depends on whether the stubbed widget has finished
// loading yet — the greeting carries the ringing seconds, the examples take
// over once she is on the line. Either is her telling you what to say; which
// one is a race this assertion has no business caring about.
ok('she tells the visitor what to say',
  panel.includes('قول لي وش تبي') || panel.includes('قهوة هادية'), panel.slice(0, 120));
ok('the microphone note is shown', panel.includes('المايك'));
ok('and the call can be hung up', panel.includes('إنهاء المكالمة'));
// next.config sets trailingSlash, so the rendered href is "/privacy/".
ok('the privacy page is one tap away', (await p.locator('#wain-ai-panel a[href^="/privacy"]').count()) === 1);

console.log('\n── the widget is loaded on demand, from a pinned URL ──');
await p.waitForFunction(() => window.__convaiLoaded === true, null, { timeout: 8000 });
ok('the bundle is fetched only after she is opened', requested.length === 1, requested.join(', '));
ok('the URL is version-pinned, not floating', /convai-widget-embed@\d/.test(requested[0]), requested[0]);
await p.waitForFunction(() => !!window.__convaiAgentId, null, { timeout: 8000 });
ok('the element is created with the configured agent', (await p.evaluate(() => window.__convaiAgentId)) === 'agent_test_0123456789');

// The widget owning the microphone IS the call connecting — until then the
// sheet must still be ringing, or the timer would start before she can hear
// anything.
await p.waitForFunction(
  () => document.querySelector('#wain-ai-panel')?.textContent.includes('متصل'),
  null, { timeout: 8000 }
);
ok('the call reports itself connected once the widget is up', true);
ok('and the timer is running', /[٠-٩]{2}:[٠-٩]{2}/.test(await p.locator('#wain-ai-panel').textContent()));

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
ok('and tells her how many places matched', /\d+ (مكان مطابق|أماكن مطابقة)/.test(String(shown)), String(shown));
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

ok('no page errors anywhere in agent mode', errors.length === 0, errors.join(' | '));

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
