// Every engine has its own voice, derived from how it fires.
//
//   npm run test:voices      (no browser, no dev server)
//
// Before: the same three oscillators for all six engines — a saw at the
// firing frequency, one detuned to 2.02x, a square an octave down — and
// a swap only moved the mix between them. Measured in the metric below,
// the flat-six and the inline six were 1.3 dB apart: one instrument.
//
// The metric: each voice's energy by crank order, at the same crank
// speed, normalised to its own total, compared as the RMS difference in
// dB across the first 24 orders (a -40 dB floor, so silence against
// silence is not a difference). It compares what the ENGINE contributes;
// pitch alone — a V8 firing twice as often as a four — would separate
// them on its own and prove nothing.
import { readFileSync } from "node:fs";
import {
  ENGINE_VOICES, cycleSpectrum, voiceTables, renderCycle, voiceLevels,
  legacyCycle, softClip,
} from "../src/game/voices.ts";
import { ENGINES } from "../src/game/engines.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok  " : "FAIL"; };
const ids = Object.keys(ENGINE_VOICES);
const specOf = (id) => ENGINES.find((e) => e.id === id);

// 1. One voice per engine, and no other.
{
  const engines = ENGINES.map((e) => e.id).sort();
  console.log(`${check(JSON.stringify(ids.slice().sort()) === JSON.stringify(engines),
    `voices ${ids.join(",")} against engines ${engines.join(",")}`)} voices      ${ids.length} voices for ${engines.length} engines`);
  for (const id of ids) {
    const v = ENGINE_VOICES[id];
    check(v.cylinders === specOf(id).cylinders, `${id}: the voice has ${v.cylinders} cylinders, the engine ${specOf(id).cylinders}`);
    check(v.fireDeg.length === v.cylinders && v.bank.length === v.cylinders, `${id}: one firing per cylinder`);
    const gaps = v.fireDeg.map((d, i) => ((v.fireDeg[(i + 1) % v.cylinders] - d + 720) % 720));
    check(gaps.every((g) => Math.abs(g - 720 / v.cylinders) < 1e-9), `${id}: the crank fires evenly overall (${gaps.join("/")})`);
  }
}

// 2. Distinct: every pair at least 4.5 dB apart.
const shape = (id) => {
  const { re, im } = cycleSpectrum(ENGINE_VOICES[id]);
  let tot = 0; const e = [];
  for (let h = 1; h <= 48; h++) { const x = h < re.length ? re[h] ** 2 + im[h] ** 2 : 0; e.push(x); tot += x; }
  return e.map((x) => x / tot);
};
const db = (x) => 10 * Math.log10(Math.max(x, 1e-4));
const dist = (a, b) => { let s = 0; for (let h = 0; h < 48; h++) s += (db(a[h]) - db(b[h])) ** 2; return Math.sqrt(s / 48); };
{
  let worst = [Infinity, "", ""];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const d = dist(shape(ids[i]), shape(ids[j]));
    if (d < worst[0]) worst = [d, ids[i], ids[j]];
  }
  console.log(`${check(worst[0] >= 4.5, `${worst[1]} and ${worst[2]} are only ${worst[0].toFixed(1)} dB apart`)} distinct    closest pair ${worst[1]} / ${worst[2]} at ${worst[0].toFixed(1)} dB (was 1.3 between the two sixes)`);
}

// 3. Physical: the orderings the layouts imply.
{
  const stats = (id) => {
    const v = ENGINE_VOICES[id];
    const { re, im } = cycleSpectrum(v);
    let tot = 0, cen = 0, off = 0, half = 0;
    for (let h = 1; h < re.length; h++) {
      const e = re[h] ** 2 + im[h] ** 2; tot += e; cen += e * h / 2;
      if (h % v.cylinders !== 0) off += e;
      if (h % (v.cylinders / 2) === 0 && h % v.cylinders !== 0) half += e;
    }
    return { cen: cen / tot, off: off / tot, half: half / tot };
  };
  const s = Object.fromEntries(ids.map((id) => [id, stats(id)]));
  const brightest = ids.reduce((a, b) => (s[b].cen > s[a].cen ? b : a));
  const mostUneven = ids.reduce((a, b) => (s[b].off - s[b].half > s[a].off - s[a].half ? b : a));
  console.log(`${check(brightest === "v8-40fp", `the brightest voice is ${brightest}`)} bright      the flat-plane V8 is the brightest (${s["v8-40fp"].cen.toFixed(1)} orders centroid)`);
  console.log(`${check(s["i4-20t"].cen < s["i4-16"].cen && s["i6-30tt"].cen < s["f6-25"].cen, "a turbo voice is brighter than its NA counterpart")} turbo       turbos duller: four ${s["i4-20t"].cen.toFixed(1)} < ${s["i4-16"].cen.toFixed(1)}, six ${s["i6-30tt"].cen.toFixed(1)} < ${s["f6-25"].cen.toFixed(1)}`);
  console.log(`${check(mostUneven === "v8-57" && s["v8-57"].off - s["v8-57"].half > 0.4, `the burble is on ${mostUneven}`)} burble      the cross-plane V8 carries ${Math.round((s["v8-57"].off - s["v8-57"].half) * 100)}% off its firing and bank orders`);
  console.log(`${check(s["f6-25"].half > 3 * s["i6-30tt"].half, "the flat-six has no more 1.5-order howl than the inline six")} howl        flat-six ${Math.round(s["f6-25"].half * 100)}% on the half-orders against the inline six's ${Math.round(s["i6-30tt"].half * 100)}%`);
}

// 4. The split loses nothing, and the levels hold.
{
  let worstRt = 0, worstDb = 0, worstDrive = 0, worstDcIn = 0, worstDcOut = 0, dcNote = "";
  for (const id of ids) {
    const v = ENGINE_VOICES[id], sub = specOf(id).subMix;
    // Round trip: the three tables rendered at their three rates are the
    // cycle spectrum, sample for sample.
    const t = voiceTables(v, 1);
    const w = renderCycle(t, v.cylinders, 1024);
    const { re, im } = cycleSpectrum(v);
    let ms = 0; for (let h = 1; h < re.length; h++) ms += (re[h] ** 2 + im[h] ** 2) / 2;
    const k = 1 / Math.sqrt(ms);
    let err = 0;
    for (let i = 0; i < 1024; i += 37) {
      let x = 0;
      for (let h = 1; h < re.length; h++) {
        const ph = (2 * Math.PI * h * i) / 1024;
        x += k * (re[h] * Math.cos(ph) - im[h] * Math.sin(ph));
      }
      err = Math.max(err, Math.abs(x - w[i]));
    }
    worstRt = Math.max(worstRt, err);
    // Levels, through the soft clip exactly as the bus has it.
    const lv = voiceLevels(v, sub);
    const legacy = legacyCycle(sub);
    const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
    const peak = (a) => a.reduce((p, x) => Math.max(p, Math.abs(x)), 0);
    const into = Array.from(renderCycle(voiceTables(v, lv.inGain), v.cylinders));
    const out = into.map(softClip);
    const levelDb = 20 * Math.log10((rms(out) * lv.makeup) / rms(Array.from(legacy, softClip)));
    worstDb = Math.max(worstDb, Math.abs(levelDb));
    worstDrive = Math.max(worstDrive, peak(into) / peak(Array.from(legacy)));
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    worstDcIn = Math.max(worstDcIn, Math.abs(mean(into)) / rms(into));
    const dcOut = Math.abs(mean(out)) / rms(out);
    if (dcOut > worstDcOut) { worstDcOut = dcOut; dcNote = id; }
  }
  console.log(`${check(worstRt < 1e-4, `the three-oscillator split is ${worstRt} off the spectrum`)} split       three tables at f, f/2 and f/N rebuild the cycle to ${worstRt.toExponential(1)}`);
  console.log(`${check(worstDb <= 1, `a voice comes out ${worstDb.toFixed(2)} dB off the legacy level`)} level       every voice within ${worstDb.toFixed(2)} dB of the level its engine had`);
  console.log(`${check(worstDrive <= 1.0001, `a voice drives the clip ${worstDrive.toFixed(2)}x harder than before`)} drive       into the clip at the legacy peak, never harder (${worstDrive.toFixed(3)}x)`);
  console.log(`${check(worstDcIn < 1e-6, `a voice carries DC into the clip: ${worstDcIn}`)} dc          no DC into the clip; after it, ${(worstDcOut * 100).toFixed(1)}% of RMS on ${dcNote} — which is what the 20 Hz blocker is for`);
}

// 5. Wired: sound.ts fits the voice, crossfades, and blocks the DC.
{
  const src = readFileSync("src/game/sound.ts", "utf8");
  const ok =
    /ENGINE_VOICES\[e\.id\] && this\.engBank\?\.voice !== e\.id\) this\.fitVoice/.test(src) &&
    /createPeriodicWave\(/.test(src) &&
    /linearRampToValueAtTime\(1, t \+ XF\)/.test(src) &&
    /dcBlock\.type = "highpass"/.test(src) &&
    /freq \/ b\.cyl/.test(src) &&
    // The resonance is after the clip: voiceLevels levels the voice INTO
    // the clip without it, so a formant ahead of the clip overdrives it.
    /this\.engVoiceIn\.connect\(shaper\)/.test(src) &&
    /connect\(dcBlock\)\.connect\(this\.engFormant\)/.test(src);
  console.log(`${check(ok, "sound.ts no longer fits voices through a crossfade with a DC blocker and the formant after the clip")} wired       fitted per engine id, crossfaded, DC-blocked, formant after the clip, cycle at f/N per bank`);
}

console.log(fail.length ? `\nFAILURES:\n - ${fail.join("\n - ")}` : "\nsix engines, six voices, each one its own");
process.exit(fail.length ? 1 : 0);
