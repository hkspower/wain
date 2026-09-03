"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { IconShouq } from "@/components/icons";
import { haptic } from "@/lib/haptics";
import { primeAudio } from "@/lib/voice";
import { WAIN_AI_COPY } from "@/lib/wain-ai";
import type { Phase } from "@/components/WainAiCall";

/**
 * The button that calls شوق — and only the button.
 *
 * This component is in the root layout, so whatever it imports, every page
 * imports: the privacy policy, the about page, a place page nobody will ever
 * place a call from. It used to import the whole call — the ring-back tones,
 * the speech-recognition plumbing, the ElevenLabs widget bridge, the transcript
 * view, six phases of sheet markup — and that measured **6.3K gzipped on every
 * page in the site**, for a feature that does nothing until somebody taps.
 *
 * Same shape as SearchPalette/SearchPaletteDialog, and for the same reason,
 * written down there as: «reading the privacy policy should not cost the same
 * JavaScript as searching». Reading it should not cost the same JavaScript as
 * making a phone call either.
 *
 * What stays here is what has to be on screen before the tap: the handset, her
 * face, the label. What leaves is everything that only matters once a call
 * exists. The split is not free — the launcher still has to *look* like a live
 * call while one is running — so `WainAiCall` reports its phase back up, and
 * this component renders the pulse and the moving mouth from that.
 */
const WainAiCall = dynamic(() => import("@/components/WainAiCall"), {
  ssr: false,
});

export default function WainAi() {
  /**
   * Taps, not a boolean.
   *
   * The first tap mounts the call; every later one has to place a *new* call
   * through a component that is already mounted, and `open = true` a second
   * time is not an event. A counter is.
   */
  const [starts, setStarts] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");

  const open = phase !== "idle";
  const talking = phase === "live" || phase === "answering";

  /**
   * Fetch the call before it is asked for.
   *
   * Splitting the chunk out bought 4.8K on every page and cost about a second
   * between the tap and the sheet — the chunk only started downloading once
   * the tap had happened. A second of nothing is bad on any button and worse
   * on this one, because the single thing everybody knows about phones is that
   * they respond at once.
   *
   * So the fetch moves to the gesture *before* the gesture: `touchstart` fires
   * roughly 100–300ms before the `click` it will become, and a pointer
   * entering the button on a desktop is usually a second of warning. Both are
   * free — they start a fetch that the tap was about to start anyway — and
   * neither happens on a page where nobody goes near the button, which is the
   * whole point of the split. Focus is in there for keyboard users, who get
   * the same warning by arriving on the button before pressing it.
   */
  const preload = useCallback(() => {
    void import("@/components/WainAiCall");
  }, []);

  const onTap = useCallback(() => {
    /**
     * Spend the gesture HERE, synchronously, before anything is awaited.
     *
     * This is the part of the split that is not a matter of taste. `startCall`
     * used to run inside the click handler and now runs from an effect once
     * the chunk has arrived — which is a different turn of the event loop, and
     * by then the user activation is gone. iOS will not unlock an audio
     * element or resume an AudioContext outside a gesture, so the ring-back
     * would simply never sound: no error, no fallback, a silent call.
     *
     * `primeAudio` exists for exactly this — it unlocks the shared element and
     * starts the manifest fetch — and it is cheap enough to keep on this side
     * of the split. `haptic` moves with it so the tap still answers instantly
     * in the hand while the chunk is in flight.
     */
    haptic("tap");
    primeAudio();

    /**
     * Ring before the chunk lands.
     *
     * Fetching `WainAiCall` takes a moment, and a call button that does
     * visibly nothing for that moment reads as broken — worse here than
     * anywhere else on the site, because the one thing a person knows about
     * phones is that they ring immediately. So the launcher claims «ringing»
     * on the tap itself and the real call takes the phase over as soon as it
     * loads, which is the same state it would have set anyway.
     */
    setPhase((p) => (p === "idle" || p === "ended" || p === "error" ? "ringing" : p));
    setStarts((n) => n + 1);
  }, []);

  return (
    <>
      <div className="wain-ai-fab fixed start-5 z-50 flex flex-col items-start gap-2">
        <button
          type="button"
          onClick={onTap}
          onPointerEnter={preload}
          onTouchStart={preload}
          onFocus={preload}
          aria-label={`${WAIN_AI_COPY.launcher} — ${WAIN_AI_COPY.callHint}`}
          aria-expanded={open}
          aria-controls="wain-ai-panel"
          // The gradient starts at coral-600, not coral-500: white at 16px on
          // coral-500 measures 3.61:1, under the 4.5 AA needs, and the top of
          // this button is where the label sits. coral-600 gives 4.69:1 with
          // the same hue and the same 200-step spread.
          className="group relative flex select-none items-center gap-2.5 rounded-full bg-gradient-to-b from-coral-600 to-coral-800 py-3 pe-5 ps-4 text-white shadow-xl shadow-coral-700/30 transition duration-300 hover:-translate-y-0.5 hover:shadow-2xl active:translate-y-0"
        >
          <span className="relative grid size-9 place-items-center">
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-white/20"
            />
            {/* While the call rings, the handset pulses — the button itself
                shows the call is live even when the sheet is scrolled away. */}
            {phase === "ringing" && (
              <span
                aria-hidden="true"
                className="absolute inset-0 animate-ping rounded-full bg-white/40 motion-reduce:animate-none"
              />
            )}
            {/* Her face, not a handset.
                This is the most-seen شوق mark on the site and it was a generic
                phone glyph — the label «وين AI» beside it and «اضغط عشان تكلّم
                شوق» underneath both name a person, and the button showed an
                object. The call affordance is not lost with it: the pulse
                while ringing, the presence dot and the wording all still say
                this places a call, which is how every contact list on a phone
                already works — you tap the person, not the receiver. */}
            <IconShouq
              className={`relative size-5 shouq ${talking ? "shouq--talking" : ""}`}
            />
            <span
              aria-hidden="true"
              className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full bg-sun-300 ring-2 ring-coral-600"
            />
          </span>
          <span className="font-display text-base font-semibold">
            {WAIN_AI_COPY.launcher}
          </span>
        </button>
      </div>

      {starts > 0 && <WainAiCall startSignal={starts} onPhase={setPhase} />}
    </>
  );
}
