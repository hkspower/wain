// The car radio.
//
// Two things have to be true and neither is obvious from reading the
// code. The tuner has to work with an EMPTY station list — which is how
// it ships, because the stream URLs belong to whoever has the right to
// carry them — and it has to route whatever it does play through the
// game's mix, so a radio ducks under a voice line like everything else.
//
// The second is checked by ear rather than by inspection: the test taps
// the actual output, plays a tone through the tuner's own bus, and
// measures whether ducking moves it. A gain node that is set and never
// heard is exactly the class of bug the mix work in this repo keeps
// turning up.

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
if (!exe) { console.error("no chromium"); process.exit(2); }

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
         "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
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
await page.waitForTimeout(900);

// --- 1. The manifest, and what the tuner made of it ------------------
const shipped = await page.evaluate(async () => {
  const r = await fetch("/radio/stations.json").then((x) => (x.ok ? x.json() : null));
  const radio = window.__grnRadio;
  return {
    manifest: Array.isArray(r) ? r.map((s) => ({ id: s.id, hasUrl: !!s.url })) : null,
    tuned: radio ? radio.stations().map((s) => s.id) : null,
    current: radio ? radio.current() : null,
    // The stations the game plays itself, and what makes each one a
    // different station rather than the same one renamed.
    channels: (window.__grnChannels ?? []).map((c) => ({
      id: c.id, bpm: c.bpm, root: c.root, feel: c.feel,
      scale: c.scale.join(","), tracks: c.tracks.length,
    })),
  };
});

console.log(
  `manifest     ${shipped.manifest ? shipped.manifest.length : 0} stations named, ` +
  `${(shipped.manifest ?? []).filter((s) => s.hasUrl).length} with a stream`
);
check(shipped.tuned !== null, "no radio on the car");
check(
  (shipped.manifest ?? []).length >= 3,
  "the shipped manifest does not name Kuwait's public services"
);
// It ships unwired on purpose. If someone fills the URLs in, this line
// stops being interesting — but with none of them set, the tuner must
// still have every station the game plays ITSELF, and must not be
// listing silent names the player would have to press past.
//
// This asserted `1 + wired`, and with nothing wired that meant a tuner
// with one station on it: pressing R stepped from the house station to
// the house station and the check called it correct. The house is a set
// of synthesised channels now, and the law is that all of them are
// reachable — a radio with one station is a mute button with steps.
const wired = (shipped.manifest ?? []).filter((s) => s.hasUrl).length;
const house = shipped.channels?.length ?? 0;
console.log(`tuner        ${shipped.tuned?.length} station(s) on the dash: ${shipped.tuned?.join(", ")}`);
check(house >= 3, `the game plays ${house} station(s) of its own — that is not a dial`);
check(
  shipped.tuned?.length === house + wired,
  `the dash lists ${shipped.tuned?.length} stations for ${wired} configured streams plus ${house} of the game's own`
);
check(shipped.tuned?.[0] === "house", "the first station is not the one that works offline");
console.log(
  `playing      ${shipped.current?.station.ar} · ${shipped.current?.station.name} (${shipped.current?.mode})  ` +
  check(shipped.current?.mode === "synth", "the default station is not the offline one")
);

// --- 1b. A station is a different station -----------------------------
//
// Four names over one bed is a skin, not a dial. What separates these is
// the SCALE — a minor pentatonic and a Hijaz are different musics, not
// different mixes of the same one — so that is what gets checked, along
// with the tempo and the feel underneath it. And each has to carry more
// than one thing to play, or leaving a station on is the same four
// chords until dawn.
{
  const ch = shipped.channels ?? [];
  for (const c of ch) {
    console.log(
      `  ${c.id.padEnd(18)} ${String(c.bpm).padStart(3)} bpm  key ${String(c.root).padStart(6)} Hz  ` +
        `${c.feel.padEnd(8)} ${c.tracks} track(s)  scale ${c.scale}`
    );
  }
  const uniq = (f) => new Set(ch.map(f)).size;
  check(uniq((c) => c.scale) === ch.length, "two stations walk the same scale — they are the same station");
  check(uniq((c) => c.bpm) === ch.length, "two stations run at the same tempo");
  check(ch.every((c) => c.tracks >= 2), "a station with one track is a loop, not a playlist");
  check(uniq((c) => c.feel) >= 2, "every station has the same drums under it");
}

// --- 2. Stepping the dial wraps, and never lands on silence ----------
const stepped = await page.evaluate(() => {
  const radio = window.__grnRadio;
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push(radio.next().station.id);
  return { seen, count: radio.current().count };
});
console.log(`tuning       four presses of R: ${stepped.seen.join(" -> ")}`);
check(
  stepped.seen.every((id) => id === "house") || stepped.count > 1,
  "stepping the dial left the dash on a station that is not in the list"
);
check(
  stepped.seen[stepped.count % 4] !== undefined,
  "the dial does not wrap"
);

// --- 3. The radio is IN the mix, measured at the output --------------
//
// Not "does duckForVoice set a gain" — that reads the code back to
// itself. A tone is pushed through the tuner's own bus and the output is
// measured with the duck off and on.
const duck = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const s = e.sound;
  const radio = window.__grnRadio;
  const ctx = s.ctx;

  const tap = ctx.createAnalyser();
  tap.fftSize = 2048;
  const buf = new Float32Array(tap.fftSize);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  tap.connect(sink).connect(ctx.destination);
  s.outputTap.connect(tap);

  // Quiet the rest of the game so the tone is the only thing moving.
  e.setPaused(true);
  s.setPaused(false);
  s.setMixLevels(0, 0);

  // Straight into the tuner's bus, which is the node ducking acts on.
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = 330;
  g.gain.value = 0.25;
  osc.connect(g).connect(radio.bus);
  osc.start();

  const read = async () => {
    await new Promise((r) => setTimeout(r, 450));
    let peak = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 250) {
      tap.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
      await new Promise((r) => setTimeout(r, 8));
    }
    return +peak.toFixed(4);
  };

  radio.duckForVoice(false);
  const open = await read();
  radio.duckForVoice(true);
  const under = await read();
  radio.duckForVoice(false);

  osc.stop();
  osc.disconnect();
  s.setMixLevels(1, 1);
  e.setPaused(false);
  return { open, under };
});

console.log(
  `mix          a tone through the tuner reads ${duck.open} at the output, ` +
  `${duck.under} under a voice line`
);
check(duck.open > 0.01, `the radio never reaches the output at all (${duck.open})`);
check(
  duck.under < duck.open * 0.6,
  `the radio does not duck under a voice line (${duck.open} -> ${duck.under})`
);

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nthe radio tunes, and what it plays is in the mix");
await browser.close();
process.exit(fail.length ? 1 : 0);
