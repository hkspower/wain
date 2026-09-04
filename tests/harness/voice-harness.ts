/**
 * The real voice module, on a page, with the browser's audio APIs watched.
 *
 * Everything here is about what happens to a phone speaker, so none of it can
 * be checked by reading the source: whether a gesture actually spent its
 * permission, whether closing شوق really silences her, whether an Arabic voice
 * is picked over the browser's default. The module is bundled exactly as it
 * ships and the APIs underneath it are instrumented.
 */
import * as voice from "@/lib/voice";
import * as lines from "@/lib/voice-lines";

interface Spy {
  playCalls: number;
  /** Whether the element was muted at the moment play() was called — the
   *  whole point of the unlock is that it makes no sound. */
  playedMuted: boolean[];
  pauseCalls: number;
  /** Every src handed to the element, in order — the clip path's whole output.
   *  Without this there was no way to tell a recorded answer from a synthetic
   *  one, or to see that the queue advanced past its first clip. */
  played: string[];
  /** When each of those started, so the gap between two sentences can be
   *  measured rather than assumed. The beat used to be whatever the network
   *  charged for the next file; nothing could see that from the order alone. */
  playedAt: number[];
  /** And how loud each was. Every line is a separate ElevenLabs render at its
   *  own level, so the manifest carries a volume per clip; without this there
   *  is no way to tell a levelled answer from an unlevelled one, and the
   *  difference is the only thing the whole levelling pass exists for. */
  playedVolume: number[];
  spoken: string[];
  cancelCalls: number;
  voicesAsked: number;
  lastLang: string;
  lastVoice: string;
}

declare global {
  interface Window {
    voice: typeof voice & typeof lines;
    spy: Spy;
    resetSpy: () => void;
    /** Replace the voice list the browser reports, to test the picker. */
    setVoices: (list: { name: string; lang: string }[]) => void;
    /** Take speechSynthesis away entirely, as an older browser would. */
    removeSynth: () => void;
    /** Whether a played clip reports itself finished. Real playback always
     *  ends; a test that wants to interrupt mid-queue turns this off. */
    setAutoEnd: (on: boolean) => void;
    /** Empty the voice list as Chrome does before it has loaded one. Returns
     *  the function that puts it back and fires `voiceschanged`. */
    holdVoices: () => () => void;
  }
}

const spy: Spy = {
  playCalls: 0, playedMuted: [], pauseCalls: 0, played: [], playedAt: [], playedVolume: [],
  spoken: [], cancelCalls: 0, voicesAsked: 0, lastLang: "", lastVoice: "",
};
window.spy = spy;
window.resetSpy = () => {
  spy.playCalls = 0; spy.playedMuted = []; spy.pauseCalls = 0;
  spy.played = []; spy.playedAt = []; spy.playedVolume = []; spy.spoken = []; spy.cancelCalls = 0; spy.voicesAsked = 0;
  spy.lastLang = ""; spy.lastVoice = "";
};

let autoEnd = true;
window.setAutoEnd = (on) => { autoEnd = on; };

const PAUSED = Symbol("paused");

// Chromium in this container has no audio device, so play() would reject on
// its own. Stubbed so the test measures the module's intent rather than the
// container's hardware.
HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
  spy.playCalls += 1;
  spy.playedMuted.push(this.muted);
  (this as unknown as Record<symbol, unknown>)[PAUSED] = false;
  const src = this.getAttribute("src") ?? this.src ?? "";
  if (src) {
    spy.played.push(new URL(src, location.href).pathname);
    spy.playedAt.push(performance.now());
    spy.playedVolume.push(this.volume);
  }
  // A clip that never reports itself finished would leave the queue stuck on
  // its first entry, and "she played one clip" would look identical to "she
  // played all of them". Ending it is what makes playNext's chaining visible.
  if (autoEnd && src) setTimeout(() => this.onended?.(new Event("ended")), 5);
  return Promise.resolve();
};
HTMLMediaElement.prototype.pause = function pause(this: HTMLMediaElement) {
  spy.pauseCalls += 1;
  (this as unknown as Record<symbol, unknown>)[PAUSED] = true;
};

/**
 * `paused` has to follow the stubs, or stop() cannot work here.
 *
 * stop() only pauses when `!audio.paused`, and with play() stubbed the real
 * property stays true for ever — nothing was ever really played — so the guard
 * short-circuits and the pause never happens. That is an artefact of the
 * harness, not of the module: in a browser, play() clears the flag. Tracking it
 * lets the guard be exercised instead of quietly skipped.
 */
Object.defineProperty(HTMLMediaElement.prototype, "paused", {
  configurable: true,
  get(this: Record<symbol, unknown>) { return this[PAUSED] !== false; },
});

/**
 * SpeechSynthesisVoice cannot be constructed, and `utterance.voice = {...}`
 * with a plain object throws a TypeError in Chromium. Overriding the accessor
 * lets the module assign whatever the fake getVoices() returned, so the code
 * path under test is the real one rather than one bent around the harness.
 */
const VOICE = Symbol("voice");
Object.defineProperty(SpeechSynthesisUtterance.prototype, "voice", {
  configurable: true,
  get(this: Record<symbol, unknown>) { return this[VOICE] ?? null; },
  set(this: Record<symbol, unknown>, v: unknown) { this[VOICE] = v; },
});

const DEFAULT_VOICES = [
  { name: "English (US)", lang: "en-US" },
  { name: "Majed", lang: "ar-SA" },
  { name: "Kuwaiti", lang: "ar-KW" },
];

/**
 * `?holdVoices=1` starts the page with no voice list at all.
 *
 * This has to be decided BEFORE the module initialises, which is why it is a
 * query parameter rather than a function. Chrome's list is empty when a page
 * loads and arrives later, announced by `voiceschanged` — so a module that
 * caches the list at import time caches nothing, and the first utterance is
 * the one at risk. Emptying the list after the module has already read it
 * tests nothing: the cache still holds the full set.
 */
const HELD = new URLSearchParams(location.search).get("holdVoices") === "1";
let voiceList: { name: string; lang: string }[] = HELD ? [] : DEFAULT_VOICES;
window.setVoices = (list) => { voiceList = list; };

const realSynth = window.speechSynthesis;

/**
 * An EventTarget, because the real speechSynthesis is one.
 *
 * The fake used to be a plain object literal, so `addEventListener` did not
 * exist on it — and a module guarding `synth.addEventListener?.(...)` took the
 * "this engine has no events" branch every time. That made the fake incapable
 * of expressing the single most important thing about Chrome's voice list:
 * that it arrives LATE, announced by `voiceschanged`. Any test of that
 * behaviour passed or failed on the harness rather than on the module.
 */
class FakeSynth extends EventTarget {
  speaking = false;
  paused = false;
  pending = false;
  speak(u: SpeechSynthesisUtterance) {
    spy.spoken.push(u.text);
    spy.lastLang = u.lang;
    spy.lastVoice = u.voice?.name ?? "";
    // Nothing plays, so nothing would ever end — fire it so the module's
    // speaking flag comes back down the way it does in a real browser.
    setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 0);
  }
  cancel() { spy.cancelCalls += 1; }
  getVoices() { spy.voicesAsked += 1; return voiceList as unknown as SpeechSynthesisVoice[]; }
}
const fakeSynth = new FakeSynth();

/**
 * Chrome's actual behaviour on a fresh page: getVoices() answers with nothing
 * until the list has loaded, and only then does `voiceschanged` fire. Handed
 * to the tests so the branch that matters can be driven deliberately.
 */
window.holdVoices = () => {
  const held = voiceList.length ? voiceList : DEFAULT_VOICES;
  voiceList = [];
  return () => {
    voiceList = held;
    fakeSynth.dispatchEvent(new Event("voiceschanged"));
  };
};
Object.defineProperty(window, "speechSynthesis", { value: fakeSynth, configurable: true, writable: true });
window.removeSynth = () => {
  Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true, writable: true });
};
void realSynth;

window.voice = { ...voice, ...lines };
