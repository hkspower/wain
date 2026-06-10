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
  private synth: SpeechSynthesis | null = null;
  private male: SpeechSynthesisVoice | null = null;
  private female: SpeechSynthesisVoice | null = null;

  constructor() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    this.synth = window.speechSynthesis;
    this.pickVoices();
    this.synth.addEventListener?.("voiceschanged", () => this.pickVoices());
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

  speak(text: string, style: Partial<VoiceStyle> = {}): void {
    if (!this.enabled || !this.synth) return;
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
    if (!this.enabled) this.synth?.cancel();
    return this.enabled;
  }

  dispose(): void {
    this.synth?.cancel();
  }
}
