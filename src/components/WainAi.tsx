"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IconClose, IconPhone, IconPinSolid } from "@/components/icons";
import { haptic } from "@/lib/haptics";
import { primeAudio, setEnabled as setVoiceEnabled } from "@/lib/voice";
import { callDuration, connected, hangup, ringback } from "@/lib/call-tones";
import {
  WAIN_AI_AGENT_ENABLED,
  WAIN_AI_AGENT_ID,
  WAIN_AI_COPY,
  WAIN_AI_WIDGET_SRC,
} from "@/lib/wain-ai";

/**
 * وين AI — a call to شوق. Tap the button and the call starts.
 *
 * It used to be a three-second hold. The reasoning was sound: a voice session
 * seizes the microphone and the audio output, and that is far too much to
 * happen from a pocket-tap. But the hold had to be explained on the button
 * itself, and an instruction on a button is a sign the button is wrong.
 *
 * A call solves the same problem the way phones already solved it. The tap
 * opens a call that is *ringing* — nothing is seized yet, the ring-back is
 * telling you it is going somewhere, and the red button is right there. By the
 * time the microphone is live the visitor has watched it happen. That is
 * consent through a familiar sequence rather than through a novel gesture, and
 * it costs one tap instead of three seconds.
 *
 * Two ways the call is served, picked by configuration — see lib/wain-ai.ts:
 *
 *   Agent mode  — the ElevenLabs widget, a real duplex conversation. She can
 *                 also put places on screen mid-call through the client tools
 *                 registered below.
 *   Local mode  — the browser's own speech recognition takes the question,
 *                 وين's search answers it, and صوت وين reads the answer aloud
 *                 on the results page. One question per call, and the call
 *                 ends when she answers, because she has.
 *
 * In local mode the spoken question goes through the browser's speech
 * recognition, which on most engines is processed by the browser vendor's
 * speech service — said plainly in the call sheet and on the privacy page.
 */

type Phase =
  | "idle"
  | "ringing" // dialling: waiting on the microphone, or on the widget
  | "live" // connected — she is listening
  | "answering" // local mode: she has the question and is replying
  | "ended" // hung up, showing how long it lasted
  | "error";

/** How long «شوق ترد…» shows before the results replace the call. Long enough
 *  to read, short enough that it is not a spinner. */
const ANSWER_MS = 700;

/**
 * How long to ring before giving up.
 *
 * Nothing else in the component ends a ring. `onstart` ends it by connecting
 * and `onerror` ends it by failing, but neither is guaranteed to arrive: a
 * microphone prompt left sitting on screen fires nothing at all, and an engine
 * that cannot reach its vendor's speech service can simply never call back. A
 * real phone stops after a while; this one rang for ever, once every four
 * seconds, with the red button as the only way out.
 */
const DIAL_TIMEOUT_MS = 20_000;

/**
 * What the caller is told about an engine error.
 *
 * Every code other than `not-allowed` used to produce «ما سمعناك» — "we didn't
 * hear you". That is wrong for most of them and actively misleading for the
 * two that mean the vendor's speech service is unreachable, because it invites
 * a retry into exactly the same failure. `aborted` is not in here at all: that
 * one is us hanging up, and it is handled before this is reached.
 */
function errorCopy(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed") return WAIN_AI_COPY.micDenied;
  if (code === "no-speech") return WAIN_AI_COPY.noSpeech;
  // network, audio-capture, bad-grammar, language-not-supported.
  return WAIN_AI_COPY.callFailed;
}

/* Minimal typings for the vendor-prefixed Web Speech recognition API. */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  /** Fires once the engine is actually listening — which is only after the
   *  microphone has been granted. That is the moment the call connects. */
  onstart: (() => void) | null;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/** Voice-wave mark used as شوق's avatar. */
function VoiceMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 11v2" opacity=".55" />
      <path d="M8 8v8" opacity=".8" />
      <path d="M12 5v14" />
      <path d="M16 8v8" opacity=".8" />
      <path d="M20 11v2" opacity=".55" />
    </svg>
  );
}

export default function WainAi() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [errorText, setErrorText] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [agentReady, setAgentReady] = useState(false);
  const [agentFailed, setAgentFailed] = useState(false);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const answerTimer = useRef<number | null>(null);
  // Stops the ring-back. Held in a ref rather than state because it has to be
  // callable from cleanup, from every failure path, and from the moment the
  // call connects — none of which should wait for a render.
  const stopRing = useRef<(() => void) | null>(null);
  // Gives up on a call that never connects — see DIAL_TIMEOUT_MS.
  const dialTimer = useRef<number | null>(null);
  // The transcript as of the last result event, so onend can act on what was
  // actually heard even when the final-result event never fires.
  const heardRef = useRef("");

  // The phase as of right now, for the handlers that have to *decide*
  // something from it. Reading it inside a setPhase updater would be the
  // obvious way and the wrong one: React is free to run an updater more than
  // once, so a tone or a haptic in there fires twice.
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Silencing the ring and giving up on the ring are the same event seen from
  // two sides: every path that stops the ring-back — connecting, failing,
  // hanging up — is a path where the call is no longer dialling, so the
  // give-up timer belongs here rather than at each of those call sites.
  const silenceRing = useCallback(() => {
    stopRing.current?.();
    stopRing.current = null;
    if (dialTimer.current !== null) {
      window.clearTimeout(dialTimer.current);
      dialTimer.current = null;
    }
  }, []);

  /* ---- the call is over -------------------------------------------------- */
  /** Tear down whatever the call was using. Safe to call twice. */
  const teardown = useCallback(() => {
    silenceRing();
    recRef.current?.abort();
    recRef.current = null;
    if (answerTimer.current !== null) {
      window.clearTimeout(answerTimer.current);
      answerTimer.current = null;
    }
  }, [silenceRing]);

  /** Was there a call in progress to end? */
  const inCall = (p: Phase) => p === "live" || p === "ringing" || p === "answering";

  /**
   * The red button. Hangs up and stays, showing how long it lasted — that
   * summary is the point of pressing it deliberately.
   */
  const endCall = useCallback(() => {
    const was = phaseRef.current;
    teardown();
    setTranscript("");
    setErrorText("");
    if (inCall(was)) {
      haptic("tap");
      hangup();
      setPhase("ended");
    } else {
      setPhase("idle");
    }
  }, [teardown]);

  /**
   * The × and Escape. Both mean "get me out", so they hang up *and* close —
   * one press, out, with the tone that says the line is down. Leaving a
   * dialog open after Escape is the thing screen-reader users are entitled
   * not to have happen.
   */
  const closeSheet = useCallback(() => {
    const was = phaseRef.current;
    teardown();
    if (inCall(was)) {
      haptic("tap");
      hangup();
    }
    setTranscript("");
    setErrorText("");
    setSeconds(0);
    setPhase("idle");
  }, [teardown]);

  useEffect(() => {
    if (phase === "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSheet();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, closeSheet]);

  /* ---- the call timer ----------------------------------------------------- */
  // Ticks only while connected. The elapsed value is derived from a start
  // timestamp rather than counted up, so a tab that was backgrounded — where
  // timers are throttled to once a minute — comes back showing the real
  // duration instead of however many ticks it was allowed to run.
  useEffect(() => {
    if (phase !== "live") return;
    const startedAt = Date.now();
    setSeconds(0);
    const id = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  /* ---- local mode: listen, then answer ------------------------------------ */
  const finishWith = useCallback(
    (spoken: string) => {
      const q = spoken.trim();
      recRef.current = null;
      silenceRing();
      if (!q) {
        setErrorText(WAIN_AI_COPY.noSpeech);
        setPhase("error");
        return;
      }
      haptic("success");
      setPhase("answering");
      // The visitor asked out loud, so the answer speaks too: turn صوت وين on
      // (quietly — the search page's own summary is the reply) and let the
      // search screen show the matching places on its map. She carries on
      // talking there, which is why the call ending here is not her stopping.
      setVoiceEnabled(true, { greet: false });
      // Hand the question across so she can repeat what she heard and answer
      // without the typing debounce. Session storage rather than a query
      // parameter: ?q= is shared and bookmarked, and this is about one spoken
      // moment, not part of the search.
      try {
        sessionStorage.setItem("wain:asked", q);
      } catch {
        /* private mode — she just answers without the echo */
      }
      answerTimer.current = window.setTimeout(() => {
        answerTimer.current = null;
        setPhase("idle");
        setTranscript("");
        router.push(`/search?q=${encodeURIComponent(q)}`);
      }, ANSWER_MS);
    },
    [router, silenceRing]
  );

  const startListening = useCallback(() => {
    const rec = getRecognition();
    if (!rec) {
      // No speech input in this browser — the search box is the same brain
      // with typed input, so go there rather than dead-ending.
      silenceRing();
      setVoiceEnabled(true, { greet: false });
      router.push("/search");
      setErrorText(WAIN_AI_COPY.unsupported);
      setPhase("error");
      return;
    }
    heardRef.current = "";
    rec.lang = "ar-KW";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    // The call connects when the engine starts listening, not when the button
    // was tapped: everything between the two is the microphone prompt, and
    // that is exactly the part the ring-back is covering.
    rec.onstart = () => {
      if (recRef.current !== rec) return;
      silenceRing();
      connected();
      haptic("success");
      setPhase("live");
    };
    rec.onresult = (e) => {
      const parts: string[] = [];
      for (let i = 0; i < e.results.length; i++) parts.push(e.results[i][0]?.transcript ?? "");
      const text = parts.join(" ").trim();
      heardRef.current = text;
      setTranscript(text);
    };
    rec.onerror = (e) => {
      // Only the recogniser this call owns may end this call. `onstart` and
      // `onend` both checked that; this did not, and the asymmetry was the
      // bug. Hanging up abort()s the engine, and an engine reports an abort
      // asynchronously — a tick or two after teardown() has already moved on —
      // so the previous call's death landed on whatever was on screen by then:
      //
      //   · press the red button, and «ما سمعناك» replaced the ended call and
      //     its duration, as though the hang-up had been a failure;
      //   · press «اتصل مرة ثانية» quickly and the old error nulled out the new
      //     recogniser's handle, so the new call's onstart no longer recognised
      //     itself, and the call rang until the caller gave up.
      if (recRef.current !== rec) return;
      // An abort we did not cause still is not a failure to report: the engine
      // fires onend straight after, and that path answers with what was heard.
      if (e.error === "aborted") return;
      recRef.current = null;
      silenceRing();
      setErrorText(errorCopy(e.error));
      setPhase("error");
    };
    // Engines end recognition on their own after a pause — that IS the
    // "done talking" signal, so act on whatever was heard by then.
    rec.onend = () => {
      if (recRef.current === rec) finishWith(heardRef.current);
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      recRef.current = null;
      silenceRing();
      setErrorText(WAIN_AI_COPY.callFailed);
      setPhase("error");
    }
  }, [router, finishWith, silenceRing]);

  /* ---- agent mode: the ElevenLabs call ------------------------------------ */

  // The agent can put places on the visitor's screen instead of only naming
  // them: its tool definition (docs/wain-ai-agent.md) calls show_places with
  // an Arabic query, and the search page renders the matching pins, names and
  // icons. Registered once, before the widget's bundle ever loads.
  useEffect(() => {
    if (!WAIN_AI_AGENT_ENABLED) return;
    const register = (event: Event) => {
      const detail = (event as CustomEvent<{ config?: Record<string, unknown> }>).detail;
      if (!detail?.config) return;
      (detail.config as { clientTools?: Record<string, unknown> }).clientTools = {
        show_places: ({ query }: { query?: string }) => {
          const q = (query ?? "").trim();
          if (!q) return "empty query";
          router.push(`/search?q=${encodeURIComponent(q)}`);
          return `showing places for: ${q}`;
        },
        open_place: ({ slug }: { slug?: string }) => {
          const s = (slug ?? "").trim();
          if (!/^[a-z0-9-]+$/.test(s)) return "unknown place";
          router.push(`/places/${s}/`);
          return `opened: ${s}`;
        },
      };
    };
    window.addEventListener("elevenlabs-convai:call", register);
    return () => window.removeEventListener("elevenlabs-convai:call", register);
  }, [router]);

  const dialling = phase === "ringing" || phase === "live";

  useEffect(() => {
    if (!WAIN_AI_AGENT_ENABLED || !dialling || agentReady || agentFailed) return;
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${WAIN_AI_WIDGET_SRC}"]`
    );
    if (existing) {
      setAgentReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = WAIN_AI_WIDGET_SRC;
    script.async = true;
    script.onload = () => setAgentReady(true);
    script.onerror = () => setAgentFailed(true);
    document.body.appendChild(script);
  }, [dialling, agentReady, agentFailed]);

  useEffect(() => {
    const slot = slotRef.current;
    if (!WAIN_AI_AGENT_ENABLED || !dialling || !agentReady || !slot) return;
    if (slot.childElementCount === 0) {
      const el = document.createElement("elevenlabs-convai");
      el.setAttribute("agent-id", WAIN_AI_AGENT_ID);
      slot.appendChild(el);
    }
    // The widget is mounted and owns the microphone from here: that is the
    // call connecting, so stop ringing and start the clock.
    if (phaseRef.current !== "ringing") return;
    silenceRing();
    connected();
    setPhase("live");
  }, [dialling, agentReady, silenceRing]);

  // A widget that never loads is a call that never connects — say so rather
  // than ringing for ever.
  useEffect(() => {
    if (!agentFailed || phase !== "ringing") return;
    silenceRing();
    setErrorText(WAIN_AI_COPY.callFailed);
    setPhase("error");
  }, [agentFailed, phase, silenceRing]);

  /* ---- placing the call --------------------------------------------------- */
  const startCall = useCallback(() => {
    if (phase !== "idle" && phase !== "ended" && phase !== "error") return;
    haptic("tap");
    // Spend the gesture's audio permission now — see primeAudio(). By the time
    // شوق has an answer we are a navigation and a fetch away from here, and
    // iOS will not start audio then.
    primeAudio();
    setErrorText("");
    setTranscript("");
    setSeconds(0);
    setAgentFailed(false);
    silenceRing();
    stopRing.current = ringback();
    dialTimer.current = window.setTimeout(() => {
      dialTimer.current = null;
      if (phaseRef.current !== "ringing") return;
      teardown();
      setErrorText(WAIN_AI_COPY.noAnswer);
      setPhase("error");
    }, DIAL_TIMEOUT_MS);
    setPhase("ringing");
    if (!WAIN_AI_AGENT_ENABLED) startListening();
  }, [phase, startListening, silenceRing, teardown]);

  useEffect(() => () => teardown(), [teardown]);

  const open = phase !== "idle";

  /** The line under her name: what the call is doing right now. */
  const status =
    phase === "ringing"
      ? WAIN_AI_COPY.ringing
      : phase === "live"
        ? `${WAIN_AI_COPY.onCall} · ${callDuration(seconds)}`
        : phase === "answering"
          ? WAIN_AI_COPY.answering
          : phase === "ended"
            ? `${WAIN_AI_COPY.ended} · ${callDuration(seconds)}`
            : WAIN_AI_COPY.role;

  return (
    <>
      {/* ---- the call button ---- */}
      <div className="wain-ai-fab fixed bottom-5 start-5 z-50 flex flex-col items-start gap-2">
        <button
          type="button"
          onClick={startCall}
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
            <IconPhone className="relative size-5" />
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

      {/* ---- the call sheet ---- */}
      {open && (
        <div
          id="wain-ai-panel"
          role="dialog"
          aria-label={`${WAIN_AI_COPY.centre} — ${WAIN_AI_COPY.name}`}
          className="wain-ai-panel fixed bottom-24 start-5 z-50 w-[min(22rem,calc(100vw-2.5rem))] overflow-hidden rounded-3xl border border-line bg-white shadow-2xl"
        >
          {/* Same reason as the launcher: the coral-500 end of this gradient
              cannot carry white body text at AA. */}
          <header className="flex items-center gap-3 bg-gradient-to-l from-coral-800 to-coral-600 p-4 text-white">
            <span className="relative grid size-11 shrink-0 place-items-center rounded-2xl bg-white/20">
              <VoiceMark className="size-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-lg font-semibold leading-tight">
                {WAIN_AI_COPY.name}
              </span>
              {/* The status is the one thing that changes without the visitor
                  touching anything, so it is the thing that gets announced. */}
              <span
                className="flex items-center gap-1 text-xs text-coral-50"
                aria-live="polite"
              >
                <IconPinSolid className="size-3" />
                {status}
              </span>
            </span>
            <button
              type="button"
              onClick={closeSheet}
              aria-label={WAIN_AI_COPY.close}
              className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15 transition hover:bg-white/25"
            >
              <IconClose className="size-4" />
            </button>
          </header>

          <div className="p-4">
            {(phase === "ringing" || phase === "live" || phase === "answering") && (
              <div className="text-center">
                <span className="relative mx-auto grid size-16 place-items-center">
                  {phase !== "answering" && (
                    <span className="absolute inset-0 animate-ping rounded-full bg-coral-200 motion-reduce:animate-none" />
                  )}
                  <span className="relative grid size-14 place-items-center rounded-full bg-coral-600 text-white">
                    <VoiceMark className="size-7" />
                  </span>
                </span>

                <p className="mt-3 font-display text-lg font-semibold text-ink-900" aria-live="polite">
                  {phase === "ringing"
                    ? WAIN_AI_COPY.ringing
                    : phase === "answering"
                      ? WAIN_AI_COPY.answering
                      : transcript || WAIN_AI_COPY.listening}
                </p>
                {/* Ringing is the one moment with nothing to hear and nothing
                    to do, so it carries what she is for; once she is on the
                    line, the short examples are enough. */}
                {phase === "ringing" && (
                  <p className="mt-1 text-xs leading-relaxed text-ink-500">
                    {WAIN_AI_COPY.greeting}
                  </p>
                )}
                {phase === "live" && !transcript && (
                  <p className="mt-1 text-xs text-ink-500">{WAIN_AI_COPY.listeningExamples}</p>
                )}

                {/* Agent mode puts the conversation itself here. */}
                {WAIN_AI_AGENT_ENABLED && (
                  <div className="mt-4 min-h-24 rounded-2xl bg-sand-100 p-3">
                    {agentReady ? (
                      <div ref={slotRef} />
                    ) : (
                      <p className="py-4 text-center text-sm font-semibold text-ink-500">
                        {WAIN_AI_COPY.loading}
                      </p>
                    )}
                  </div>
                )}

                {/* One red button, on every path, meaning exactly one thing. */}
                <button
                  type="button"
                  onClick={endCall}
                  className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-coral-700 px-5 text-sm font-semibold text-white transition hover:bg-coral-800"
                >
                  <IconPhone className="size-4 rotate-[135deg]" />
                  {WAIN_AI_COPY.hangUp}
                </button>
              </div>
            )}

            {phase === "ended" && (
              <div className="text-center">
                <p className="py-2 font-display text-lg font-semibold text-ink-900">
                  {WAIN_AI_COPY.ended}
                </p>
                <p className="text-sm text-ink-500" dir="ltr">
                  {callDuration(seconds)}
                </p>
                <button
                  type="button"
                  onClick={startCall}
                  className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white transition hover:bg-ink-800"
                >
                  <IconPhone className="size-4" />
                  {WAIN_AI_COPY.callAgain}
                </button>
              </div>
            )}

            {phase === "error" && (
              <div className="text-center">
                <p className="py-2 text-sm font-semibold text-ink-600" role="alert">
                  {errorText}
                </p>
                <button
                  type="button"
                  onClick={startCall}
                  className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white transition hover:bg-ink-800"
                >
                  <IconPhone className="size-4" />
                  {WAIN_AI_COPY.callAgain}
                </button>
              </div>
            )}

            <p className="mt-3 text-center text-2xs leading-relaxed text-ink-500">
              {WAIN_AI_COPY.micNote}{" "}
              <Link href="/privacy" className="underline hover:text-coral-700">
                الخصوصية
              </Link>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
