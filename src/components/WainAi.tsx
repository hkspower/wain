"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IconClose, IconPinSolid } from "@/components/icons";
import { haptic } from "@/lib/haptics";
import { primeAudio, setEnabled as setVoiceEnabled } from "@/lib/voice";
import {
  WAIN_AI_AGENT_ENABLED,
  WAIN_AI_AGENT_ID,
  WAIN_AI_COPY,
  WAIN_AI_WIDGET_SRC,
} from "@/lib/wain-ai";

/**
 * The وين AI button: hold it three seconds and talk.
 *
 * Why hold rather than tap: a voice session takes over the audio output and
 * asks for the microphone, which is far too much for a pocket-tap. Three
 * deliberate seconds — with the ring filling so the wait is visibly *going*
 * somewhere — is the difference between "I asked for this" and "what just
 * happened". A quick tap gets a hint instead of a session.
 *
 * Held to the pointer only: keyboard and switch-control users cannot
 * comfortably hold, so for them Enter/Space activates immediately. That is
 * not a loophole, it is the accessible path (WCAG 2.5.1 — no gesture may be
 * the only way in).
 *
 * Two session modes, picked by configuration — see src/lib/wain-ai.ts.
 * In local mode the spoken question goes through the browser's speech
 * recognition, which on most engines is processed by the browser vendor's
 * speech service — said plainly in the panel and on the privacy page.
 */

const HOLD_MS = 3000;

type Phase =
  | "idle"
  | "holding"
  | "listening" // local mode: recognition running
  | "agent" // agent mode: convai panel open
  | "error";

/* Minimal typings for the vendor-prefixed Web Speech recognition API. */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
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
  const [hint, setHint] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [errorText, setErrorText] = useState("");
  const [agentReady, setAgentReady] = useState(false);
  const [agentFailed, setAgentFailed] = useState(false);

  const holdTimer = useRef<number | null>(null);
  const hintTimer = useRef<number | null>(null);
  const holding = phase === "holding";
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  // The transcript as of the last result event, so onend can act on what was
  // actually heard even when the final-result event never fires.
  const heardRef = useRef("");

  /* ---- shared: leave any session ---------------------------------------- */
  const close = useCallback(() => {
    recRef.current?.abort();
    recRef.current = null;
    setPhase("idle");
    setTranscript("");
    setErrorText("");
  }, []);

  useEffect(() => {
    if (phase === "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, close]);

  /* ---- local mode: listen, search, speak --------------------------------- */
  const finishWith = useCallback(
    (spoken: string) => {
      const q = spoken.trim();
      recRef.current = null;
      if (!q) {
        setErrorText(WAIN_AI_COPY.noSpeech);
        setPhase("error");
        return;
      }
      haptic("success");
      // The visitor asked out loud, so the answer speaks too: turn صوت وين on
      // (quietly — the search page's own summary is the reply) and let the
      // search screen show the matching places on its map.
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
      setPhase("idle");
      setTranscript("");
      router.push(`/search?q=${encodeURIComponent(q)}`);
    },
    [router]
  );

  const startListening = useCallback(() => {
    const rec = getRecognition();
    if (!rec) {
      // No speech input in this browser — the search box is the same brain
      // with typed input, so go there rather than dead-ending.
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
    rec.onresult = (e) => {
      const parts: string[] = [];
      for (let i = 0; i < e.results.length; i++) parts.push(e.results[i][0]?.transcript ?? "");
      const text = parts.join(" ").trim();
      heardRef.current = text;
      setTranscript(text);
    };
    rec.onerror = (e) => {
      recRef.current = null;
      setErrorText(e.error === "not-allowed" ? WAIN_AI_COPY.micDenied : WAIN_AI_COPY.noSpeech);
      setPhase("error");
    };
    // Engines end recognition on their own after a pause — that IS the
    // "done talking" signal, so act on whatever was heard by then.
    rec.onend = () => {
      if (recRef.current === rec) finishWith(heardRef.current);
    };
    recRef.current = rec;
    setPhase("listening");
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setErrorText(WAIN_AI_COPY.failed);
      setPhase("error");
    }
  }, [router, finishWith]);

  /* ---- agent mode: the ElevenLabs panel ---------------------------------- */

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

  useEffect(() => {
    if (phase !== "agent" || agentReady || agentFailed) return;
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
  }, [phase, agentReady, agentFailed]);

  useEffect(() => {
    const slot = slotRef.current;
    if (phase !== "agent" || !agentReady || !slot || slot.childElementCount > 0) return;
    const el = document.createElement("elevenlabs-convai");
    el.setAttribute("agent-id", WAIN_AI_AGENT_ID);
    slot.appendChild(el);
  }, [phase, agentReady]);

  /* ---- the hold gesture --------------------------------------------------- */
  const activate = useCallback(() => {
    haptic("success");
    // Spend the gesture's audio permission now — see primeAudio(). By the time
    // شوق has an answer we are a navigation and a fetch away from here, and
    // iOS will not start audio then.
    primeAudio();
    if (WAIN_AI_AGENT_ENABLED) setPhase("agent");
    else startListening();
  }, [startListening]);

  const cancelHold = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setPhase((p) => (p === "holding" ? "idle" : p));
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (phase !== "idle") return;
      // Mouse: primary button only.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      try {
        // Keeps the hold alive when the finger drifts off the button. Throws
        // on pointers that are already gone (and in some browsers on touch
        // ids it no longer tracks) — losing capture just means a drifting
        // finger cancels, so it is not worth failing the gesture over.
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* gesture continues uncaptured */
      }
      haptic("tap");
      setHint(null);
      setPhase("holding");
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null;
        activate();
      }, HOLD_MS);
    },
    [phase, activate]
  );

  const onPointerUp = useCallback(() => {
    if (holdTimer.current !== null) {
      // Released early — explain the gesture briefly.
      cancelHold();
      setHint(WAIN_AI_COPY.holdHint);
      if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
      hintTimer.current = window.setTimeout(() => setHint(null), 2200);
    }
  }, [cancelHold]);

  // Keyboard and assistive tech: activate on the click event, no hold. A
  // pointer session never reaches here because pointerup already consumed the
  // gesture (holdTimer null → click after a real hold is ignored via phase).
  const onKeyActivate = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if ((e.key === "Enter" || e.key === " ") && phase === "idle") {
        e.preventDefault();
        activate();
      }
    },
    [phase, activate]
  );

  useEffect(
    () => () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
      if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
      recRef.current?.abort();
    },
    []
  );

  const open = phase === "listening" || phase === "agent" || phase === "error";

  return (
    <>
      {/* ---- the button ---- */}
      <div className="wain-ai-fab fixed bottom-5 start-5 z-50 flex flex-col items-start gap-2">
        {hint && (
          <span
            role="status"
            className="rounded-full bg-ink-900/90 px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
          >
            {hint}
          </span>
        )}
        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelHold}
          onKeyDown={onKeyActivate}
          onContextMenu={(e) => e.preventDefault()}
          aria-label={`${WAIN_AI_COPY.launcher} — ${WAIN_AI_COPY.holdHint}`}
          aria-expanded={open}
          aria-controls="wain-ai-panel"
          style={{ touchAction: "none" }}
          className="group relative flex select-none items-center gap-2.5 rounded-full bg-gradient-to-b from-coral-500 to-coral-700 py-3 pe-5 ps-4 text-white shadow-xl shadow-coral-700/30 transition duration-300 hover:-translate-y-0.5 hover:shadow-2xl active:translate-y-0"
        >
          <span className="relative grid size-9 place-items-center">
            {/* Progress ring: sweeps once around over the three seconds. */}
            <svg viewBox="0 0 36 36" className="absolute inset-0 size-9 -rotate-90" aria-hidden="true">
              <circle cx="18" cy="18" r="16" fill="rgba(255,255,255,.2)" />
              <circle
                cx="18"
                cy="18"
                r="16"
                fill="none"
                stroke="#fff"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 16}
                strokeDashoffset={holding ? 0 : 2 * Math.PI * 16}
                style={{
                  transition: holding
                    ? `stroke-dashoffset ${HOLD_MS}ms linear`
                    : "none",
                }}
              />
            </svg>
            <VoiceMark className="relative size-5" />
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

      {/* ---- the panel ---- */}
      {open && (
        <div
          id="wain-ai-panel"
          role="dialog"
          aria-label={`${WAIN_AI_COPY.name} — ${WAIN_AI_COPY.role}`}
          className="wain-ai-panel fixed bottom-24 start-5 z-50 w-[min(22rem,calc(100vw-2.5rem))] overflow-hidden rounded-3xl border border-line bg-white shadow-2xl"
        >
          <header className="flex items-center gap-3 bg-gradient-to-l from-coral-700 to-coral-500 p-4 text-white">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/20">
              <VoiceMark className="size-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-lg font-semibold leading-tight">
                {WAIN_AI_COPY.name}
              </span>
              <span className="flex items-center gap-1 text-xs text-coral-50">
                <IconPinSolid className="size-3" />
                {WAIN_AI_COPY.role}
              </span>
            </span>
            <button
              type="button"
              onClick={close}
              aria-label={WAIN_AI_COPY.close}
              className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15 transition hover:bg-white/25"
            >
              <IconClose className="size-4" />
            </button>
          </header>

          <div className="p-4">
            {phase === "listening" && (
              <div className="text-center">
                <span className="relative mx-auto grid size-16 place-items-center">
                  <span className="absolute inset-0 animate-ping rounded-full bg-coral-200 motion-reduce:animate-none" />
                  <span className="relative grid size-14 place-items-center rounded-full bg-coral-600 text-white">
                    <VoiceMark className="size-7" />
                  </span>
                </span>
                <p className="mt-3 font-display text-lg font-semibold text-ink-900" aria-live="polite">
                  {transcript || WAIN_AI_COPY.listening}
                </p>
                <p className="mt-1 text-xs text-ink-500">{WAIN_AI_COPY.listeningExamples}</p>
                <button
                  type="button"
                  onClick={() => recRef.current?.stop()}
                  className="mt-4 min-h-11 rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white transition hover:bg-ink-800"
                >
                  خلصت
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
                  onClick={() => {
                    setErrorText("");
                    if (WAIN_AI_AGENT_ENABLED) setPhase("agent");
                    else startListening();
                  }}
                  className="mt-2 min-h-11 rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white transition hover:bg-ink-800"
                >
                  جرّب مرة ثانية
                </button>
              </div>
            )}

            {phase === "agent" && (
              <>
                <p className="text-sm leading-relaxed text-ink-600">{WAIN_AI_COPY.greeting}</p>
                <p className="mt-2 text-xs leading-relaxed text-ink-500">{WAIN_AI_COPY.hint}</p>
                <div className="mt-4 min-h-24 rounded-2xl bg-sand-100 p-3">
                  {agentFailed ? (
                    <p className="py-4 text-center text-sm font-semibold text-ink-600">
                      {WAIN_AI_COPY.failed}
                    </p>
                  ) : agentReady ? (
                    <div ref={slotRef} />
                  ) : (
                    <p className="py-4 text-center text-sm font-semibold text-ink-500">
                      {WAIN_AI_COPY.loading}
                    </p>
                  )}
                </div>
              </>
            )}

            <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-500">
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
