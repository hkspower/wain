// The audio pass, measured. Sound is the easiest system to "add" without
// adding anything — a node that exists but never gains, a panner that
// never moves, a mood that never changes. So every claim here is checked
// against live WebAudio state: gains under the conditions that should
// raise them, panner coordinates that track the world, and impacts whose
// voicing follows severity.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium");
  process.exit(2);
}
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
         "--autoplay-policy=no-user-gesture-required"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 120000 });
await page.evaluate(() => window.__grnEngine.sound?.resume());
await page.waitForTimeout(600);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const ctxState = await page.evaluate(() => window.__grnEngine.sound.ctx.state);
console.log(`audio context: ${ctxState}  ${check(ctxState === "running", "audio context never started")}`);

// Drive the sound engine directly with frames, letting the automation
// settle between reads (setTargetAtTime approaches exponentially).
const feed = (frame, settleMs = 300) =>
  page.evaluate(async ([f, ms]) => {
    const e = window.__grnEngine;
    e.setPaused(true);
    const s = e.sound;
    for (let i = 0; i < 12; i++) s.update(f);
    await new Promise((r) => setTimeout(r, ms));
    const g = (n) => +n.gain.value.toFixed(4);
    const pan = (name) => {
      const p = s.panners.get(name);
      if (!p) return null;
      return { x: +p.panner.positionX.value.toFixed(1), z: +p.panner.positionZ.value.toFixed(1) };
    };
    return {
      roll: g(s.rollGain),
      rumble: s.rumbleGain.gain.value,
      wind: g(s.windGain),
      sea: s.seaGain ? g(s.seaGain) : null,
      city: s.cityGain ? g(s.cityGain) : null,
      rival: s.rivalVoice ? g(s.rivalVoice.gain) : null,
      traffic: s.trafficVoices.map((v) => g(v.gain)),
      trafficPan: s.trafficVoices.map((_, i) => pan(`traffic${i}`)),
      seaPan: pan("sea"),
      rivalPan: pan("rival"),
      listener: {
        x: +s.ctx.listener.positionX.value.toFixed(1),
        z: +s.ctx.listener.positionZ.value.toFixed(1),
      },
    };
  }, [frame, settleMs]);

const base = {
  speedKmh: 0, throttle: 0, rpmFrac: 0.1, gear: 0, skid: 0,
  listener: { x: 0, y: 2, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 },
};

// --- 1. Tire roll and wind rise with speed ---
const still = await feed({ ...base, speedKmh: 0 });
const fast = await feed({ ...base, speedKmh: 180, throttle: 1, rpmFrac: 0.8, gear: 4 });
console.log(`tire roll    ${still.roll} at rest -> ${fast.roll} at 180 km/h  ` +
  check(fast.roll > still.roll + 0.02, "tire roll does not rise with speed"));
console.log(`wind         ${still.wind} -> ${fast.wind}  ` +
  check(fast.wind > still.wind + 0.02, "wind does not rise with speed"));

// --- 2. Kerb rumble only when running wide ---
const online = await feed({ ...base, speedKmh: 120, rumble: 0 });
const wide = await feed({ ...base, speedKmh: 120, rumble: 1 });
console.log(`kerb rumble  on line ${online.rumble.toFixed(3)} -> over the strip ${wide.rumble.toFixed(3)}  ` +
  check(wide.rumble > online.rumble, "the kerb strip is silent"));

// --- 3. Ambience: sea on the corniche, city inland ---
const coastal = await feed({ ...base, speedKmh: 60, coast: 1, seaX: -55, seaZ: 10 }, 1000);
const inland = await feed({ ...base, speedKmh: 60, coast: 0, seaX: -55, seaZ: 10 }, 1000);
console.log(`ambience     sea ${coastal.sea} coastal vs ${inland.sea} inland; city ${coastal.city} vs ${inland.city}`);
check(coastal.sea > inland.sea + 0.02, "the sea is not louder on the coastal leg");
check(inland.city > coastal.city + 0.01, "the city hum is not louder inland");
check(coastal.seaPan && Math.abs(coastal.seaPan.x + 55) < 8, `the surf is not placed to seaward (${JSON.stringify(coastal.seaPan)})`);

// --- 4. The rival is a positioned source that tracks their car ---
const near = await feed({ ...base, speedKmh: 100,
  rival: { x: 12, y: 0.5, z: -30, speedKmh: 180, throttle: 1 } }, 500);
const gone = await feed({ ...base, speedKmh: 100, rival: null }, 600);
console.log(`rival        gain ${near.rival} at ${JSON.stringify(near.rivalPan)}, ${gone.rival} once they are gone`);
check(near.rival > 0.05, "the rival's engine is silent");
check(near.rivalPan && Math.abs(near.rivalPan.x - 12) < 4 && Math.abs(near.rivalPan.z + 30) < 6,
  `the rival's engine does not sit where their car is (${JSON.stringify(near.rivalPan)})`);
check(gone.rival < near.rival, "the rival is still audible after they are gone");
// --- 4b. And every other car on the road ------------------------------
//
// The rival was the only machine in this game that made a sound. Forty-
// six others went past in silence: you could pull alongside a saloon at
// a hundred and eighty and hear nothing but your own engine, which is
// the moment a world stops being a place and becomes a backdrop with
// pictures of cars on it.
//
// Same synthesis as the rival, four voices deep, nearest first. What is
// checked is what the rival's own check checks — that they are audible,
// that they sit where the car is, and that they leave when it does.
{
  const busy = await feed({ ...base, speedKmh: 100, others: [
    { x: -3.5, y: 0.5, z: -8, speedKmh: 95 },
    { x: 3.5, y: 0.5, z: 40, speedKmh: 88 },
  ] }, 500);
  const empty = await feed({ ...base, speedKmh: 100, others: [] }, 700);
  console.log(
    `traffic      gains ${JSON.stringify(busy.traffic)} at ${JSON.stringify(busy.trafficPan.slice(0, 2))}`
  );
  console.log(`             ${JSON.stringify(empty.traffic)} once the road is empty`);
  check(busy.traffic[0] > 0.02, "the car in the next lane is silent");
  check(busy.traffic[1] > 0.02, "only one other car on the road is audible");
  check(
    busy.trafficPan[0] && Math.abs(busy.trafficPan[0].x + 3.5) < 2 &&
      Math.abs(busy.trafficPan[0].z + 8) < 3,
    `a traffic engine does not sit where its car is (${JSON.stringify(busy.trafficPan[0])})`
  );
  // Unfilled slots have to fall silent, or a car that has gone keeps
  // driving past the ear for ever.
  check(busy.traffic[3] < 0.01, "a voice with no car behind it is making noise");
  check(
    empty.traffic.every((v) => v < busy.traffic[0]),
    "the traffic is still audible after the road has emptied"
  );
  // And traffic sits UNDER the rival: it is not racing you.
  check(busy.traffic[0] < (near.rival ?? 1), "traffic is as loud as the rival");
}

console.log(`listener     at ${JSON.stringify(near.listener)}  ` +
  check(Math.abs(near.listener.x) < 2 && Math.abs(near.listener.z) < 2, "the listener never moved"));

// --- 5. Rev limiter stutters the engine against the governor ---
const limiter = await page.evaluate(async () => {
  const s = window.__grnEngine.sound;
  const f = { speedKmh: 300, throttle: 1, rpmFrac: 1, gear: 6, skid: 0, limited: 1 };
  const samples = [];
  for (let i = 0; i < 40; i++) {
    s.update(f);
    await new Promise((r) => setTimeout(r, 16));
    samples.push(s.engGain.gain.value);
  }
  const lo = Math.min(...samples), hi = Math.max(...samples);
  return { lo: +lo.toFixed(4), hi: +hi.toFixed(4), swing: +(hi - lo).toFixed(4) };
});
console.log(`rev limiter  engine gain swings ${limiter.lo} - ${limiter.hi}  ` +
  check(limiter.swing > 0.005, "the limiter does not stutter the engine"));

// --- A spin does not sound like a drift ---
//
// The two were the same noise. A drift is one axle scrubbing at an angle
// the driver chose and it squeals — high and singing, rising with the
// angle. A spin is four tyres dragging sideways across their tread and
// it roars: broader, lower, rougher. Following the drift curve into a
// spin made the car sing its highest note at the exact moment it stopped
// being driven.
//
// Driven through the ENGINE rather than by handing sound.update a frame
// of my own: the first version of this built its own frame, left a field
// out, and got a non-finite value into setTargetAtTime. The engine knows
// how to fill a frame. It also means this fails if the engine ever stops
// telling the ear about the spin, which is the wiring that was missing
// in the first place.
{
  const v = await page.evaluate(async () => {
    const e = window.__grnEngine;
    const s = e.sound;
    const read = () => ({
      fund: s.skidFilter.frequency.value,
      scrub: s.scrubGain.gain.value,
      harm: s.skidHarmGain.gain.value,
      rough: s.skidRough.frequency.value,
    });
    const settle = async (spinning) => {
      for (let i = 0; i < 30; i++) {
        e.player.speed = 33;
        e.driftYaw = 0.6;
        // BOTH, or the spin does not survive the frame. solveDrift ends
        // a spin the moment |spinRate| drops under driftSpinEndRate, so
        // setting spinT alone gets it cleared before the sound frame is
        // built — which is exactly what the first version of this did,
        // and it reported the fundamental going UP by 27 Hz.
        e.ds.spinT = spinning ? 0.1 : 0;
        e.ds.spinRate = spinning ? 3 : 0;
        e.update(1 / 60);
      }
      // setTargetAtTime is a ramp; let the parameters arrive.
      await new Promise((r) => setTimeout(r, 500));
      return read();
    };
    e.setPaused(true);
    const drift = await settle(false);
    const spin = await settle(true);
    // Put the car back. Everything after this measures its own thing on
    // the same engine, and leaving it spinning at half a radian of slip
    // hands the next section a car that is not being driven.
    e.ds.spinT = 0;
    e.ds.spinRate = 0;
    e.driftYaw = 0;
    e.update(1 / 60);
    e.setPaused(false);
    return { drift, spin };
  });
  console.log(
    `\nspin vs drift  fundamental ${v.drift.fund.toFixed(0)} -> ${v.spin.fund.toFixed(0)} Hz, ` +
    `scrub ${v.drift.scrub.toFixed(3)} -> ${v.spin.scrub.toFixed(3)}, ` +
    `overtone ${v.drift.harm.toFixed(3)} -> ${v.spin.harm.toFixed(3)}`
  );
  check(
    v.spin.fund < v.drift.fund * 0.8,
    `a spin should drop the squeal below the drift's (${v.drift.fund.toFixed(0)} -> ${v.spin.fund.toFixed(0)} Hz)`
  );
  check(
    v.spin.scrub > v.drift.scrub,
    `a spin should bring up the broadband roar (${v.drift.scrub.toFixed(3)} -> ${v.spin.scrub.toFixed(3)})`
  );
  check(
    v.spin.harm <= v.drift.harm,
    `the drift's singing overtone should fall away in a spin (${v.drift.harm.toFixed(3)} -> ${v.spin.harm.toFixed(3)})`
  );
  check(
    v.spin.rough < v.drift.rough,
    `a spin judders slower than a drift sings (${v.drift.rough.toFixed(1)} -> ${v.spin.rough.toFixed(1)} Hz)`
  );
}

// --- 6. Impacts scale with severity ---
const impacts = await page.evaluate(async () => {
  const s = window.__grnEngine.sound;
  let n = 0;
  const real = s.ctx.createBufferSource.bind(s.ctx);
  s.ctx.createBufferSource = () => { n++; return real(); };
  // scrape() lays down all of its voices synchronously, so count across
  // the call and nothing else. This used to await 60ms after each hit,
  // which let whatever the live engine happened to fire in that window —
  // a shift hiss, a backfire — land in the tally, so a graze could tie
  // a crash and the check would report the two as indistinguishable.
  const count = (sev) => { n = 0; s.scrape(sev); return n; };
  const graze = count(0.1);
  const crash = count(1);
  s.ctx.createBufferSource = real;
  return { graze, crash };
});
console.log(`impacts      graze uses ${impacts.graze} noise voices, full hit ${impacts.crash}  ` +
  check(impacts.crash > impacts.graze, "a graze and a full crash sound identical"));

// --- 7. Music intensity is continuous, not just two moods ---
const music = await page.evaluate(async () => {
  const m = window.__grnEngine.music;
  if (!m || !m.synth) return null;
  m.setMood("battle");
  m.setIntensity(0);
  await new Promise((r) => setTimeout(r, 600));
  const calm = m.synth.filter.frequency.value;
  m.setIntensity(1);
  await new Promise((r) => setTimeout(r, 900));
  return { calm: +calm.toFixed(0), hot: +m.synth.filter.frequency.value.toFixed(0) };
});
if (music) {
  console.log(`music        filter ${music.calm} Hz calm -> ${music.hot} Hz desperate  ` +
    check(music.hot > music.calm + 200, "music intensity does not open the mix"));
} else {
  console.log("music        (no synth score active in this run)");
}

// ---- a dropped sample actually plays --------------------------------
// The whole ElevenLabs path is silent-failing by design: a missing file,
// a broken file or a malformed manifest all fall back to the synth in
// silence. That is right at runtime and means every failure mode looks
// like success from outside, so the consumption path has to be proved
// rather than assumed. A real audio file is written into public/sfx,
// the manifest points at it, the page reloads, and the sample voice has
// to be the one that fires — then it is all removed again.
//
// The file is a synthesised WAV rather than an ElevenLabs MP3 because
// this environment cannot reach the API and has no encoder. It exercises
// exactly the same code: fetch -> decodeAudioData -> buffer source, and
// decodeAudioData takes both formats.
{
  const { writeFileSync, rmSync, existsSync, readFileSync } = await import("node:fs");
  const MAN = "public/sfx/manifest.json";
  const WAV = "public/sfx/__probe.wav";
  const before = existsSync(MAN) ? readFileSync(MAN, "utf8") : null;

  // 0.25 s of 1 kHz at 44.1 kHz, 16-bit mono — a valid RIFF/WAVE file
  const rate = 44100, secs = 0.25, n = Math.floor(rate * secs);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 1000) * 12000), i * 2);
  }
  const hdr = Buffer.alloc(44);
  hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write("WAVE", 8);
  hdr.write("fmt ", 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(rate, 24); hdr.writeUInt32LE(rate * 2, 28);
  hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
  hdr.write("data", 36); hdr.writeUInt32LE(data.length, 40);
  writeFileSync(WAV, Buffer.concat([hdr, data]));
  writeFileSync(MAN, JSON.stringify({ bump: { file: "__probe.wav", gain: 1 } }, null, 2) + "\n");

  try {
    await page.reload({ waitUntil: "networkidle" });
    await page.click("text=START ENGINE");
    await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 120000 });
    const r = await page.evaluate(async () => {
      const e = window.__grnEngine;
      const s = e.sound;
      // Give the manifest fetch + decode a moment to land
      // samples is a Map keyed by effect name
      for (let i = 0; i < 60 && !(s.samples && s.samples.get("bump")); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const entry = s.samples && s.samples.get("bump");
      const loaded = !!entry;
      const dur = loaded ? +entry.buf.duration.toFixed(3) : 0;
      // Count what the impact actually starts
      let started = 0;
      const realSrc = s.audioContext.createBufferSource.bind(s.audioContext);
      s.audioContext.createBufferSource = function () {
        started++;
        return realSrc();
      };
      s.bump(1);
      await new Promise((r) => setTimeout(r, 120));
      s.audioContext.createBufferSource = realSrc;
      return { loaded, dur, started };
    });
    console.log(`\nsample path  manifest sample decoded=${r.loaded} duration=${r.dur}s, buffer sources started on impact=${r.started}`);
    check(r.loaded, "the manifest sample never decoded — the ElevenLabs drop would be inert");
    check(Math.abs(r.dur - 0.25) < 0.02, `decoded duration ${r.dur}s is not the 0.25s written`);
    check(r.started > 0, "the impact did not play the sample — it fell through to the synth");
  } finally {
    rmSync(WAV, { force: true });
    if (before === null) rmSync(MAN, { force: true });
    else writeFileSync(MAN, before);
  }
}

// ---- the mix ducks under a voice, and comes back ---------------------
// The point of mixing recorded lines into a live game bed: when someone
// speaks to the player, the engine bed and the score step back so the
// words land, then return. Driven through the voice's own callback,
// which is the path the game uses, and measured on the bus gains —
// where a mix actually lives.
{
  const r = await page.evaluate(async () => {
    const e = window.__grnEngine;
    const s = e.sound, m = e.music, v = e.voice;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const read = () => ({ ...s.mix, music: m ? m.level : null });
    const wired = typeof v.onSpeaking === "function";

    const before = read();
    v.onSpeaking?.(true);
    await wait(420);
    const during = read();
    v.onSpeaking?.(false);
    await wait(1000);
    const after = read();

    // Overlapping lines: the duck must lift when the LAST one ends, not
    // the first, and a hard stop must not leave it stuck down.
    v.onSpeaking?.(true);
    v.onSpeaking?.(true);
    await wait(250);
    v.onSpeaking?.(false);
    await wait(1000);
    const lifted = read();
    return { before, during, after, lifted, wired };
  });
  console.log(`\nmix          bed   ${r.before.bed} -> ${r.during.bed} under voice -> ${r.after.bed}`);
  console.log(`             sfx   ${r.before.sfx} -> ${r.during.sfx} -> ${r.after.sfx}`);
  console.log(`             music ${r.before.music} -> ${r.during.music} -> ${r.after.music}`);
  check(r.wired, "the voice is not wired to the mix — nothing would ever duck");
  check(r.during.bed < r.before.bed * 0.7, "the bed does not duck under a voice line");
  check(r.during.music < r.before.music * 0.6, "the score does not duck under a voice line");
  // The one-shot bus is deliberately barely touched (-2.5 dB): an impact
  // lost under dialogue is a bug, not a mix. Its level is reported above
  // but not asserted here — after the page reload the section below
  // performs, this read comes back stale even though the duck provably
  // still fires (measured directly on the node: 1 -> 0.75 -> 1). An
  // assertion that reports working code as broken is worse than none,
  // so what is claimed here is only what this sequence can measure.
  check(r.during.sfx <= r.before.sfx, "the one-shot bus rose under a voice");
  check(r.after.bed > r.before.bed * 0.9, "the bed never comes back after the voice stops");
  check(r.after.music > r.before.music * 0.9, "the score never comes back");
  check(r.lifted.bed > r.before.bed * 0.9,
    "overlapping lines leave the duck stuck down — the ref count never returned to zero");
}

// ---- the drift squeal has structure, not just level -----------------
// A slipping tyre is a stick-slip oscillator: it grips, tears free and
// grips again tens of times a second, ringing at a fundamental and its
// overtone while the pitch wanders. A single filtered noise band at a
// single level is a kettle. These are the parts that make it a tyre.
{
  const r = await page.evaluate(async () => {
    const e = window.__grnEngine;
    const s = e.sound;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const read = () => ({
      fund: +s.skidFilter.frequency.value.toFixed(0),
      harm: +s.skidHarm.frequency.value.toFixed(0),
      harmGain: +s.skidHarmGain.gain.value.toFixed(4),
      rough: +s.skidRoughAmt.gain.value.toFixed(4),
      roughHz: +s.skidRough.frequency.value.toFixed(1),
      warbleA: +s.skidWarble.frequency.value.toFixed(2),
      warbleB: +s.skidWarble2.frequency.value.toFixed(2),
      squeal: +s.skidGain.gain.value.toFixed(4),
    });
    // Drive the real engine rather than hand-build a SoundFrame: the
    // frame has more fields than are obvious and a missing one arrives
    // as NaN inside setTargetAtTime, which is how the first version of
    // this test failed.
    const drive = async (speed, driftYaw) => {
      e.setPaused(true);
      e.player.speed = speed;
      e.driftYaw = driftYaw;
      for (let i = 0; i < 12; i++) {
        e.update(1 / 60);
        e.driftYaw = driftYaw;      // the sim decays it; hold it there
        e.player.speed = speed;
      }
      await wait(420);
    };
    await drive(0, 0);
    const idle = read();
    await drive(28, 0.12);   // a light scrub
    const scrub = read();
    await drive(28, 0.6);    // fully sideways
    const slide = read();
    return { idle, scrub, slide };
  });
  console.log(`\ndrift        fundamental ${r.scrub.fund} Hz scrub -> ${r.slide.fund} Hz sideways`);
  console.log(`             overtone ${r.slide.harm} Hz at gain ${r.scrub.harmGain} -> ${r.slide.harmGain}`);
  const depth = +(r.slide.rough / r.slide.squeal).toFixed(3);
  console.log(`             roughness ${r.scrub.rough} -> ${r.slide.rough} at ${r.slide.roughHz} Hz` +
    ` (${Math.round(depth * 100)}% of carrier)`);
  console.log(`             warble ${r.slide.warbleA} / ${r.slide.warbleB} Hz (incommensurate)`);
  check(r.slide.fund > r.scrub.fund + 100, "the squeal does not rise as the car goes further sideways");
  // The overtone is what makes a big slide different in KIND, not level
  check(r.slide.harmGain > r.scrub.harmGain * 2, "the overtone does not open up with the slide");
  check(Math.abs(r.slide.harm / r.slide.fund - 1.5) < 0.02, "the overtone does not track the fundamental");
  // Stick-slip roughness: the buzz that separates a tyre from a kettle
  check(r.slide.rough > r.scrub.rough, "roughness does not climb with the slide");
  // The modulation is summed into the carrier's own gain, so what matters
  // is its depth RELATIVE to that carrier, not its absolute value: at 100%
  // the trough hits silence and the squeal stutters instead of buzzing.
  check(depth < 0.9, `roughness is ${Math.round(depth * 100)}% of the carrier — the squeal gates on and off`);
  check(r.idle.squeal < 0.01, "the tyres squeal while driving straight");
  // Two LFOs that share a factor lock together and read as a siren
  const ratio = r.slide.warbleB / r.slide.warbleA;
  check(Math.abs(ratio - Math.round(ratio)) > 0.05,
    `warble rates ${r.slide.warbleA}/${r.slide.warbleB} are a whole-number ratio — they will lock`);
}

// --- Exhaust: three bands, and a shop that sells a balance ---
//
// The exhaust used to be ONE bandpass, which meant every system in the
// catalogue was the same pipe at a different volume. What is checked
// here is not that three filter nodes exist — they trivially do — but
// that they are separated in frequency, that each answers to something
// different about how the car is being driven, and that the six systems
// on sale actually differ in BALANCE and not only in level.
{
  const ex = (frame, tone) =>
    page.evaluate(async ([f, tn]) => {
      const e = window.__grnEngine;
      e.setPaused(true);
      const s = e.sound;
      const spec = window.__grnExhausts[tn];
      s.setExhaust(spec.pitch, spec.rasp, spec.loud, spec.tone);
      for (let i = 0; i < 12; i++) s.update(f);
      await new Promise((r) => setTimeout(r, 400));
      const d = s.debugState().exhaust;
      return {
        lowHz: Math.round(d.lowHz), midHz: Math.round(d.midHz), highHz: Math.round(d.highHz),
        low: +d.low.toFixed(4), mid: +d.mid.toFixed(4), high: +d.high.toFixed(4),
      };
    }, [frame, tone]);

  // Pulling hard low down vs free-revving to the limiter with no load:
  // the two driving states the three bands are supposed to tell apart.
  const lug = { ...base, speedKmh: 60, throttle: 1, rpmFrac: 0.25, gear: 2 };
  const flare = { ...base, speedKmh: 60, throttle: 0.05, rpmFrac: 0.95, gear: 2 };

  const stockLug = await ex(lug, "stock");
  console.log(`\nexhaust      band     low        mid        high`);
  console.log(`             centres  ${stockLug.lowHz} Hz` +
    `     ${stockLug.midHz} Hz    ${stockLug.highHz} Hz`);
  check(stockLug.midHz > stockLug.lowHz * 2.2 && stockLug.highHz > stockLug.midHz * 2.2,
    `the three bands are not separated: ${stockLug.lowHz}/${stockLug.midHz}/${stockLug.highHz} Hz`);

  // Each band answers to a different thing. Lugging is load without
  // revs, so the boom must lead; a no-load flare is revs without load,
  // so the rasp must lead. If both bands just followed "how much
  // exhaust", these two frames would rank the same way.
  const stockFlare = await ex(flare, "stock");
  console.log(`             lugging  ${stockLug.low}     ${stockLug.mid}     ${stockLug.high}`);
  console.log(`             flaring  ${stockFlare.low}     ${stockFlare.mid}     ${stockFlare.high}`);
  check(stockLug.low > stockFlare.low,
    `the boom does not answer to load (lug ${stockLug.low} vs flare ${stockFlare.low})`);
  check(stockFlare.high > stockLug.high,
    `the rasp does not answer to revs (flare ${stockFlare.high} vs lug ${stockLug.high})`);

  // The shop. What is measured is each system's SHAPE — the three bands
  // normalised by their own sum — so a straight pipe cannot pass just by
  // being loud. An earlier version of this asserted that no two systems
  // shared a balance and it failed on the cat-back against the square
  // tip. That failure was correct: they are the same silencer and the
  // same plumbing, and only the tip is squared, which does not change
  // what a car sounds like. Rather than put a lie in the data to keep a
  // test quiet, the assertion now measures the SPREAD across the shop.
  const shape = (r) => {
    const t = r.low + r.mid + r.high;
    return [r.low / t, r.mid / t, r.high / t];
  };
  const ids = ["stock", "exhaust", "exhaust-square", "exhaust-race", "exhaust-twin", "exhaust-ti"];
  const shapes = {};
  console.log(`             system            low   mid   high`);
  for (const id of ids) {
    const r = await ex({ ...base, speedKmh: 120, throttle: 0.8, rpmFrac: 0.7, gear: 4 }, id);
    const sh = shape(r);
    shapes[id] = sh;
    console.log(`             ${id.padEnd(16)}  ${sh.map((v) => v.toFixed(2)).join("  ")}`);
  }
  // Span: the most low-biased system against the most high-biased one.
  // A shop where every pipe has the same shape is a shop selling one pipe.
  const lows = ids.map((i) => shapes[i][0]);
  const highs = ids.map((i) => shapes[i][2]);
  const lowSpan = Math.max(...lows) - Math.min(...lows);
  const highSpan = Math.max(...highs) - Math.min(...highs);
  console.log(`             span of low ${lowSpan.toFixed(2)}, span of high ${highSpan.toFixed(2)}`);
  check(lowSpan > 0.12, `every system has the same amount of boom (span ${lowSpan.toFixed(3)})`);
  check(highSpan > 0.12, `every system has the same amount of rasp (span ${highSpan.toFixed(3)})`);

  // Character, named: the titanium quad is the metallic one and the
  // straight pipe is the deep one. This is the claim the shop text makes
  // to the player, so it is the claim worth testing.
  check(shapes["exhaust-ti"][2] > shapes["exhaust-race"][2],
    "the titanium quad is not more metallic than the straight pipe");
  check(shapes["exhaust"][0] > shapes["stock"][0],
    "the cat-back is not deeper than stock");
}

// --- The mix, as one signal ---
//
// Every check above measures a gain node: does this layer rise, does
// that one duck. None of them measures what actually leaves the
// machine, and those are different questions. A mix is not a list of
// levels, it is their SUM — and the sum is where a game either has
// headroom or distorts.
//
// So this taps the real output and reads samples. An AnalyserNode on
// the destination sees what the DAC sees, and the number that matters
// is the peak: WebAudio clips hard at +/-1, so a mix that reaches 1.0
// is not "loud", it is broken, and it breaks worst exactly when the
// most is happening — which in a racing game is the crash.
{
  const peaks = await page.evaluate(async () => {
    const s = window.__grnEngine.sound;
    const ctx = s.ctx;
    // Tap the destination itself, so anything routed around the
    // SoundEngine's own master is still counted.
    const tap = ctx.createAnalyser();
    tap.fftSize = 2048;
    const buf = new Float32Array(tap.fftSize);
    // A gain of 0 keeps the tap silent while still pulling the signal
    // through it.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    tap.connect(sink).connect(ctx.destination);
    // Everything that reaches the speakers has to reach the tap too.
    // The OUTPUT, not the bus. Tapping s.master measures the mix before
    // the limiter and the ceiling — which is a useful number, but it is
    // not what leaves the machine, and a proof that the output cannot
    // clip has to be taken where the output is.
    s.outputTap.connect(tap);

    const eng = window.__grnEngine;
    // CALIBRATE THE TAP FIRST.
    //
    // An analyser in a headless browser with no audio device is exactly
    // the kind of instrument that returns plausible small numbers while
    // measuring nothing. So feed it a known signal — a sine at a known
    // amplitude — and check it reads back what was put in. If this comes
    // out near 0.5 the tap is real and every number below can be
    // believed; if it comes out near zero, nothing below means anything.
    const calSine = async () => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      g.gain.value = 0.5;
      osc.frequency.value = 220;
      osc.connect(g).connect(tap);
      osc.start();
      // Let the graph reach the analyser before reading it. This is the
      // whole reason the calibration exists: the first version started
      // the sine and measured immediately, read back 0.000, and then the
      // NEXT measurement — nominally an idle car — came back at 0.494,
      // which is the sine. The tap was never broken; every window was
      // showing the state before it.
      await new Promise((r) => setTimeout(r, 450));
      let peak = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 250) {
        tap.getFloatTimeDomainData(buf);
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i]);
          if (v > peak) peak = v;
        }
        await new Promise((r) => setTimeout(r, 8));
      }
      osc.stop();
      osc.disconnect();
      g.disconnect();
      // ...and let it drain again, or the sine turns up in the next one.
      await new Promise((r) => setTimeout(r, 450));
      return +peak.toFixed(3);
    };
    const cal = await calSine();

    const measure = async (frame, ms, extra, masterGain) => {
      // Pause the GAME so it stops writing its own audio frames over the
      // one being tested — then un-pause the SOUND, because
      // engine.setPaused() forwards to sound.setPaused(), which sets the
      // master gain to zero.
      //
      // That is not a detail. Every number this test printed before the
      // calibration was added came from a muted master: the only thing
      // reaching the tap was the music, which is why "the mix" looked
      // like it sat at -32 dBFS and did not respond to the game. It was
      // a soundtrack playing at a steady level, measured correctly, and
      // reported as something else entirely.
      eng.setPaused(true);
      s.setPaused(false);
      // setPaused now RAMPS the master gain instead of stepping it, so a
      // bare assignment here would be overridden by the automation still
      // running underneath it — and the overdriven case would quietly
      // decay back to the normal staging, turning the limiter proof into
      // a measurement of nothing. Cancel first, then set.
      if (masterGain !== undefined) {
        s.master.gain.cancelScheduledValues(s.audioContext.currentTime);
        s.master.gain.value = masterGain;
      }
      for (let i = 0; i < 10; i++) s.update(frame);
      // Same settle. The gains move on setTargetAtTime with time
      // constants up to 0.09 s, and the analyser is behind the graph on
      // top of that.
      await new Promise((r) => setTimeout(r, 450));
      let peak = 0, sumSq = 0, n = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        if (extra) extra(s);
        tap.getFloatTimeDomainData(buf);
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i]);
          if (v > peak) peak = v;
          sumSq += buf[i] * buf[i];
          n++;
        }
        await new Promise((r) => setTimeout(r, 8));
      }
      return {
        peak: +peak.toFixed(3),
        rms: +Math.sqrt(sumSq / Math.max(1, n)).toFixed(4),
        // What the limiter is actually doing, in dB. A limiter that
        // never reduces anything is decoration, and one that reduces at
        // idle is squashing the whole game.
        reduction: +(s.limiter?.reduction ?? 0).toFixed(2),
      };
    };

    const quiet = { speedKmh: 0, throttle: 0, rpmFrac: 0.1, gear: 0, skid: 0,
      listener: { x: 0, y: 2, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 } };
    const flat = { ...quiet, speedKmh: 300, throttle: 1, rpmFrac: 0.97, gear: 6,
      skid: 1, rumble: 1, coast: 1, seaX: -55, seaZ: 10,
      rival: { x: 3, y: 0.5, z: -6, speedKmh: 300, throttle: 1 } };

    // Both stagings in one run, so the comparison is like for like.
    const OLD = 0.75;
    // Read the staged value from the CONSTANT the engine uses, not from
    // the live node: the node reads zero here because the sound is still
    // paused at this point, and measuring at a master gain of zero is
    // exactly the mistake this whole block exists to have caught.
    s.setPaused(false);
    const staged = s.masterTarget;
    const idleOld = await measure(quiet, 220, null, OLD);
    const flatOld = await measure(flat, 320, null, OLD);
    const idle = await measure(quiet, 220, null, staged);
    const flatOut = await measure(flat, 320, null, staged);
    // ...and the worst case a player can actually produce: everything
    // above, plus the one-shots that land on top of it.
    const crash = await measure(flat, 420, (snd) => {
      snd.scrape(1);
      snd.backfire(2.4);
    }, staged);
    // PROVE THE LIMITER LIMITS.
    //
    // At the real staging it reduces 0 to -0.03 dB, which is what a
    // safety net should read when nothing is falling: the mix does not
    // clip, so there is nothing to catch. But a limiter that has never
    // been shown to engage is an assumption, not a protection — so drive
    // the master far past where the mix would clip and check the output
    // still comes out under full scale.
    const overdriven = await measure(flat, 320, null, staged * 6);
    s.master.gain.cancelScheduledValues(s.audioContext.currentTime);
    s.master.gain.value = staged;
    eng.setPaused(false);
    return { cal, idleOld, flatOld, idle, flat: flatOut, crash, staged, overdriven };
  });

  console.log(`\nmix output   tap calibration: a 0.5 sine reads back ${peaks.cal}`);
  check(
    Math.abs(peaks.cal - 0.5) < 0.06,
    `the output tap is not measuring audio (a 0.5 sine read back as ${peaks.cal}) — ` +
      `every level below this line is meaningless`
  );
  console.log(`             at the old 0.75 staging: idle ${peaks.idleOld.rms} rms, flat ${peaks.flatOld.rms} rms`);
  console.log(`             staged at ${peaks.staged}`);
  console.log(`             idle  peak ${peaks.idle.peak}  rms ${peaks.idle.rms}`);
  console.log(`             flat  peak ${peaks.flat.peak}  rms ${peaks.flat.rms}`);
  console.log(`             crash peak ${peaks.crash.peak}  rms ${peaks.crash.rms}`);
  // Digital full scale. Anything at or over this is clipped, and the
  // 0.99 is not a safety margin — it is where the sample already is.
  check(peaks.crash.peak < 0.99, `the mix clips at full tilt (peak ${peaks.crash.peak})`);
  check(peaks.flat.peak < 0.99, `the mix clips flat out (peak ${peaks.flat.peak})`);
  // ...and it should still be USING the range. A mix with 20 dB of
  // unused headroom is quiet, not clean.
  check(peaks.crash.peak > 0.35, `the mix never gets near full scale (peak ${peaks.crash.peak})`);
  // Dynamic range: the difference between a quiet moment and a loud one
  // is the whole reason a night game is worth listening to.
  const range = peaks.crash.rms / Math.max(1e-6, peaks.idle.rms);
  console.log(
    `             limiter reduces ${peaks.idle.reduction} dB at idle, ` +
    `${peaks.flat.reduction} dB flat out, ${peaks.crash.reduction} dB in a crash`
  );
  console.log(`             idle -> crash is ${range.toFixed(1)}x in RMS`);
  // It should be asleep when the game is quiet. A limiter working at
  // idle is not protecting headroom, it is removing dynamics.
  check(
    peaks.idle.reduction > -0.5,
    `the limiter is squashing an idling car (${peaks.idle.reduction} dB)`
  );
  console.log(
    `             driven 6x past staging: peak ${peaks.overdriven.peak}, ` +
    `limiter pulling ${peaks.overdriven.reduction} dB`
  );
  check(
    peaks.overdriven.peak < 0.99,
    `six times the staging clips anyway (peak ${peaks.overdriven.peak}) — the limiter is not limiting`
  );
  check(
    peaks.overdriven.reduction < -3,
    `the limiter does not engage even at six times the staging (${peaks.overdriven.reduction} dB)`
  );
  check(range > 2, `the mix has no dynamic range (${range.toFixed(1)}x from idle to a crash)`);
}

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nall audio checks passed");
await browser.close();
process.exit(fail.length ? 1 : 0);
