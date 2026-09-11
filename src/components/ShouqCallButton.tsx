"use client";

import { useCallback, useEffect, useState } from "react";
import { IconShouq } from "@/components/icons";
import { haptic } from "@/lib/haptics";
import { primeAudio } from "@/lib/voice";
import { WAIN_AI_COPY } from "@/lib/wain-ai";
import { armCall, onPhase, requestCall, warmCall } from "@/lib/wain-ai-bus";
import type { Phase } from "@/components/WainAiCall";

/**
 * شوق, inside the search box.
 *
 * She used to be a coral button floating over the corner of every page, then
 * over the corner of this one. Both were a second voice control on a page that
 * already had one: this box carried its own microphone, which dictated a
 * question into the field, beside a launcher that placed a call — two
 * microphone-ish icons offering what a visitor reads as the same thing.
 *
 * There is one now, and it is here rather than floating because this is where
 * the question is being asked. In local mode a call still ends up doing what
 * the box mic did — take the sentence, search it, read the answer back — so
 * nothing is lost on a browser without the agent; in agent mode it is a
 * conversation instead of one shot.
 *
 * What it is NOT is the call itself. That stays mounted in the root layout, or
 * `open_place` would kill it while navigating; this only asks. See
 * `lib/wain-ai-bus.ts`.
 */
export default function ShouqCallButton({
  className = "",
  labelledBy,
  onTapped,
}: {
  className?: string;
  /**
   * Run synchronously right after the call is requested — for a surface that
   * has to get out of the way.
   *
   * The ⌘K palette is the one that needs it: it is a modal at z-60 and the call
   * sheet mounts in the root layout, so a call placed from inside the palette
   * rings underneath its own backdrop. Not an `onClick` on a wrapper, because
   * the tap has to reach `primeAudio` first and a bubbling handler that closes
   * the dialog could unmount this button mid-gesture.
   */
  onTapped?: () => void;
  /**
   * Id of visible text that already names this button, used INSTEAD of the
   * built-in aria-label.
   *
   * There are two of these on /search now — one in the query box, one in the
   * empty state — and they had the same accessible name, so a screen reader's
   * button list read «وين AI — اضغط عشان تكلّم شوق» twice with nothing to tell
   * them apart. The one in the empty state sits beside that sentence in plain
   * sight, so pointing at it makes the visible words the name rather than
   * repeating them, and the two buttons stop being indistinguishable.
   */
  labelledBy?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => onPhase(setPhase), []);

  const open = phase !== "idle";
  const talking = phase === "live" || phase === "answering";

  /**
   * Fetch the call before it is asked for.
   *
   * `touchstart` lands 100–300ms before the click it becomes, and a pointer
   * arriving on a desktop is usually a second of warning. Both start a fetch
   * the tap was about to start anyway, and neither happens to a visitor who
   * never goes near the button — which is the whole point of the call being a
   * separate chunk.
   */
  const preload = useCallback(() => {
    void import("@/components/WainAiCall");
    // …and the two origins the call needs after that. The chunk is ours and
    // near; the widget is 451KB from a CDN and then a session on a third
    // origin, and all of it used to start only once the tap had arrived.
    warmCall();
  }, []);

  /**
   * A finger already down is a call about to be placed, so fetch the bundle.
   *
   * Kept off the hover path deliberately — half a megabyte is not something to
   * spend on a pointer crossing the button on its way somewhere else.
   */
  const arm = useCallback(() => {
    void import("@/components/WainAiCall");
    armCall();
  }, []);

  const onTap = useCallback(() => {
    /**
     * Spend the gesture HERE, synchronously, before anything is awaited.
     *
     * iOS will not unlock an audio element or resume an AudioContext outside a
     * user gesture. The call mounts in another tree, an event and a chunk
     * fetch later, by which time the activation is gone — so the ring-back
     * would simply never sound: no error, no fallback, a silent call.
     */
    haptic("tap");
    primeAudio();

    /**
     * Ring on the tap, not when the chunk lands.
     *
     * The call sets «ringing» itself, but only once it has loaded, and a call
     * button that does visibly nothing for that moment reads as broken —
     * worse here than on any other button, because the one thing everybody
     * knows about phones is that they ring at once. The bus overwrites this
     * with the real phase a moment later, which is the same value.
     */
    setPhase((p) => (p === "idle" || p === "ended" || p === "error" ? "ringing" : p));
    requestCall();
    onTapped?.();
  }, [onTapped]);

  return (
    <button
      type="button"
      onClick={onTap}
      onPointerEnter={preload}
      onFocus={preload}
      onPointerDown={arm}
      onTouchStart={arm}
      aria-label={labelledBy ? undefined : `${WAIN_AI_COPY.launcher} — ${WAIN_AI_COPY.callHint}`}
      aria-labelledby={labelledBy}
      aria-expanded={open}
      aria-controls="wain-ai-panel"
      className={`grid size-11 place-items-center rounded-full transition ${
        open ? "bg-coral-600 text-white shadow-md" : "text-coral-700 hover:bg-coral-50"
      } ${className}`}
    >
      <IconShouq className={`size-5 shouq ${talking ? "shouq--talking" : ""}`} />
      {phase === "ringing" && (
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-ping rounded-full bg-coral-500/40 motion-reduce:animate-none"
        />
      )}
    </button>
  );
}
