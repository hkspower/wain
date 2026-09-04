import { chromium } from 'playwright';

/**
 * شوق's recorded voice — the playback path that had no tests.
 *
 * voice.ts has two ways to speak and only one of them was ever exercised.
 * Every existing assertion drives the synthetic fallback, because the clip
 * path needs a manifest and real MP3s and neither existed in the repository.
 * So the resolver, the queue, and the all-or-nothing rule — the code that runs
 * in production the moment the clips are generated — ran nowhere.
 *
 * The fixtures are espeak-ng placeholders (scripts/gen-voice-fixture.mjs) laid
 * out exactly as public/voice/ is, and the test server hands them over at the
 * real URLs. voice.ts cannot tell them from the real thing, which is the point:
 * what is under test is the plumbing, not the voice.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Without the fixtures every assertion below fails for the same uninformative
// reason — a 404 — so say the useful thing once instead of fifteen times.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/voice');
if (!existsSync(join(FIXTURES, 'manifest.json'))) {
  console.error('tests/fixtures/voice is missing — run: npm run voice:fixture');
  process.exit(1);
}

const B = process.env.WAIN_URL || 'http://127.0.0.1:4197';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const ctx = await browser.newContext({ locale: 'ar-KW' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const requested = [];
page.on('request', (r) => { if (r.url().includes('/voice/')) requested.push(new URL(r.url()).pathname); });

await page.goto(B + '/voice.html', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.voice);

/**
 * Speak, then wait for the queue to actually drain.
 *
 * This used to sleep a flat 400ms, which was long enough only because clips
 * ran into each other with no pause at all. There is a real beat between
 * sentences now, so a fixed sleep would either read the spy mid-answer or have
 * to be padded to whatever the beat happens to be — a test that has to be
 * retuned every time the timing changes is a test that cannot check the
 * timing. Polling the module's own `speaking` flag asks the right question.
 */
const say = (parts) => page.evaluate(async (p) => {
  window.resetSpy();
  window.voice.speak(p);
  const size = () => window.spy.played.length + window.spy.spoken.length;
  const until = Date.now() + 5000;
  let last = -1;
  let stableSince = Date.now();
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 25));
    const n = size();
    if (n !== last) { last = n; stableSince = Date.now(); continue; }
    // Quiet for longer than the beat between two sentences: she is finished.
    if (Date.now() - stableSince > 400 && (last > 0 || Date.now() - stableSince > 1200)) break;
  }
  return window.spy;
}, parts);

// ---------------------------------------------------------------------------
console.log('\n── the fixtures are real audio, not empty files ──');
// If this fails, every assertion below is testing a manifest against nothing.
// Decoded rather than merely loaded. <audio>.duration reports Infinity here —
// lame writes no Xing header at this bitrate, so Chromium cannot know the
// length until it plays the file through — and asserting on that number would
// be testing the encoder's headers, not whether the bytes are audio.
// decodeAudioData answers the actual question: does this parse to samples?
{
  const meta = await page.evaluate(async () => {
    try {
      const buf = await (await fetch('/voice/shouq/hello.mp3')).arrayBuffer();
      const audio = await new (window.AudioContext || window.webkitAudioContext)()
        .decodeAudioData(buf);
      return { bytes: buf.byteLength, seconds: audio.duration, error: null };
    } catch (e) {
      return { error: String(e) };
    }
  });
  ok('hello.mp3 decodes to real samples', meta.error === null, JSON.stringify(meta));
  ok('and it is several seconds of speech, not an empty file',
    meta.seconds > 1 && meta.seconds < 60, JSON.stringify(meta));
}

// ---------------------------------------------------------------------------
console.log('\n── the rest of the answer is fetched while the first clip plays ──');
/**
 * This runs first on purpose: it is the only assertion here that cares about
 * network requests, and every section below leaves its clips in the browser
 * cache, where a request event may never be emitted at all.
 *
 * The element used to fetch each clip at the moment it became due — the one
 * moment the visitor can hear. Measured against a 350ms link, that put ~358ms
 * of silence in front of every sentence after the first, 1.9 seconds of an
 * answer spent waiting, all of it in the gaps. The fix is to ask for the rest
 * up front; what proves it is that the later clips are requested while the
 * first one is still playing, not after it ends.
 */
{
  const three = [
    { key: 'suggest-intro', text: 'أقترح عليك:' },
    { key: 'place-kuwait-towers', text: 'أبراج الكويت…' },
    { key: 'best-kuwait-towers', text: 'أحلى وقت…' },
  ];
  const before = requested.length;
  const s = await page.evaluate(async (parts) => {
    window.setAutoEnd(false); // hold on the first clip, as a long line would
    window.resetSpy();
    window.voice.speak(parts);
    await new Promise((r) => setTimeout(r, 400));
    const played = [...window.spy.played];
    window.voice.stop();
    window.setAutoEnd(true);
    return { played };
  }, three);

  const asked = requested.slice(before);
  ok('only the first clip has started playing', s.played.length === 1, JSON.stringify(s.played));
  ok('but all three have already been asked for',
    ['suggest-intro', 'place-kuwait-towers', 'best-kuwait-towers']
      .every((k) => asked.includes(`/voice/shouq/${k}.mp3`)),
    asked.join(' '));
  // The first clip is deliberately NOT prefetched: the element is already
  // loading it, and a second request races the element's own for a connection.
  // Warming all five moved the delay to the worst possible place — measured,
  // it pushed the first clip from 431ms to 771ms.
  const firstTwice = asked.filter((u) => u === '/voice/shouq/suggest-intro.mp3').length;
  ok('and the one already loading was not asked for twice', firstTwice === 1, `${firstTwice} requests`);
}

// ---------------------------------------------------------------------------
console.log('\n── a recorded line is played, not synthesised ──');
{
  const s = await say([{ key: 'hello', text: 'ignored when a clip exists' }]);
  ok('the clip is played', s.played.includes('/voice/shouq/hello.mp3'), JSON.stringify(s.played));
  ok('and nothing is spoken by the synthesiser', s.spoken.length === 0, JSON.stringify(s.spoken));
}

// ---------------------------------------------------------------------------
console.log('\n── a multi-part answer plays every clip, in order ──');
// The queue advances on 'ended'. If playNext never chained, this would still
// play the first clip and look like a pass — which is why the order of all
// three is asserted, not merely that something played.
{
  const s = await say([
    { key: 'suggest-intro', text: 'أقترح عليك:' },
    { key: 'place-kuwait-towers', text: 'أبراج الكويت…' },
    { key: 'best-kuwait-towers', text: 'أحلى وقت…' },
  ]);
  ok('all three clips played', s.played.length === 3, JSON.stringify(s.played));
  ok('in the order she says them', JSON.stringify(s.played) === JSON.stringify([
    '/voice/shouq/suggest-intro.mp3',
    '/voice/shouq/place-kuwait-towers.mp3',
    '/voice/shouq/best-kuwait-towers.mp3',
  ]), JSON.stringify(s.played));
  ok('with no synthetic speech mixed in', s.spoken.length === 0, JSON.stringify(s.spoken));
}

// ---------------------------------------------------------------------------
console.log('\n── there is a beat between two sentences, not a splice ──');
/**
 * With the clips prefetched, back-to-back playback has no pause in it at all —
 * measured at 8ms on a local connection, which is a splice rather than a
 * speaker. The beat is now a decision (SENTENCE_GAP_MS) instead of whatever the
 * network charged, which is the point: the same rhythm on wifi and on mobile.
 */
{
  const s = await say([
    { key: 'suggest-intro', text: 'أقترح عليك:' },
    { key: 'place-kuwait-towers', text: 'أبراج الكويت…' },
    { key: 'best-kuwait-towers', text: 'أحلى وقت…' },
  ]);
  ok('all three played', s.played.length === 3, JSON.stringify(s.played));
  const gaps = s.playedAt.slice(1).map((t, i) => t - s.playedAt[i]);
  // The harness ends a clip 5ms after it starts, so the interval between two
  // starts is that plus the beat.
  ok('every sentence is followed by a pause', gaps.every((g) => g >= 150), gaps.map(Math.round).join(', '));
  ok('and it is a beat, not a wait', gaps.every((g) => g < 600), gaps.map(Math.round).join(', '));
}

console.log('\n── stopping during the pause stays stopped ──');
// The beat is a timer, and a timer that was already scheduled will happily
// fire into the next clip after stop() has cleared the queue.
{
  const s = await page.evaluate(async (parts) => {
    window.resetSpy();
    window.voice.speak(parts);
    // Wait for the first clip to start, then land inside the pause after it.
    const until = Date.now() + 2000;
    while (Date.now() < until && window.spy.played.length === 0) {
      await new Promise((r) => setTimeout(r, 5));
    }
    await new Promise((r) => setTimeout(r, 60));
    const atStop = window.spy.played.length;
    window.voice.stop();
    await new Promise((r) => setTimeout(r, 500));
    return { atStop, after: window.spy.played.length };
  }, [
    { key: 'suggest-intro', text: 'أ' },
    { key: 'place-kuwait-towers', text: 'ب' },
    { key: 'best-kuwait-towers', text: 'ج' },
  ]);
  // Stated as its own assertion: if the timing drifted and the stop landed
  // during a clip instead, the one below would pass without testing anything.
  ok('the stop really landed inside the pause', s.atStop === 1, `${s.atStop} clips in`);
  ok('and the pause does not resume into the next clip', s.after === 1, `${s.atStop} → ${s.after}`);
}

// ---------------------------------------------------------------------------
console.log('\n── every clip plays at the level the manifest levelled it to ──');
/**
 * Each line is its own ElevenLabs render and comes back at whatever level that
 * generation produced. Four or five of them play back to back inside a single
 * answer, so a level that moves between them is heard as شوق changing distance
 * from the microphone mid-sentence — which nobody can point at and everybody
 * notices.
 *
 * `npm run voice:levels` measures the set and writes a volume per clip into
 * the manifest; the numbers in the fixture manifest are that script's real
 * output for these very files (1.8 dB apart as recorded, 0.0 dB as played).
 * Nothing is re-encoded, so the only place the correction can be applied is
 * here, and the only way to see it is to ask what the element's volume was at
 * the moment each clip started.
 */
{
  const gains = JSON.parse(
    readFileSync(join(FIXTURES, 'manifest.json'), 'utf8')
  ).gains ?? {};
  const s = await say([
    { key: 'suggest-intro', text: 'أقترح عليك:' },
    { key: 'place-kuwait-towers', text: 'أبراج الكويت…' },
    { key: 'best-kuwait-towers', text: 'أحلى وقت…' },
  ]);
  const want = ['shouq/suggest-intro', 'shouq/place-kuwait-towers', 'shouq/best-kuwait-towers']
    .map((k) => gains[k]);
  ok('the fixture manifest really carries levels to apply',
    want.every((v) => typeof v === 'number') && new Set(want).size > 1, JSON.stringify(want));
  ok('and each clip is played at its own',
    JSON.stringify(s.playedVolume) === JSON.stringify(want),
    `${JSON.stringify(s.playedVolume)} vs ${JSON.stringify(want)}`);
}

console.log('\n── a manifest the module did not write is not trusted with the volume ──');
/**
 * `gains` is a number from a JSON file on a server, and the element rejects
 * anything outside 0–1 with an IndexSizeError — thrown from the middle of
 * playback, which is silence plus a module that still believes it is speaking.
 *
 * The realistic ways it goes wrong are all here: absent entirely (the state the
 * repository ships in today), out of range in both directions, and not a number
 * at all. Each needs a module that has not already memoised the real manifest,
 * so each gets its own page.
 */
{
  const cases = [
    ['no levels at all — every clip as recorded', (m) => { delete m.gains; }, 1],
    ['a level above the maximum', (m) => { m.gains['shouq/hello'] = 7; }, 1],
    ['a negative level', (m) => { m.gains['shouq/hello'] = -3; }, 0],
    ['a level that is not a number', (m) => { m.gains['shouq/hello'] = 'loud'; }, 1],
    ['a level that is genuinely quiet', (m) => { m.gains['shouq/hello'] = 0.25; }, 0.25],
  ];
  const real = JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8'));
  for (const [name, bend, want] of cases) {
    const fresh = await ctx.newPage();
    const errs = [];
    fresh.on('pageerror', (e) => errs.push(e.message));
    await fresh.route('**/voice/manifest.json', (route) => {
      const m = JSON.parse(JSON.stringify(real));
      m.gains ??= {};
      bend(m);
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(m) });
    });
    await fresh.goto(B + '/voice.html', { waitUntil: 'load' });
    await fresh.waitForFunction(() => !!window.voice);
    const got = await fresh.evaluate(async () => {
      window.resetSpy();
      window.voice.speak([{ key: 'hello', text: 'هلا' }]);
      await new Promise((r) => setTimeout(r, 400));
      return { volume: window.spy.playedVolume, played: window.spy.played.length };
    });
    ok(`${name} → ${want}`,
      got.played === 1 && got.volume[0] === want && errs.length === 0,
      `played ${got.played}, volume ${JSON.stringify(got.volume)}${errs.length ? ', ' + errs.join(' | ') : ''}`);
    await fresh.close();
  }
}

// ---------------------------------------------------------------------------
console.log('\n── one missing clip drops the WHOLE utterance to synthetic ──');
// The rule that matters most out loud. Half a sentence in a recorded Kuwaiti
// voice and half in the browser's robot is worse than all of it in the robot,
// and it is the failure a naive per-part resolver would produce.
{
  const s = await say([
    { key: 'suggest-intro', text: 'أقترح عليك:' },
    { key: 'place-al-shaheed-park', text: 'حديقة الشهيد، في مدينة الكويت.' },
  ]);
  ok('no clip is played at all', s.played.length === 0, JSON.stringify(s.played));
  // One utterance per sentence, not one for the answer — see speakFallback.
  ok('the whole thing is spoken instead', s.spoken.length === 2, JSON.stringify(s.spoken));
  ok('including the part that DID have a clip',
    s.spoken.join(' ').includes('أقترح عليك') && s.spoken.join(' ').includes('حديقة الشهيد'),
    JSON.stringify(s.spoken));
  ok('and in the order she says them',
    (s.spoken[0] ?? '').includes('أقترح عليك') && (s.spoken[1] ?? '').includes('حديقة الشهيد'),
    JSON.stringify(s.spoken));
}

// ---------------------------------------------------------------------------
console.log('\n── the echoed question is skipped on the clip path ──');
// answerParts puts the question as it was heard at the front, keyless and
// optional, because no recording of a sentence nobody has said yet can exist.
// It must be dropped, not handed to the synthesiser — that would put a robot
// voice in front of شوق's own.
{
  const s = await say([
    { text: 'قهوة هادية؟', optional: true },
    { key: 'suggest-intro', text: 'أقترح عليك:' },
    { key: 'place-kuwait-towers', text: 'أبراج الكويت…' },
  ]);
  ok('the two recorded parts play', s.played.length === 2, JSON.stringify(s.played));
  ok('and the echo is silent, not synthesised', s.spoken.length === 0, JSON.stringify(s.spoken));
}

console.log('\n── a keyless, NON-optional part still forces the fallback ──');
{
  const s = await say([
    { key: 'suggest-intro', text: 'أقترح عليك:' },
    { text: 'أقرب شي لطلبك: مقاهي.' },
  ]);
  ok('nothing is played', s.played.length === 0, JSON.stringify(s.played));
  ok('it is spoken whole', s.spoken.length === 2, JSON.stringify(s.spoken));
}

// ---------------------------------------------------------------------------
console.log('\n── clips are looked up per persona ──');
// The fixture manifest holds shouq's clips only. If the persona were not part
// of the lookup key, سالم would speak in شوق's recorded voice — the one bug in
// this module a listener would notice instantly and a reader never would.
{
  await page.evaluate(() => window.voice.setPersona('salem'));
  const s = await say([{ key: 'hello', text: 'هلا! أنا سالم.' }]);
  ok('سالم plays none of شوق\'s clips', s.played.length === 0, JSON.stringify(s.played));
  ok('he falls back to the synthesiser', s.spoken.length === 1, JSON.stringify(s.spoken));
  await page.evaluate(() => window.voice.setPersona('shouq'));
}

// ---------------------------------------------------------------------------
console.log('\n── stopping mid-answer stops the rest of it ──');
{
  const s = await page.evaluate(async () => {
    window.setAutoEnd(false); // hold on the first clip, as a long line would
    window.resetSpy();
    window.voice.speak([
      { key: 'suggest-intro', text: 'أ' },
      { key: 'place-kuwait-towers', text: 'ب' },
      { key: 'best-kuwait-towers', text: 'ج' },
    ]);
    await new Promise((r) => setTimeout(r, 250));
    const midway = window.spy.played.length;
    window.voice.stop();
    await new Promise((r) => setTimeout(r, 250));
    window.setAutoEnd(true);
    return { midway, after: window.spy.played.length, pauses: window.spy.pauseCalls };
  });
  ok('it was genuinely mid-answer when stopped', s.midway === 1, `played ${s.midway}`);
  ok('the element is paused', s.pauses >= 1, `${s.pauses} pauses`);
  ok('and the queued clips never play', s.after === s.midway, `${s.midway} → ${s.after}`);
}

// ---------------------------------------------------------------------------
console.log('\n── the manifest is fetched once, not per answer ──');
{
  const n = requested.filter((u) => u === '/voice/manifest.json').length;
  ok('one manifest request for the whole session', n === 1, `${n} requests`);
}

ok('no page errors throughout', errors.length === 0, errors.join(' | '));

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
