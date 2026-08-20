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

console.log('\n── with an agent configured, the hold opens her instead of the recogniser ──');
await p.goto(B + '/', { waitUntil: 'networkidle' });
const fab = p.locator('button[aria-label*="وين AI"]');
await fab.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0, pointerId: 1 });
await p.waitForTimeout(3400);
await p.waitForSelector('#wain-ai-panel', { timeout: 6000 });
ok('the panel opens', true);
ok('it stays put rather than searching', !p.url().includes('/search'));

const panel = await p.locator('#wain-ai-panel').textContent();
ok('she introduces herself as شوق', panel.includes('شوق'));
ok('she explains what to say', panel.includes('كلّمها') || panel.includes('أبي قهوة'));
ok('the microphone note is shown', panel.includes('المايك'));
// next.config sets trailingSlash, so the rendered href is "/privacy/".
ok('the privacy page is one tap away', (await p.locator('#wain-ai-panel a[href^="/privacy"]').count()) === 1);

console.log('\n── the widget is loaded on demand, from a pinned URL ──');
await p.waitForFunction(() => window.__convaiLoaded === true, null, { timeout: 8000 });
ok('the bundle is fetched only after she is opened', requested.length === 1, requested.join(', '));
ok('the URL is version-pinned, not floating', /convai-widget-embed@\d/.test(requested[0]), requested[0]);
await p.waitForFunction(() => !!window.__convaiAgentId, null, { timeout: 8000 });
ok('the element is created with the configured agent', (await p.evaluate(() => window.__convaiAgentId)) === 'agent_test_0123456789');

console.log('\n── the agent can drive the interface ──');
const tools = await p.evaluate(() => Object.keys(window.__convaiConfig?.clientTools ?? {}));
ok('both client tools are registered before the widget loads', tools.includes('show_places') && tools.includes('open_place'), tools.join(', '));

const shown = await p.evaluate(() => window.__convaiConfig.clientTools.show_places({ query: 'قهوة هادية' }));
await p.waitForURL('**/search**', { timeout: 8000 });
ok('show_places puts the results on screen', decodeURIComponent(p.url()).includes('قهوة هادية'));
ok('show_places reports back to the agent', /قهوة هادية/.test(String(shown)), String(shown));
// Results are client-rendered, so wait for them rather than checking the
// instant the URL changes.
await p.waitForSelector('a[href^="/places/"]', { timeout: 8000 }).catch(() => {});
ok('the places really rendered', (await p.locator('a[href^="/places/"]').count()) > 0);

const opened = await p.evaluate(() => window.__convaiConfig.clientTools.open_place({ slug: 'kuwait-towers' }));
await p.waitForURL('**/places/kuwait-towers/**', { timeout: 8000 });
ok('open_place opens the full profile', p.url().includes('/places/kuwait-towers/'));
ok('open_place reports back to the agent', /kuwait-towers/.test(String(opened)));

console.log('\n── the tools refuse nonsense rather than acting on it ──');
const before = p.url();
const bad = await p.evaluate(() => [
  window.__convaiConfig.clientTools.open_place({ slug: '../../etc/passwd' }),
  window.__convaiConfig.clientTools.open_place({ slug: 'Kuwait Towers' }),
  window.__convaiConfig.clientTools.open_place({}),
  window.__convaiConfig.clientTools.show_places({ query: '   ' }),
].map(String));
await p.waitForTimeout(600);
ok('a traversal slug is rejected', bad[0] === 'unknown place', bad[0]);
ok('a slug with spaces and capitals is rejected', bad[1] === 'unknown place', bad[1]);
ok('a missing slug is rejected', bad[2] === 'unknown place', bad[2]);
ok('an empty query is rejected', bad[3] === 'empty query', bad[3]);
ok('none of them navigated anywhere', p.url() === before, p.url());

ok('no page errors anywhere in agent mode', errors.length === 0, errors.join(' | '));

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
