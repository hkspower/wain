import { chromium } from 'playwright';

/**
 * The live bridge — شوق's third rendering path.
 *
 * The clip library covers every sentence written down in advance. The bridge
 * covers the ones assembled at runtime, which is precisely where she used to
 * stop being herself and the browser's robot took over mid-answer.
 *
 * This runs against a harness bundled with NEXT_PUBLIC_WAIN_TTS_URL set, which
 * the shipping build does not have. That is deliberate: the whole feature is a
 * build-time switch, and a test that cannot turn the switch on is testing the
 * other branch. Every response is fulfilled by Playwright rather than by a
 * server, so each failure mode is exact rather than approximated.
 *
 * What is under test is not the audio — it is the decision. For every reason
 * the bridge might not produce a usable sentence, does the visitor still hear
 * one?
 */

const B = process.env.WAIN_URL || 'http://127.0.0.1:4198';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const ctx = await browser.newContext({ locale: 'ar-KW' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

/** Every request the page made to the bridge, with its body. */
const calls = [];

/** How the next bridge call is answered. Set per scenario. */
let mode = 'ok';

// A tiny but genuine MP3 frame header plus padding: the size guard in voice.ts
// rejects anything under 512 bytes, and a body that fails the guard would pass
// this test for the wrong reason.
const MP3 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(2048)]);

await page.route('**/tts', async (route) => {
  const req = route.request();
  calls.push({ method: req.method(), body: req.postDataJSON?.() ?? null });
  if (mode === 'ok') return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: MP3 });
  if (mode === 'error') return route.fulfill({ status: 500, contentType: 'text/plain', body: 'nope' });
  // The trap this exists for: a 200 that is not audio plays as silence, and
  // silence is indistinguishable from her having ignored the visitor.
  if (mode === 'html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>error page</html>' });
  if (mode === 'empty') return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: '' });
  if (mode === 'slow') { await new Promise((r) => setTimeout(r, 6000)); return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: MP3 }); }
  return route.abort();
});

await page.goto(B + '/voice.html', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.voice);

/**
 * Did a bridge render actually play?
 *
 * The harness records `new URL(src, location.href).pathname`, and for a blob
 * URL that pathname is the whole origin-qualified uuid — «http://host/<uuid>»,
 * with the `blob:` scheme consumed as the protocol. So a live render is
 * recognised by that shape, and a recorded clip by its `/voice/...` path.
 * Checking for a literal `blob:` prefix fails against working code, which is
 * how this comment came to exist.
 */
const BLOB = /^https?:\/\/[^/]+\/[0-9a-f-]{36}$/i;
const playedLive = (played) => played.some((u) => BLOB.test(String(u)));

/** Speak an utterance with no clip behind it, and wait for it to settle. */
const sayUnrecorded = (ms = 900) => page.evaluate(async (wait) => {
  window.resetSpy();
  // No key at all — a sentence built at runtime, which is exactly the case the
  // bridge exists for and the case the clip resolver refuses.
  window.voice.speak([{ text: 'مقهى ما عليه تسجيل، اسمه اتولّد الحين' }]);
  await new Promise((r) => setTimeout(r, wait));
  return { played: window.spy.played, spoken: window.spy.spoken };
}, ms);

// ---------------------------------------------------------------------------
console.log('\n── a runtime sentence goes to the bridge, in her voice ──');
{
  mode = 'ok';
  calls.length = 0;
  const s = await sayUnrecorded();
  ok('the bridge was called', calls.length === 1, `${calls.length} calls`);
  ok('with POST', calls[0]?.method === 'POST', calls[0]?.method);
  ok('naming the active persona', calls[0]?.body?.persona === 'shouq', JSON.stringify(calls[0]?.body));
  ok('and the sentence', /مقهى/.test(calls[0]?.body?.text ?? ''), JSON.stringify(calls[0]?.body));
  ok('her voice played', playedLive(s.played), JSON.stringify(s.played));
  ok('and the robot did not', s.spoken.length === 0, JSON.stringify(s.spoken));
}

// ---------------------------------------------------------------------------
console.log('\n── a clip-covered sentence never reaches the bridge ──');
{
  // The bridge costs an API call per utterance. Anything already recorded must
  // not pay it, and this is the assertion that keeps a refactor honest.
  mode = 'ok';
  calls.length = 0;
  const s = await page.evaluate(async () => {
    window.resetSpy();
    window.voice.speak([{ key: 'suggest-intro', text: 'أ' }]);
    await new Promise((r) => setTimeout(r, 600));
    return { played: window.spy.played, spoken: window.spy.spoken };
  });
  ok('the bridge was not called', calls.length === 0, `${calls.length} calls`);
  ok('the recorded clip played instead', s.played.some((u) => String(u).includes('/voice/')), JSON.stringify(s.played));
}

// ---------------------------------------------------------------------------
console.log('\n── every way the bridge can fail still speaks ──');
for (const [m, label] of [
  ['error', 'the bridge returns 500'],
  ['html', 'the bridge returns a 200 that is not audio'],
  ['empty', 'the bridge returns an empty body'],
  ['abort', 'the bridge is unreachable'],
]) {
  mode = m;
  calls.length = 0;
  const s = await sayUnrecorded();
  ok(`${label}: the browser voice speaks`, s.spoken.length === 1, JSON.stringify(s.spoken));
  ok(`${label}: and nothing silent is played as if it worked`,
    !playedLive(s.played), JSON.stringify(s.played));
}

// ---------------------------------------------------------------------------
console.log('\n── a slow bridge gives the line up rather than buying silence ──');
{
  // The honest cost of the feature. A configured-but-slow bridge must not hold
  // the visitor in silence for ever; voice.ts caps the wait at four seconds and
  // hands the sentence to the browser. Waited out to six here so the cap is
  // what ends it, not the test.
  mode = 'slow';
  calls.length = 0;
  const started = Date.now();
  const s = await sayUnrecorded(5200);
  const elapsed = Date.now() - started;
  ok('the browser voice took over', s.spoken.length === 1, JSON.stringify(s.spoken));
  ok('within the deadline, not after the slow response', elapsed < 6000, `${elapsed}ms`);
  ok('and the slow audio never played over the top of it',
    !playedLive(s.played), JSON.stringify(s.played));
}

// ---------------------------------------------------------------------------
console.log('\n── the persona follows the picker ──');
{
  mode = 'ok';
  calls.length = 0;
  await page.evaluate(() => window.voice.setPersona('salem'));
  await sayUnrecorded();
  ok('سالم is asked for by name', calls.at(-1)?.body?.persona === 'salem', JSON.stringify(calls.at(-1)?.body));
  await page.evaluate(() => window.voice.setPersona('shouq'));
}

ok('no page errors anywhere', errors.length === 0, errors.join(' | '));

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
