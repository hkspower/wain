// Kuwaiti voice lines via the browser's speech synthesiser — no audio
// assets needed, works offline (incl. the Electron/Steam build). Picks
// the best available Arabic voice, preferring male ones; each character
// gets a pitch/rate signature so rivals sound distinct even when the
// system only ships one Arabic voice.

export interface VoiceStyle {
  pitch: number; // 0..2
  rate: number; // 0.1..10
  female?: boolean;
}

const FEMALE_HINTS = ["female", "laila", "mariam", "salma", "zariyah", "hala", "amira", "أنثى"];
const MALE_HINTS = ["male", "majed", "maged", "naayf", "hamed", "tarik", "omar", "ذكر"];

export class VoiceBox {
  enabled = true;
  /** Radio mode: crew and marshal chatter comes through a car speaker,
   *  not the open air. Bandlimiting it is the entire difference between
   *  "a voice" and "a voice on the radio". */
  private radio = false;
  /**
   * The game's own bus, once the sound engine exists.
   *
   * Every line used to go `new Audio(...).play()` straight at the
   * device, and the radio path made a SECOND AudioContext of its own —
   * so the game had two independent outputs and the voices were in
   * neither mix. Press M and the rival went on taunting you into a
   * silent game; the limiter and the ceiling that guarantee what leaves
   * the machine never saw a word of it; and nothing could duck against
   * a layer that was not there.
   *
   * Attached rather than constructed, because VoiceBox is built before
   * the AudioContext is (a context created outside a user gesture is
   * born suspended).
   */
  private mixCtx: AudioContext | null = null;
  private mixOut: AudioNode | null = null;
  /** An element can only be given to createMediaElementSource once, so
   *  the routing is remembered rather than rebuilt. */
  private routed = new WeakSet<HTMLAudioElement>();
  private synth: SpeechSynthesis | null = null;
  private male: SpeechSynthesisVoice | null = null;
  private female: SpeechSynthesisVoice | null = null;
  // Pre-rendered ElevenLabs clips (scripts/generate-voices.mjs) — used
  // in preference to speech synthesis whenever a line's clip exists
  private clips = new Set<string>();
  /** Fired when a line starts and when it finishes, so the owner can
   *  duck the mix under it. Both an ElevenLabs clip and the fallback
   *  synthesized voice report through here — the mix must not care
   *  which one is speaking. */
  onSpeaking: ((speaking: boolean) => void) | null = null;
  private speakingCount = 0;
  private clipAudio: HTMLAudioElement | null = null;
  private manifestLoading: Promise<void> | null = null;

  constructor() {
    if (typeof window === "undefined") return;
    if ("speechSynthesis" in window) {
      this.synth = window.speechSynthesis;
      this.pickVoices();
      this.synth.addEventListener?.("voiceschanged", () => this.pickVoices());
    }
    this.manifestLoading = fetch("/voices/manifest.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: string[]) => {
        if (Array.isArray(list)) for (const id of list) this.clips.add(id);
      })
      .catch(() => {})
      .finally(() => {
        this.manifestLoading = null;
      });
  }

  /** Whether the platform offers any Arabic voice at all. */
  get hasArabic(): boolean {
    return this.male !== null || this.female !== null;
  }

  private pickVoices(): void {
    if (!this.synth) return;
    const arabic = this.synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith("ar"));
    if (arabic.length === 0) return;
    const named = (hints: string[]) =>
      arabic.find((v) => hints.some((h) => v.name.toLowerCase().includes(h))) ?? null;
    this.female = named(FEMALE_HINTS);
    this.male = named(MALE_HINTS) ?? arabic.find((v) => v !== this.female) ?? arabic[0];
    if (!this.female) this.female = this.male;
  }

  /**
   * Speak over the radio: same voice path, but squeezed into a car
   * speaker's band with a click in and out. Used for crew and marshal
   * chatter so it never sounds like the rival is in the passenger seat.
   */
  radioSpeak(text: string, style: Partial<VoiceStyle> = {}, clipId?: string): void {
    this.radio = true;
    // Radio squeeze: the synth path cannot be filtered, so the character
    // comes from delivery — clipped, quick, and a little higher.
    this.speak(text, { rate: 1.18, pitch: 1.12, ...style }, clipId);
    this.radio = false;
  }

  /**
   * Put this clip in the game's mix, and — on the radio — squeeze it
   * into a car speaker on the way: a narrow band, a little grit, and no
   * bass at all.
   *
   * One method for both paths, because the ROUTING is the same question
   * either way and only the filtering differs. Falls back to playing the
   * element dry if no bus has been attached, which is what happens in
   * SSR and in a test that never boots the audio.
   */
  private routeToMix(el: HTMLAudioElement): void {
    if (!this.mixCtx || !this.mixOut || this.routed.has(el)) return;
    try {
      const ctx = this.mixCtx;
      const out = this.mixOut;
      const src = ctx.createMediaElementSource(el);
      this.routed.add(el);
      if (!this.radio) {
        // Open air: straight into the mix, so Mute, the limiter and the
        // ceiling all reach it.
        src.connect(out);
        return;
      }
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 480;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 3200;
      const drive = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * 2 - 1;
        curve[i] = Math.tanh(x * 2.6);
      }
      drive.curve = curve as Float32Array<ArrayBuffer>;
      src.connect(hp).connect(lp).connect(drive).connect(out);
    } catch {
      // A clip already routed once cannot be re-routed; it just plays dry
    }
  }

  /** Hand the voice the game's bus. Called once, after the sound engine
   *  has a running context. */
  attachMix(ctx: AudioContext, out: AudioNode): void {
    this.mixCtx = ctx;
    this.mixOut = out;
  }

  /** Ref-counted, because lines overlap: the duck lifts when the LAST
   *  one ends, not when the first does. */
  private beginSpeaking(): void {
    if (this.speakingCount++ === 0) this.onSpeaking?.(true);
  }
  private endSpeaking(): void {
    if (this.speakingCount > 0 && --this.speakingCount === 0) this.onSpeaking?.(false);
  }

  speak(text: string, style: Partial<VoiceStyle> = {}, clipId?: string): void {
    if (!this.enabled) return;
    // Real ElevenLabs clip takes priority over the synthesizer. Early
    // lines can race the manifest fetch — wait for it before deciding.
    if (clipId && this.manifestLoading) {
      void this.manifestLoading.then(() => {
        if (this.enabled) this.speak(text, style, clipId);
      });
      return;
    }
    if (clipId && this.clips.has(clipId)) {
      this.synth?.cancel();
      // Whatever was playing is being cut off; release its duck first or
      // the count never returns to zero and the bed stays down forever.
      if (this.clipAudio && !this.clipAudio.paused) {
        this.clipAudio.pause();
        this.endSpeaking();
      }
      const audio = new Audio(`/voices/${clipId}.mp3`);
      this.clipAudio = audio;
      audio.volume = 0.9;
      this.routeToMix(audio);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        this.endSpeaking();
      };
      audio.addEventListener("ended", release);
      audio.addEventListener("error", release);
      this.beginSpeaking();
      void audio.play().catch(() => release());
      return;
    }
    if (!this.synth) return;
    const voice = style.female ? this.female : this.male;
    // Cut off whatever is still being said — racing banter is snappy.
    this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "ar-KW";
    u.pitch = style.pitch ?? 1;
    u.rate = style.rate ?? 1;
    u.volume = 0.9;
    // The synthesized fallback ducks the mix exactly like a clip does.
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.endSpeaking();
    };
    u.onend = release;
    u.onerror = release;
    this.beginSpeaking();
    this.synth.speak(u);
  }

  /** Stop everything and lift any duck. cancel() does not reliably fire
   *  onend across browsers, so the count is reset rather than trusted —
   *  a duck that never lifts leaves the game quiet for the session. */
  private silence(): void {
    this.synth?.cancel();
    this.clipAudio?.pause();
    if (this.speakingCount > 0) {
      this.speakingCount = 0;
      this.onSpeaking?.(false);
    }
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (!this.enabled) this.silence();
    return this.enabled;
  }

  dispose(): void {
    this.silence();
  }
}
