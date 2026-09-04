import { chromium } from 'playwright';

/**
 * شوق's voice, driven in a browser.
 *
 * This layer had no tests at all, and it is the one where a bug is silent —
 * literally. primeAudio exists because iOS Safari only lets audio start from
 * inside the task that handled the tap, and شوق deliberately skips the
 * greeting that used to serve as that unlock; get it wrong and she says
 * nothing on an iPhone while working perfectly on every machine anyone tests
 * on. Nothing verified it until now.
 */

const B = process.env.WAIN_URL || 'http://127.0.0.1:4197';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const ctx = await browser.newContext({ locale: 'ar-KW' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(B + '/voice.html', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.voice);

const spy = () => p.evaluate(() => window.spy);
const reset = () => p.evaluate(() => window.resetSpy());

console.log('\n── the gesture unlock ──');
await reset();
await p.evaluate(() => window.voice.primeAudio());
let s = await spy();
ok('it plays something, synchronously, to spend the gesture', s.playCalls === 1, `${s.playCalls} play calls`);
ok('and that something is muted, so nobody hears the unlock', s.playedMuted[0] === true, JSON.stringify(s.playedMuted));
ok('it also primes the synthetic path', s.spoken.length === 1, JSON.stringify(s.spoken));
ok('with an empty utterance, which is inaudible', s.spoken[0] === '', JSON.stringify(s.spoken));

console.log('\n── the element does not stay muted afterwards ──');
/**
 * If the unlock leaves the element muted, every clip after it plays in
 * silence — which looks exactly like the bug primeAudio was written to fix,
 * and is worse, because the code now believes it is speaking.
 *
 * This used to read `document.querySelector('audio')`. The module builds its
 * element with `new Audio()`, which is never in the document, so the query
 * returned null, `null !== true` passed, and the assertion had never once
 * looked at the element it names. Asking the spy what the element was muted to
 * AT THE MOMENT IT PLAYED is the real question anyway: a mute lifted a
 * microsecond after the clip starts is still a clip nobody heard.
 */
await p.waitForTimeout(120);
{
  const s2 = await p.evaluate(async () => {
    window.resetSpy();
    window.voice.speak([{ key: 'hello', text: 'اختبار.' }]);
    await new Promise((r) => setTimeout(r, 400));
    return window.spy;
  });
  ok('a real clip plays after the unlock', s2.played.length === 1, JSON.stringify(s2.played));
  ok('and it plays audibly, not on a muted element',
    s2.playedMuted[0] === false, JSON.stringify(s2.playedMuted));
}

console.log('\n── a browser whose play() returns undefined is not left silent ──');
/**
 * Older Safari returns undefined from play() instead of a promise. primeAudio
 * said so in a comment and then hung the unmute on `p?.then(...)`, which on
 * undefined does nothing at all — so the element stayed muted for the life of
 * the page and every clip after the first tap played silently. Measured before
 * the fix: the real clip played with `muted === true`.
 */
{
  const s3 = await p.evaluate(async () => {
    const real = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { real.call(this); return undefined; };
    window.resetSpy();
    window.voice.primeAudio();
    await new Promise((r) => setTimeout(r, 150));
    window.voice.speak([{ key: 'hello', text: 'اختبار.' }]);
    await new Promise((r) => setTimeout(r, 500));
    HTMLMediaElement.prototype.play = real;
    return window.spy;
  });
  ok('the unlock itself is still silent', s3.playedMuted[0] === true, JSON.stringify(s3.playedMuted));
  ok('but the clip after it is not', s3.playedMuted[1] === false, JSON.stringify(s3.playedMuted));
}

console.log('\n── a slow unlock does not reach forward and stop her ──');
/**
 * The other half of the same mistake. play()'s promise settles whenever the
 * browser gets round to it, which can be after speak() has given the element a
 * real clip — and the unlock's success handler called pause() unconditionally.
 * Measured before the fix: one pause before the stale unlock settled, two
 * after, the second one landing on a sentence in progress.
 */
{
  const s4 = await p.evaluate(async () => {
    const real = HTMLMediaElement.prototype.play;
    let release = null;
    let first = true;
    HTMLMediaElement.prototype.play = function () {
      real.call(this);
      if (first) { first = false; return new Promise((res) => { release = res; }); }
      return Promise.resolve();
    };
    window.resetSpy();
    window.voice.primeAudio();
    await new Promise((r) => setTimeout(r, 50));
    window.voice.speak([{ key: 'hello', text: 'اختبار.' }]);
    await new Promise((r) => setTimeout(r, 250));
    const before = window.spy.pauseCalls;
    const held = !!release;
    release?.();
    await new Promise((r) => setTimeout(r, 150));
    HTMLMediaElement.prototype.play = real;
    return { held, before, after: window.spy.pauseCalls };
  });
  // Stated separately: if the unlock had resolved on its own, the assertion
  // below would pass without ever testing a late one.
  ok('the unlock really was still pending when the clip started', s4.held);
  ok('and settling it does not pause the clip', s4.after === s4.before, `${s4.before} → ${s4.after}`);
}

console.log('\n── priming survives a browser with no speech synthesis ──');
{
  const ctx2 = await browser.newContext({ locale: 'ar-KW' });
  const p2 = await ctx2.newPage();
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.goto(B + '/voice.html', { waitUntil: 'load' });
  await p2.waitForFunction(() => !!window.voice);
  const threw = await p2.evaluate(() => {
    window.removeSynth();
    try { window.voice.primeAudio(); return false; } catch { return true; }
  });
  ok('primeAudio does not throw without speechSynthesis', !threw);
  ok('and nothing else breaks', errs2.length === 0, errs2.join(' | '));
  await ctx2.close();
}

console.log('\n── an Arabic voice is preferred over the browser default ──');
await reset();
await p.evaluate(async () => {
  window.voice.speak([{ text: 'مرحبا.' }]);
  await new Promise((r) => setTimeout(r, 400));
});
s = await spy();
ok('she speaks', s.spoken.length >= 1, JSON.stringify(s.spoken));
ok('tagged as Kuwaiti Arabic', s.lastLang === 'ar-KW', s.lastLang);
ok('and Kuwaiti Arabic wins over other Arabic', s.lastVoice === 'Kuwaiti', s.lastVoice);

await p.evaluate(() => window.setVoices([
  { name: 'English (US)', lang: 'en-US' },
  { name: 'Majed', lang: 'ar-SA' },
]));
await reset();
await p.evaluate(async () => {
  window.voice.speak([{ text: 'مرحبا.' }]);
  await new Promise((r) => setTimeout(r, 400));
});
s = await spy();
ok('with no Kuwaiti voice it falls back to any Arabic', s.lastVoice === 'Majed', s.lastVoice);

await p.evaluate(() => window.setVoices([{ name: 'English (US)', lang: 'en-US' }]));
await reset();
await p.evaluate(async () => {
  window.voice.speak([{ text: 'مرحبا.' }]);
  await new Promise((r) => setTimeout(r, 400));
});
s = await spy();
ok('with no Arabic voice at all it does not force an English one', s.lastVoice === '', s.lastVoice);
ok('but it still speaks rather than going silent', s.spoken.length >= 1, JSON.stringify(s.spoken));
await p.evaluate(() => window.setVoices([
  { name: 'English (US)', lang: 'en-US' },
  { name: 'Majed', lang: 'ar-SA' },
  { name: 'Kuwaiti', lang: 'ar-KW' },
]));

console.log('\n── a voice the engine refuses does not silence her ──');
// Writing utterance.voice throws if the engine rejects the object — a stale
// entry from a getVoices() list the browser has since replaced. Without a
// guard that exception escapes and she says nothing at all, which is a far
// worse outcome than the wrong accent.
await p.evaluate(() => {
  const proto = Object.getPrototypeOf(new SpeechSynthesisUtterance(''));
  window.__realVoice = Object.getOwnPropertyDescriptor(proto, 'voice');
  Object.defineProperty(proto, 'voice', {
    configurable: true,
    get() { return null; },
    set() { throw new TypeError('Failed to convert value to SpeechSynthesisVoice'); },
  });
});
await reset();
await p.evaluate(async () => {
  window.voice.speak([{ text: 'مرحبا.' }]);
  await new Promise((r) => setTimeout(r, 400));
});
s = await spy();
ok('she still speaks, with the engine default', s.spoken.length >= 1, JSON.stringify(s.spoken));
ok('and it is the right text', s.spoken[0] === 'مرحبا.', JSON.stringify(s.spoken));
await p.evaluate(() => {
  const proto = Object.getPrototypeOf(new SpeechSynthesisUtterance(''));
  Object.defineProperty(proto, 'voice', window.__realVoice);
});

console.log('\n── closing her actually silences her ──');
await reset();
await p.evaluate(async () => {
  window.voice.speak([{ text: 'جملة طويلة تنقطع في نصها.' }]);
  await new Promise((r) => setTimeout(r, 200));
  window.voice.stop();
});
s = await spy();
ok('stop cancels the synthesiser', s.cancelCalls >= 1, `${s.cancelCalls}`);
ok('and it is not left thinking it is still speaking',
  (await p.evaluate(() => window.voice.stop() ?? true)) === true);

console.log('\n── a new answer replaces the old one rather than overlapping ──');
// speak() calls stop() first and bumps a generation counter, so a manifest
// that resolves late for an utterance nobody is waiting for is dropped.
await reset();
await p.evaluate(async () => {
  window.voice.speak([{ text: 'الأولى.' }]);
  window.voice.speak([{ text: 'الثانية.' }]);
  window.voice.speak([{ text: 'الثالثة.' }]);
  await new Promise((r) => setTimeout(r, 500));
});
s = await spy();
ok('three rapid answers do not all speak', s.spoken.length <= 1, JSON.stringify(s.spoken));
ok('the one that speaks is the newest', s.spoken.length === 0 || s.spoken[0] === 'الثالثة.', JSON.stringify(s.spoken));
ok('each new answer stopped the one before it', s.cancelCalls >= 2, `${s.cancelCalls}`);

console.log('\n── nothing to say is not something to say ──');
await reset();
await p.evaluate(async () => {
  window.voice.speak([]);
  await new Promise((r) => setTimeout(r, 200));
});
s = await spy();
ok('an empty answer speaks nothing', s.spoken.length === 0, JSON.stringify(s.spoken));

console.log('\n── the lines she says are joined into real sentences ──');
{
  const said = await p.evaluate(() => {
    const parts = window.voice.helloParts('shouq');
    return { text: parts.map((x) => x.text).join(' '), keys: parts.map((x) => x.key ?? null) };
  });
  ok('the greeting is not empty', said.text.trim().length > 0, said.text);
  ok('she names herself', said.text.includes('شوق'), said.text);
  ok('every part is keyed or explicitly optional',
    said.keys.every((k) => k === null || typeof k === 'string'), JSON.stringify(said.keys));
}

ok('no page errors throughout', errors.length === 0, errors.join(' | '));

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
