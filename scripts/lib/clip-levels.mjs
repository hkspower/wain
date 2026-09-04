/**
 * How loud a recorded clip is, and what to do about it.
 *
 * Two scripts need this and they must agree: gen-voice-levels writes the
 * corrections into the manifest, and audit-voice reports whether the result is
 * flat. Two copies of the same decibel arithmetic is exactly how a pipeline
 * ends up correcting to one target and grading against another.
 *
 * Node cannot decode audio. Chromium can, and it is already a dependency of
 * the other audits, so the measurement happens in a page: the bytes go in as
 * base64, the numbers come out.
 */
import { existsSync, readFileSync } from "node:fs";

/**
 * Anything below this is not part of the voice.
 *
 * Averaging the silence at either end would report a clip as quiet in
 * proportion to how much padding the encoder happened to leave, which is not
 * something anybody hears. -34 dBFS is well under speech and well over the
 * noise floor of a rendered file.
 */
const GATE = 0.02;

/**
 * How far a clip may sit from the middle of the set before a listener hears it
 * as the speaker moving away from the microphone.
 *
 * Three decibels is roughly where a level change stops being felt and starts
 * being noticed — and these are consecutive sentences of one answer, which is
 * the least forgiving place to put one. The same number bounds the correction
 * below and the warning in audit-voice, on purpose: a gap this side of it is
 * flattened silently, and a gap the other side of it is a bad take that should
 * be re-recorded rather than papered over.
 */
export const LEVEL_SPREAD_DB = 3;

/**
 * A clip whose loudest moment is this far down is not a quiet recording, it is
 * a failed one — an empty render, or a file of room tone. Speech peaks within
 * a few dB of full scale; -40 dBFS is two orders of magnitude under that and
 * cannot be reached by a take with a voice in it.
 */
export const SILENCE_PEAK_DB = -40;

const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));

/**
 * Peak and gated RMS for each clip, in dBFS.
 *
 * `files` is `[{ key, file }]`. A clip that will not decode comes back as
 * `{ key, broken: true }` rather than throwing, because one corrupt file
 * should not stop the other two hundred from being measured.
 */
export async function measureClips(files) {
  if (files.length === 0) return [];
  const { chromium } = await import("playwright");
  const exe = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
  const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
  try {
    const page = await browser.newPage();
    const rows = [];
    for (const { key, file } of files) {
      const b64 = readFileSync(file).toString("base64");
      const row = await page.evaluate(
        async ([b64, gate]) => {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          let buf;
          try {
            buf = await ctx.decodeAudioData(bytes.buffer);
          } catch {
            return null;
          }
          const d = buf.getChannelData(0);
          let peak = 0;
          let sum = 0;
          let n = 0;
          for (let i = 0; i < d.length; i++) {
            const v = Math.abs(d[i]);
            if (v > peak) peak = v;
            if (v > gate) { sum += d[i] * d[i]; n += 1; }
          }
          return { seconds: buf.duration, peak, rms: n ? Math.sqrt(sum / n) : 0 };
        },
        [b64, GATE]
      );
      rows.push(row ? { key, seconds: row.seconds, peak: db(row.peak), rms: db(row.rms) } : { key, broken: true });
    }
    return rows;
  } finally {
    await browser.close();
  }
}

/**
 * The playback volume each clip should get so the set sounds like one speaker.
 *
 * `HTMLMediaElement.volume` can only ever turn a clip DOWN — there is no value
 * above 1 — so the whole set is brought to its quietest member rather than to
 * its loudest, and every correction is a small attenuation. Going the other way
 * would need the clips re-encoded, which means decoding and re-encoding lossy
 * audio for a difference of a decibel or two, and that trade is not worth
 * taking.
 *
 * The trim is bounded at LEVEL_SPREAD_DB. Without a bound, one bad take at
 * -30 dBFS would drag every other clip twelve decibels down to meet it, and
 * the whole voice would go quiet to hide a single file. Beyond the bound the
 * clip is left alone and audit-voice names it, which is the honest outcome:
 * that one needs re-recording, not a volume knob.
 */
export function gainsFor(levels) {
  const heard = levels.filter((l) => !l.broken && Number.isFinite(l.rms) && l.peak >= SILENCE_PEAK_DB);
  if (heard.length === 0) return { gains: {}, target: null, median: null };
  const sorted = heard.map((l) => l.rms).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const target = Math.max(sorted[0], median - LEVEL_SPREAD_DB);
  const gains = {};
  for (const l of heard) {
    // Rounded to three places: the manifest is read by a browser, and the
    // fourth decimal of a volume is well past anything an ear resolves.
    const g = Math.min(1, 10 ** ((target - l.rms) / 20));
    gains[l.key] = Math.round(g * 1000) / 1000;
  }
  return { gains, target, median };
}

/** What a clip's level becomes once its gain is applied — what is heard. */
export const heardRms = (level, gain = 1) => level.rms + db(gain);
