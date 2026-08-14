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
  private radioCtx: AudioContext | null = null;
  private synth: SpeechSynthesis | null = null;
  private male: SpeechSynthesisVoice | null = null;
  private female: SpeechSynthesisVoice | null = null;
  // Pre-rendered ElevenLabs clips (scripts/generate-voices.mjs) — used
  // in preference to speech synthesis whenever a line's clip exists
  private clips = new Set<string>();
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

  /** Squeeze a recorded clip into a car speaker: a narrow band, a
   *  little grit, and no bass at all. */
  private routeThroughRadio(el: HTMLAudioElement): void {
    try {
      this.radioCtx ??= new AudioContext();
      const ctx = this.radioCtx;
      const src = ctx.createMediaElementSource(el);
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
      src.connect(hp).connect(lp).connect(drive).connect(ctx.destination);
    } catch {
      // A clip already routed once cannot be re-routed; it just plays dry
    }
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
      this.clipAudio?.pause();
      this.clipAudio = new Audio(`/voices/${clipId}.mp3`);
      this.clipAudio.volume = 0.9;
      if (this.radio) this.routeThroughRadio(this.clipAudio);
      void this.clipAudio.play().catch(() => {});
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
    this.synth.speak(u);
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.synth?.cancel();
      this.clipAudio?.pause();
    }
    return this.enabled;
  }

  dispose(): void {
    this.synth?.cancel();
    this.clipAudio?.pause();
  }
}
