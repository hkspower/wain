// The car radio.
//
// A tuner in the dash: a list of stations, a key that steps through
// them, and whatever is playing routed into the same mix bus as
// everything else so it ducks under a voice line and passes through the
// limiter with the rest of the game.
//
// WHERE THE STATIONS COME FROM
//
// Kuwait's public radio is broadcast by the Ministry of Information, and
// the services below are the real ones — the General Programme, the Holy
// Quran service, FM 88.8 and the rest. Their NAMES ship with the game;
// their stream URLs do not, and that is deliberate rather than
// unfinished.
//
// Retransmitting a broadcaster's live stream inside a game is a rights
// question, and it is the operator's question rather than mine: whoever
// ships this build is the one who can obtain permission, and the terms
// differ per service. So `url` is empty in the manifest and the game
// works without it. Fill public/radio/stations.json in with the streams
// you have the right to carry and every one of them lights up.
//
// WHAT PLAYS WHEN NOTHING IS CONFIGURED
//
// The first station is always the game's own music, which is
// synthesised and needs no network at all. That matters for more than
// the empty case: this game ships as an offline Electron/Steam build,
// and a radio that is silent without a connection would be a dead
// control on the dash for every player on a plane.
//
// TWO WAYS A STREAM CAN PLAY, AND WHY BOTH EXIST
//
// To put audio through the mix it has to go through WebAudio, and
// createMediaElementSource on a cross-origin stream yields silence
// unless the server sends CORS headers. Most radio streams do not.
//
// So each station is tried with `crossOrigin` first — that is the good
// path, and it lands the stream inside the limiter with everything else.
// If the load fails, it is retried as a plain media element, which
// plays fine but sits OUTSIDE the mix: it cannot be ducked under a voice
// line and the ceiling never sees it. That is a real compromise and the
// tuner records which mode each station ended up in rather than hiding
// it, because "the radio does not duck" is otherwise a mystery.

export interface RadioStation {
  id: string;
  /** Latin name, for the dash readout. */
  name: string;
  /** Arabic name — this is a Kuwaiti radio in a Kuwaiti car. */
  ar: string;
  /** Live stream. Absent or empty means the station is a label only and
   *  is skipped when tuning. */
  url?: string;
}

export type RadioMode = "synth" | "mixed" | "direct";

const MANIFEST = "/radio/stations.json";

/** The station that is always there: the game's own music. */
export const HOUSE_STATION: RadioStation = {
  id: "house",
  name: "Gulf Road Nights",
  ar: "ليالي شارع الخليج",
};

export class Radio {
  private ctx: AudioContext;
  private out: AudioNode;
  /** Where a streamed station lands when CORS allows it. Kept separate
   *  from the element's own volume so ducking has one place to act. */
  private bus: GainNode;
  private el: HTMLAudioElement | null = null;
  private src: MediaElementAudioSourceNode | null = null;

  private list: RadioStation[] = [HOUSE_STATION];
  private index = 0;
  private mode: RadioMode = "synth";
  private volume = 0.5;
  private ducked = false;
  /** Told the game's own music to stop when a stream takes over. */
  private onHouse: (on: boolean) => void;

  constructor(ctx: AudioContext, out: AudioNode, onHouse: (on: boolean) => void) {
    this.ctx = ctx;
    this.out = out;
    this.onHouse = onHouse;
    this.bus = ctx.createGain();
    this.bus.gain.value = this.volume;
    this.bus.connect(out);

    fetch(MANIFEST)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: RadioStation[] | null) => {
        if (!Array.isArray(j)) return;
        // Only stations with somewhere to tune to. A manifest entry with
        // no URL is a name waiting for a stream, and stepping onto it
        // would be a silent station the player has to press past.
        const live = j.filter((s) => s && typeof s.url === "string" && s.url.length > 0);
        this.list = [HOUSE_STATION, ...live];
      })
      .catch(() => {});
  }

  stations(): ReadonlyArray<RadioStation> {
    return this.list;
  }

  current(): { station: RadioStation; mode: RadioMode; index: number; count: number } {
    return {
      station: this.list[this.index] ?? HOUSE_STATION,
      mode: this.mode,
      index: this.index,
      count: this.list.length,
    };
  }

  /** Step to the next station and start it. Returns what is now playing. */
  next(): { station: RadioStation; mode: RadioMode } {
    this.tune((this.index + 1) % this.list.length);
    return { station: this.list[this.index], mode: this.mode };
  }

  tune(i: number): void {
    this.index = ((i % this.list.length) + this.list.length) % this.list.length;
    const st = this.list[this.index];
    this.stop();
    if (!st.url) {
      // The house station: hand playback back to the synthesised music.
      this.mode = "synth";
      this.onHouse(true);
      return;
    }
    this.onHouse(false);
    this.play(st.url);
  }

  private stop(): void {
    if (this.el) {
      this.el.pause();
      this.el.src = "";
    }
    if (this.src) {
      try {
        this.src.disconnect();
      } catch {
        /* already gone */
      }
      this.src = null;
    }
    this.el = null;
  }

  /**
   * Start a stream, preferring the path that keeps it inside the mix.
   *
   * The CORS attempt is not a guess that might work — it is the only way
   * a cross-origin stream can reach WebAudio at all, so it is worth one
   * try before falling back to a plain element that plays but cannot be
   * ducked or limited.
   */
  private play(url: string): void {
    const withCors = new Audio();
    withCors.crossOrigin = "anonymous";
    withCors.preload = "none";
    withCors.src = url;

    const direct = () => {
      const el = new Audio();
      el.preload = "none";
      el.src = url;
      el.volume = this.effective();
      this.el = el;
      this.mode = "direct";
      void el.play().catch(() => {
        // Nothing left to try: no CORS, and the element itself will not
        // play. Fall back to the house station rather than leaving the
        // dash showing a station that is silent.
        this.tune(0);
      });
    };

    const onError = () => {
      withCors.removeEventListener("error", onError);
      direct();
    };
    withCors.addEventListener("error", onError, { once: true });
    withCors.addEventListener(
      "canplay",
      () => {
        try {
          this.src = this.ctx.createMediaElementSource(withCors);
          this.src.connect(this.bus);
          this.el = withCors;
          this.mode = "mixed";
        } catch {
          direct();
        }
      },
      { once: true }
    );
    void withCors.play().catch(() => {
      /* the error listener above handles it */
    });
  }

  /** Duck under a voice line, exactly as the music does. */
  duckForVoice(on: boolean): void {
    this.ducked = on;
    const t = this.ctx.currentTime;
    this.bus.gain.setTargetAtTime(this.effective(), t, on ? 0.08 : 0.34);
    // A direct-mode station is not on the bus, so its element carries
    // the duck itself. It steps rather than ramps, which is the audible
    // cost of being outside the mix.
    if (this.el && this.mode === "direct") this.el.volume = this.effective();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    const t = this.ctx.currentTime;
    this.bus.gain.setTargetAtTime(this.effective(), t, 0.1);
    if (this.el && this.mode === "direct") this.el.volume = this.effective();
  }

  private effective(): number {
    return this.ducked ? this.volume * 0.3 : this.volume;
  }

  dispose(): void {
    this.stop();
    try {
      this.bus.disconnect();
    } catch {
      /* already gone */
    }
  }
}
