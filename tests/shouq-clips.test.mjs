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

import { existsSync } from 'node:fs';
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

/** Speak, then wait for the queue to drain. */
const say = (parts) => page.evaluate(async (p) => {
  window.resetSpy();
  window.voice.speak(p);
  await new Promise((r) => setTimeout(r, 400));
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
  ok('the whole thing is spoken instead', s.spoken.length === 1, JSON.stringify(s.spoken));
  ok('including the part that DID have a clip',
    (s.spoken[0] ?? '').includes('أقترح عليك') && (s.spoken[0] ?? '').includes('حديقة الشهيد'),
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
  ok('it is spoken whole', s.spoken.length === 1, JSON.stringify(s.spoken));
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
