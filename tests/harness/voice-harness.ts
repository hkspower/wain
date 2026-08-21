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
  }
}

const spy: Spy = {
  playCalls: 0, playedMuted: [], pauseCalls: 0,
  spoken: [], cancelCalls: 0, voicesAsked: 0, lastLang: "", lastVoice: "",
};
window.spy = spy;
window.resetSpy = () => {
  spy.playCalls = 0; spy.playedMuted = []; spy.pauseCalls = 0;
  spy.spoken = []; spy.cancelCalls = 0; spy.voicesAsked = 0;
  spy.lastLang = ""; spy.lastVoice = "";
};

// Chromium in this container has no audio device, so play() would reject on
// its own. Stubbed so the test measures the module's intent rather than the
// container's hardware.
HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
  spy.playCalls += 1;
  spy.playedMuted.push(this.muted);
  return Promise.resolve();
};
HTMLMediaElement.prototype.pause = function pause(this: HTMLMediaElement) {
  spy.pauseCalls += 1;
};

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

let voiceList: { name: string; lang: string }[] = [
  { name: "English (US)", lang: "en-US" },
  { name: "Majed", lang: "ar-SA" },
  { name: "Kuwaiti", lang: "ar-KW" },
];
window.setVoices = (list) => { voiceList = list; };

const realSynth = window.speechSynthesis;
const fakeSynth = {
  speak(u: SpeechSynthesisUtterance) {
    spy.spoken.push(u.text);
    spy.lastLang = u.lang;
    spy.lastVoice = u.voice?.name ?? "";
    // Nothing plays, so nothing would ever end — fire it so the module's
    // speaking flag comes back down the way it does in a real browser.
    setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 0);
  },
  cancel() { spy.cancelCalls += 1; },
  getVoices() { spy.voicesAsked += 1; return voiceList as unknown as SpeechSynthesisVoice[]; },
  speaking: false, paused: false, pending: false,
};
Object.defineProperty(window, "speechSynthesis", { value: fakeSynth, configurable: true, writable: true });
window.removeSynth = () => {
  Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true, writable: true });
};
void realSynth;

window.voice = { ...voice, ...lines };
