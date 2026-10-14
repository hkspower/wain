"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconCall, IconPhone } from "@/components/icons";
import { haptic } from "@/lib/haptics";
import { primeAudio, stop as stopVoice } from "@/lib/voice";
import { agentEnabledFor, callCopy, type CallPersona } from "@/lib/wain-ai";
import {
  armCall,
  callAgentAvailable,
  onPhase,
  probeMic,
  requestCall,
  startLocalRecognition,
  warmCall,
} from "@/lib/wain-ai-bus";
import type { Phase } from "@/components/WainAiCall";

/**
 * The call button: on /find's phone (hers), and in سالم's header (his).
 *
 * She used to be a coral button floating over the corner of every page, then
 * over the corner of /search, then inside the search box beside its own
 * dictation mic — two microphone-ish icons offering what a visitor reads as
 * the same thing. Since 1 October there is one way to call her, on /find, on
 * request; since 7 October سالم's header places his call with the same
 * component, so the two taps cannot drift apart.
 *
 * What it is NOT is the call itself. That stays mounted in the root layout, or
 * `open_place` would kill it while navigating; this only asks. See
 * `lib/wain-ai-bus.ts`.
 */
export default function ShouqCallButton({
  className = "",
  onTapped,
  persona = "shouq",
  size = "sm",
}: {
  className?: string;
  /**
   * "call" is /find's since 2 October: a big green round button with a handset,
   * the one thing to press on the phone drawn around it (FindChoice) — her
   * photo is on that phone's screen, so the button can be what every phone's
   * call button is. "sm" is the inline size-8 launcher, kept as the default so
   * nothing that still renders it has to change.
   *
   * "pill" is سالم's header: his call, a green pill with a handset and «كلّم سالم»
   * beside it from 400px (at 320 the header also holds the back button, his
   * face, his name and the read-aloud toggle, so the words go before anything
   * else does). It was coral until 7 October, and a red handset reads as «hang
   * up» on a phone; green is what /find's call button and every phone's call
   * button are.
   */
  size?: "sm" | "call" | "pill";
  /**
   * Run synchronously right after the call is requested — for a surface that
   * has to move on. /find's phone pushes /search here, where every call's
   * answers land. Not an `onClick` on a wrapper, because the tap has to reach
   * `primeAudio` and the recogniser first, and a bubbling handler that
   * navigates could unmount this button mid-gesture.
   */
  onTapped?: () => void;
  /**
   * Whose call this places: her agent («shouq», the default) or his («salem»).
   * Each has its own agent, so this button never reaches the other one's — see
   * `agentIdFor` in `lib/wain-ai.ts`. Its words follow the same choice.
   */
  persona?: CallPersona;
}) {
  const copy = callCopy(persona);
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  useEffect(() => onPhase(setPhase), []);

  const open = phase !== "idle";
  /**
   * Only when she is known to be producing speech — see `WainAiCall`, which
   * holds the whole argument. `live` is the LISTENING state, and in agent mode
   * it is the entire call, so this animated a mouth for minutes over a widget
   * that had said nothing. The launcher cannot know better than the call can:
   * the phase is all that crosses the bus, and `answering` is the only value
   * in it that means speech.
   */
  const talking = phase === "answering";

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
    // …and the origin the call needs after that. The chunk is ours and near;
    // the session is on a third origin, and used to be dialled cold.
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
     *
     * «answered» is a call waiting for its next question (the bar over the
     * results), and a tap then starts that question: free, like idle.
     */
    const free =
      phaseRef.current === "idle" ||
      phaseRef.current === "ended" ||
      phaseRef.current === "error" ||
      phaseRef.current === "answered";
    /**
     * A call that is starting cuts whatever she is still saying. An answer
     * being read out (from /salem's chat, or the last call's) would otherwise
     * talk over the ring-back and her greeting for the first second of the
     * call. Only a start: a tap on a call that is already live leaves her alone.
     * Here, in the gesture, because the call itself mounts a chunk later.
     */
    if (free) stopVoice();
    /**
     * And start listening HERE too, with no agent — see
     * `startLocalRecognition`. WebKit starts recognition only inside the
     * gesture, and the call that used to start it is a chunk and an effect
     * away from this tap. With an agent, the microphone PROBE starts here for
     * the same reason (`probeMic`). The call is told which way this tap went
     * rather than asking again (takeRequestedMode).
     */
    const local = !agentEnabledFor(persona) || !callAgentAvailable();
    if (free && local) startLocalRecognition();
    if (free && !local) probeMic();
    setPhase((p) => (p === "idle" || p === "ended" || p === "error" || p === "answered" ? "ringing" : p));
    requestCall(local ? "local" : "agent", persona);
    onTapped?.();
  }, [onTapped, persona]);

  return (
    <button
      type="button"
      onClick={onTap}
      onPointerEnter={preload}
      onFocus={preload}
      onPointerDown={arm}
      onTouchStart={arm}
      // The "call" button has «اتصال» printed under it, so its name starts with
      // that word: a name that leaves out the visible label is the one a
      // voice-control user cannot say («اضغط اتصال» has to find it). The pill's
      // name is its visible words, first and whole, for the same reason.
      aria-label={size === "pill" ? copy.callShouq : `${size === "call" ? "اتصال — " : ""}${copy.launcher} — ${copy.callHint}`}
      aria-expanded={open}
      aria-controls="wain-ai-panel"
      // size-8, not the size-6 floor: this holds an actual icon and an
      // animated ring, not a text glyph, so it needs padding the floor's bare
      // 24px does not leave — at size-6 the size-5 icon would touch the
      // button's own edge. 32px keeps the icon's ~45% share of the button
      // (20/44 before, 16/32 now) and still clears the floor with margin.
      className={`relative grid place-items-center overflow-hidden rounded-full transition ${
        size === "call"
          ? "size-24"
          : size === "pill"
            ? "min-h-11 min-w-11 grid-flow-col gap-1.5 px-3 text-sm font-semibold"
            : "size-8"
      } ${
        size === "pill"
          ? `bg-palm-600 text-white hover:bg-palm-700 active:scale-95 ${open ? "ring-4 ring-palm-500" : ""}`
          : size === "call"
            ? `bg-palm-600 text-white shadow-lg shadow-palm-700/30 hover:bg-palm-700 active:scale-95 ${open ? "ring-4 ring-palm-500" : ""}`
            : open
              ? "bg-coral-600 text-white shadow-md"
              : "text-coral-700 hover:bg-coral-50"
      } ${className}`}
    >
      {size === "call" ? (
        <IconPhone className="size-11" />
      ) : (
        <IconCall className={`size-4 ${phase === "ringing" || talking ? "call--live" : ""}`} />
      )}
      {size === "pill" && (
        <span aria-hidden="true" className="sr-only min-[400px]:not-sr-only">
          {copy.callShouq}
        </span>
      )}
      {phase === "ringing" && (
        <span
          aria-hidden="true"
          className={`absolute inset-0 animate-ping rounded-full motion-reduce:animate-none ${
            size === "call" || size === "pill" ? "bg-palm-500/40" : "bg-coral-500/40"
          }`}
        />
      )}
    </button>
  );
}
