"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { IconCall, IconClose, IconPhone, IconSend, IconShouq } from "@/components/icons";
import { haptic } from "@/lib/haptics";
import { getRecognition, isInAppBrowser, speechLang, transcriptOf, type SpeechRecognitionLike } from "@/lib/speech";
import { primeAudio, setEnabled as setVoiceEnabled, stop as stopVoice } from "@/lib/voice";
import { usePlaces } from "@/lib/usePlaces";
import { PLACES_COUNT, countAr } from "@/lib/place-kit";
import { callDuration, connected, hangup, ringback } from "@/lib/call-tones";
import { agentEnabledFor, agentIdFor, agentSay, callCopy, MATCHING_PLACES, salemHandoff, type CallPersona, WAIN_AI_ANY_AGENT_ENABLED, WAIN_AI_COPY } from "@/lib/wain-ai";
// The bus's `import type { Phase }` back from this file is erased at compile
// time, so this is not a runtime cycle.
import {
  callAgentAvailable,
  loadWidget,
  markWidgetBroken,
  takeLocalRecognition,
  takeMicProbe,
  takeRequestedMode,
  takeRequestedPersona,
  type MicProbeResult,
} from "@/lib/wain-ai-bus";
import { isQuotaRefusal, markAgentUnavailable } from "@/lib/agent-health";

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
 * Two ways the call is served, picked per dial — see lib/wain-ai.ts and
 * lib/agent-health.ts:
 *
 *   Agent mode  — the ElevenLabs widget, a real duplex conversation. She can
 *                 also put places on screen mid-call through the client tools
 *                 registered below.
 *   Local mode  — the browser's own speech recognition takes the question,
 *                 وين's search answers it on the results page, which reads the
 *                 answer aloud. The call then waits as a bar over the results
 *                 for the next question («answered» below): one tap, one
 *                 question, as many as the caller has (14 October, on request;
 *                 it used to be one question per call).
 *
 * In local mode the spoken question goes through the browser's speech
 * recognition, which on most engines is processed by the browser vendor's
 * speech service — said on the privacy page; the sheet says only that the
 * microphone is needed.
 */

export type Phase =
  | "idle"
  | "ringing" // dialling: waiting on the microphone, or on the widget
  | "live" // connected — she is listening
  | "answering" // local mode: she has the question and is replying
  | "answered" // local mode: the answer is on the page; a bar waits for the next question
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
/** The shortest ring, even when the engine is listening at once. */
const RING_MIN_MS = 700;
/** Listening with nothing heard: stop and say so. See `onstart`. */
const SILENCE_MS = 8_000;
/** Listening at all: a question is a sentence, not a speech. */
const LISTEN_MAX_MS = 15_000;

/** How long the ready screen waits for Start before pointing at it again. */
const START_NUDGE_MS = 15_000;
/**
 * The widget's own two controls, by the labels its config gives them: start_call
 * («بدء مكالمة») and end_call («إنهاء»). The widget draws them with these as
 * aria-labels inside its shadow root, which is the only place the sheet can see
 * whether a call is up. They must match the agent's widget text_contents; the
 * widget suite (tests/shouq-widget-csp.test.mjs) carries the same two strings.
 */
const WIDGET_START_LABEL = "بدء مكالمة";
const WIDGET_END_LABEL = "إنهاء";

/**
 * Whether her widget's bundle, once loaded, actually ran.
 *
 * `load` says the file arrived and ran, not that it worked: a bundle that
 * throws part-way fires it all the same. This one defines its element on its
 * very last line (read out of 0.19.0), so an element still undefined after
 * `load` is a bundle this browser could not run — an older Safari meeting
 * syntax it does not know throws before that line. Mounting it then draws
 * nothing at all, and the sheet asked the visitor to press «بدء مكالمة» on a
 * button that was never going to appear (8 October). `whenDefined` with a short
 * wait rather than a bare `get`, so a bundle that defines a tick later is not
 * mistaken for a broken one.
 */
function widgetRuns(): Promise<boolean> {
  const tag = "elevenlabs-convai";
  if (typeof customElements === "undefined") return Promise.resolve(false);
  if (customElements.get(tag)) return Promise.resolve(true);
  return new Promise((done) => {
    const wait = window.setTimeout(() => done(false), 2000);
    void customElements.whenDefined(tag).then(() => {
      window.clearTimeout(wait);
      done(true);
    });
  });
}

/**
 * What the caller is told about an engine error.
 *
 * Every code other than `not-allowed` used to produce «ما سمعناك» — "we didn't
 * hear you". That is wrong for most of them and actively misleading for the
 * two that mean the vendor's speech service is unreachable, because it invites
 * a retry into exactly the same failure. `aborted` is not in here at all: that
 * one is us hanging up, and it is handled before this is reached.
 */
/**
 * The same refusal on an iPhone in Safari itself (Chrome on iOS too: same
 * engine, same switch). There WebKit says `service-not-allowed` when Dictation
 * is off or Safari's speech permission is refused (SFSpeechRecognizer), and
 * «open the site in Safari» — what speechOff says — told a visitor already in
 * Safari to go where they were (8 October). The switch is in Settings. Kept
 * here, in the call's own chunk, rather than in WAIN_AI_COPY, which every page
 * loads.
 */
const SPEECH_OFF_APPLE =
  "التعرّف على الصوت مطفّي بجوالك — شغّل «الإملاء» من الإعدادات › عام › لوحة المفاتيح، أو اكتب لسالم.";

function inAppleSafari(): boolean {
  if (typeof navigator === "undefined" || !/Apple/.test(navigator.vendor ?? "")) return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return !isInAppBrowser() && nav.standalone !== true && /Safari\//.test(nav.userAgent);
}

function errorCopy(code: string, failed: string): string {
  // `service-not-allowed` is not the microphone. WebKit answers it when Siri
  // and Dictation are off or the locale is one Apple does not have, and an
  // app's built-in browser answers `not-allowed` because the host app never
  // asked the phone for speech. All of them read «allow the microphone» until
  // 3 October, to callers whose microphone was allowed.
  if (code === "service-not-allowed" && inAppleSafari()) return SPEECH_OFF_APPLE;
  if (code === "service-not-allowed" || code === "language-not-supported") return WAIN_AI_COPY.speechOff;
  if (code === "not-allowed") return isInAppBrowser() ? WAIN_AI_COPY.speechOff : WAIN_AI_COPY.micDenied;
  if (code === "no-speech") return WAIN_AI_COPY.noSpeech;
  // `audio-capture` is the engine finding no usable microphone — the same
  // fact the agent path's probe reports as noMic. It read «we could not reach
  // her» until 14 October, which sent the caller to retry a line that was
  // never the problem.
  if (code === "audio-capture") return WAIN_AI_COPY.noMic;
  // network, bad-grammar. `failed` is the persona's own words for «we could
  // not reach them» (callCopy).
  return failed;
}

/* The detection, the typings and the locale now live in lib/speech, because
   the search box listens too and a second copy of ar-KW is a second copy that
   can lose it. The orchestration below — ring-back, silence, six phases — is
   this file's alone and stays here. */

type Props = {
  /**
   * Bumped by the launcher on every tap. Not a boolean, because the second
   * call of a session has to start from a component that is already mounted —
   * a flag that is already `true` says nothing has changed.
   */
  startSignal: number;
  /** Lets the launcher — which stays behind in the static chunk — pulse, mouth
   *  the words, and set aria-expanded without knowing how a call works. */
  onPhase: (phase: Phase) => void;
};

export default function WainAiCall({ startSignal, onPhase }: Props) {
  const router = useRouter();
  // Where the caller is, for the bar after a free call's answer: it belongs to
  // the page the answer landed on, and goes when the caller leaves that page.
  const pathname = usePathname();
  /**
   * The rows شوق answers from — live, the same ones every listing renders.
   *
   * This is the whole of «full dynamic». The tool results below have always
   * claimed to run «the same search the page runs (same index, same limit)»,
   * and they did not: they built an index from `@/lib/places`, the build-time
   * snapshot, while /search, /explore and every place page render
   * `usePlaces()`. Identical until an admin touches anything, and then شوق is
   * describing the previous deploy's catalogue to somebody looking at this
   * one — she cannot find a place that was added, still finds one that was
   * unpublished, and reads out the old name of one that was renamed.
   *
   * `usePlaces` is one query shared across every component that calls it, so
   * this costs nothing beyond what the page already paid, and it is only ever
   * reached from inside this lazily-loaded chunk — the launcher in the root
   * layout still imports no place data.
   */
  const { places } = usePlaces();
  const [phase, setPhase] = useState<Phase>("idle");
  /**
   * Is THIS call the agent's? The build says whether there is an agent at all;
   * each dial asks whether it is worth trying (lib/agent-health.ts). A device
   * that met a refusal for credits gets the free call — the phone's own
   * recogniser and our search — instead of a widget that will only say no.
   */
  const [agentMode, setAgentMode] = useState(WAIN_AI_ANY_AGENT_ENABLED);
  // The same, for the dial timeout, which fires from a closure made before the
  // state had settled.
  const agentModeRef = useRef(WAIN_AI_ANY_AGENT_ENABLED);
  // This sheet showed a refusal for credits: its «اتصل مرة ثانية» promises the
  // guide, so that redial is the free call however long the screen stayed up.
  const refusedRef = useRef(false);
  const [transcript, setTranscript] = useState("");
  const [errorText, setErrorText] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [agentReady, setAgentReady] = useState(false);
  const [agentFailed, setAgentFailed] = useState(false);
  /**
   * Agent mode only: has the widget actually STARTED a call, as opposed to
   * merely being on the page?
   *
   * This is the defect behind «she didn't hear my voice, and nothing told me».
   * The sheet used to declare «متصل — قول وش تبي» the instant the
   * `<elevenlabs-convai>` element mounted. But mounting it connects nothing:
   * the agent's widget config is `variant: full`, `default_expanded: false`,
   * carries a terms notice, and waits for the visitor to press its own
   * «بدء مكالمة» — and only THEN asks for the microphone and opens a session.
   * So a caller obeyed the sheet, spoke to a widget that was not listening,
   * and got silence from an interface that had just said she was on the line.
   *
   * The widget's `startSession` awaits its terms gate and then dispatches
   * `elevenlabs-convai:call` (read out of the published 0.18.1 bundle), so
   * that event — and only that event — is «the call is starting». The test
   * stub used to fire it from `connectedCallback`, at mount, which is exactly
   * why no test ever saw the gap: it made «mounted» and «started» the same
   * moment, so the suite pinned the bug in place.
   */
  const [started, setStarted] = useState(false);
  /**
   * The widget ended the call on its own — the agent's end_call, the server's
   * limit on a call's length, or the caller's own إنهاء inside the widget.
   *
   * Nothing tells the sheet so: 0.19.0 dispatches no end event, and startSession
   * overwrites any callback the page passes in. What the widget does in all three
   * cases is take its red إنهاء away, bring back its بدء مكالمة and keep its
   * rating on screen (measured on the real bundle, 8 October). The sheet reads
   * that change — see the observer below. The widget is LEFT on the sheet: its
   * rating is the widget's, and removing it would remove the one place the caller
   * can rate the call.
   */
  const [endedByWidget, setEndedByWidget] = useState(false);
  /**
   * Whether this call's إنهاء has been seen, so the widget is connected. Only
   * after that does its بدء مكالمة count as an end: right after the call event the
   * widget still shows its start control while its consent sheet closes, and on
   * a slow connection for longer. A ref, because the observer reads it from its
   * own callback.
   */
  const connectedRef = useRef(false);
  /**
   * The caller has pressed something in the widget before the call started —
   * its Start, which opens its consent sheet. The box waits for Start at a
   * compact 11rem, and the consent sheet, drawn inside it, is taller: its
   * heading «قبل ما تبدأ» and the first lines of what the caller was agreeing
   * to were cut off above the box, at every width (8 October, measured on the
   * real widget with the live terms). From that tap the box takes the size it
   * has once the call is up.
   */
  const [reached, setReached] = useState(false);
  // The widget's Start is the only way forward and nothing on the sheet can press
  // it (it sits behind the widget's own consent gate). A caller who never sees it
  // used to wait on «اضغط بدء مكالمة» for ever — nothing times out after `live`.
  const [startHint, setStartHint] = useState(false);
  /**
   * What شوق just did to the screen, in the caller's own words.
   *
   * She drives the interface — `show_places` navigates, `open_place` opens a
   * profile — and the caller was told none of it. The sheet is full screen, so
   * the page she is changing is entirely BEHIND it: the results swapped, the
   * route changed, and the only account of it was شوق saying so out loud,
   * which a caller who has the volume down or is deaf to her never gets.
   *
   * This is the one kind of feedback the component can give honestly, because
   * unlike «is she speaking» it is OUR code doing the thing — the tool handler
   * below has the count and the name in hand at the moment it returns them to
   * her. Cleared on every fresh dial so a new call never opens showing what
   * the last one did.
   */
  const [lastAction, setLastAction] = useState("");
  // The place her last tool put on screen, for «رسّلها للربع» when she hangs
  // up — the one thing a call is for, one tap from the end of it.
  const [lastSlug, setLastSlug] = useState<string | null>(null);
  /** What she last searched for, for «كمّل مع سالم» on the last screen: the
   * same question, typed, with him — switching used to mean starting over. */
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  /**
   * Whose call this is: her agent or his. The tap that asked for the call says
   * which (takeRequestedPersona in startCall); a redial from the sheet keeps it.
   * There is no switch mid-call — each persona has its own agent, and a call
   * never changes hands. This component never unmounts (see Props.startSignal
   * above), so the state outlives the call and startCall() sets it afresh.
   */
  const [persona, setPersona] = useState<CallPersona>("shouq");
  const personaRef = useRef<CallPersona>("shouq");
  personaRef.current = persona;
  /** This persona's words for the sheet, read in render. Callbacks read
      `callCopy(personaRef.current)` at the moment they speak. */
  const copy = callCopy(persona);

  /**
   * Whether شوق's mouth moves — only when we actually KNOW she is speaking.
   *
   * It used to be `live || answering`, and the comment here argued correctly
   * that a face mouthing words at a ringing phone «is the interface telling a
   * small lie». It then told a larger one: `live` is the state where she is
   * LISTENING, and in agent mode it is the whole call. Measured on a built
   * agent-mode export — 2 of 2 faces carried `shouq--talking` from the moment
   * the call connected, for as long as it lasted, over a widget that had not
   * said a word.
   *
   * And nothing here can know better. The widget keeps `isSpeaking` and `mode`
   * inside its own Preact state and dispatches exactly one custom event,
   * `elevenlabs-convai:call` — checked by reading the published 0.18.1 bundle,
   * rather than by hoping. So there is no
   * signal to animate from, and an animation that is always on carries no
   * information while looking exactly like one that does.
   *
   * `answering` is the one state that is genuinely «she is producing speech»,
   * and it exists only in local mode. Agent mode gets the widget's own
   * volume-reactive orb in the slot below, which is driven by the audio it can
   * actually hear. She blinks throughout either way — that is being present.
   */
  const talking = !agentMode && phase === "answering";
  /* Hoisted from just above the render. Two effects start work on it now —
     the widget bundle and the search index — and both sit higher up the file
     than the line that used to declare it. */
  const dialling = phase === "ringing" || phase === "live";

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  // The dialog itself, focused when it opens — see the effect on `open`.
  const panelRef = useRef<HTMLDivElement>(null);
  const answerTimer = useRef<number | null>(null);
  // Stops the ring-back. Held in a ref rather than state because it has to be
  // callable from cleanup, from every failure path, and from the moment the
  // call connects — none of which should wait for a render.
  const stopRing = useRef<(() => void) | null>(null);
  const ringStartedAt = useRef(0);
  // Gives up on a call that never connects — see DIAL_TIMEOUT_MS.
  const dialTimer = useRef<number | null>(null);
  // Which microphone probe is the current call's — see checkMic().
  const micProbe = useRef(0);
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
    micProbe.current++;
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
  //
  // In agent mode «connected» means the widget started a call, not that it
  // mounted — see `started` — so the clock waits for that too. A clock running
  // over a widget nobody has pressed Start on is the same lie as the word
  // «متصل» beside it. Nor one over a call the widget has already ended — the
  // clock stops where the call stopped (endedByWidget).
  const clockRunning = phase === "live" && (!agentMode || (started && !endedByWidget));
  useEffect(() => {
    if (!clockRunning) return;
    const startedAt = Date.now();
    setSeconds(0);
    const id = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [clockRunning]);

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
      // The visitor asked out loud, so the answer speaks too: turn the voice
      // on (quietly — the page's own summary is the reply) and let the page
      // show the matching places. The page speaks, which is why the sheet
      // stepping aside here is not her stopping.
      setVoiceEnabled(true, { greet: false });
      // Whose call this is decides where the answer lands. Hers: /search, her
      // answer card and the map. His: HIS chat, which answers the question in
      // his name — until 14 October his free call ended on her card too, so a
      // caller who had asked سالم was answered by شوق.
      const his = personaRef.current === "salem";
      // Hand the question across so she can repeat what she heard and answer
      // without the typing debounce. Session storage rather than a query
      // parameter: ?q= is shared and bookmarked, and this is about one spoken
      // moment, not part of the search. His chat echoes the question as the
      // visitor's own line, so it needs no handover.
      if (!his) {
        try {
          sessionStorage.setItem("wain:asked", q);
        } catch {
          /* private mode — she just answers without the echo */
        }
      }
      setLastQuery(q);
      setLastAction(`${WAIN_AI_COPY.didSearch} «${q}»`);
      answerTimer.current = window.setTimeout(() => {
        answerTimer.current = null;
        // Not idle: the call waits for the next question as a bar over the
        // results (see Phase). The full sheet would hide the answer it just
        // found, and closing outright meant a walk back to /find per question.
        setPhase("answered");
        setTranscript("");
        router.push(his ? salemHandoff(q) : `/search?q=${encodeURIComponent(q)}`);
      }, ANSWER_MS);
    },
    [router, silenceRing]
  );

  const startListening = useCallback(() => {
    // The tap on the launcher may already have started the engine — see
    // `startLocalRecognition`, which exists because WebKit starts recognition
    // only inside the gesture. «اتصل مرة ثانية» is a tap inside this sheet,
    // so that path still starts its own, in its own gesture.
    const pre = takeLocalRecognition();
    const rec = pre?.rec ?? getRecognition();
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
    // Only the recogniser this call owns may end this call — see onerror.
    const mine = () => recRef.current === rec;
    // Nothing but the engine's own `onend` used to end a live call, and an
    // engine that never decides the caller has finished left the sheet
    // listening for ever — «she doesn't answer». Stop it after a silence, and
    // after a fixed while whatever is happening; `onend` then answers with
    // what was heard, exactly as when the engine ends it itself. Armed from
    // the moment the ENGINE starts, not from «متصل»: the sheet rings for
    // RING_MIN_MS after an engine that was already listening, and the caps
    // used to start after that wait, so the microphone was open longer than
    // the numbers said.
    let capsArmed = false;
    const armCaps = () => {
      if (capsArmed) return;
      capsArmed = true;
      window.setTimeout(() => {
        if (mine() && !heardRef.current) rec.stop();
      }, SILENCE_MS);
      window.setTimeout(() => {
        if (mine()) rec.stop();
      }, LISTEN_MAX_MS);
    };
    const handlers = {
      // The call connects when the engine starts listening, not when the
      // button was tapped: everything between the two is the microphone
      // prompt, and that is exactly the part the ring-back is covering.
      onstart: () => {
        if (!mine()) return;
        armCaps();
        // The engine the tap started can be listening before this sheet has
        // even drawn (a microphone granted on an earlier visit asks nothing),
        // and a call that is «connected» before it has rung does not read as
        // a call. A real phone rings at once; so does this one, briefly.
        const wait = RING_MIN_MS - (Date.now() - ringStartedAt.current);
        if (wait > 0) {
          window.setTimeout(() => {
            if (mine() && phaseRef.current === "ringing") handlers.onstart();
          }, wait);
          return;
        }
        silenceRing();
        connected();
        haptic("success");
        setPhase("live");
      },
      onresult: (e: Parameters<NonNullable<SpeechRecognitionLike["onresult"]>>[0]) => {
        if (!mine()) return;
        const text = transcriptOf(e);
        heardRef.current = text;
        setTranscript(text);
      },
      onerror: (e: { error: string }) => {
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
        if (!mine()) return;
        // An abort we did not cause still is not a failure to report: the engine
        // fires onend straight after, and that path answers with what was heard.
        if (e.error === "aborted") return;
        recRef.current = null;
        silenceRing();
        setErrorText(errorCopy(e.error, callCopy(personaRef.current).callFailed));
        setPhase("error");
      },
      // Engines end recognition on their own after a pause — that IS the
      // "done talking" signal, so act on whatever was heard by then.
      onend: () => {
        if (mine()) finishWith(heardRef.current);
      },
    };
    recRef.current = rec;
    if (pre) {
      if (pre.failed) {
        recRef.current = null;
        silenceRing();
        setErrorText(callCopy(personaRef.current).callFailed);
        setPhase("error");
        return;
      }
      pre.attach(handlers);
      return;
    }
    rec.lang = speechLang();
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = handlers.onstart;
    rec.onresult = handlers.onresult;
    rec.onerror = handlers.onerror;
    rec.onend = handlers.onend;
    try {
      rec.start();
    } catch {
      recRef.current = null;
      silenceRing();
      setErrorText(callCopy(personaRef.current).callFailed);
      setPhase("error");
    }
  }, [router, finishWith, silenceRing]);

  /* ---- agent mode: the ElevenLabs call ------------------------------------ */

  // The agent can put places on the visitor's screen instead of only naming
  // them: its tool definition (docs/wain-ai-agent.md) calls show_places with
  // an Arabic query, and the search page renders the matching pins, names and
  // icons. Registered once, before the widget's bundle ever loads.
  //
  // What each tool RETURNS is spoken to, not just logged: the string goes back
  // to the model as the tool result, and the model generates one more turn
  // from it. Measured in the agent's own test runs, that turn came back empty
  // every time the result was a bare status («showing places for: …») — the
  // answer had been given before the call, the tool "succeeded", and there was
  // nothing left to say. So the caller heard the screen change and then
  // silence, which on a phone reads as a dropped line. The result now says, in
  // her own language, what is on the screen and that the caller is waiting:
  // the two things the post-tool turn exists to say.
  //
  // And it says what is ACTUALLY on the screen. The first version told her
  // «the matching places are on the map» whatever the query — including when
  // the search page was showing «ما لقينا شي», so she would cheerfully confirm
  // places that were not there. The result now runs the same search the page
  // runs (same index, same limit) and reports the count and the first names,
  // so she can name what the caller is looking at, or say plainly that the
  // words found nothing and try wider ones. open_place likewise checks the
  // slug against the catalogue before claiming a page opened: a slug she
  // misremembered used to navigate to a 404 and then tell her it worked.
  //
  // The index is built from the LIVE rows above, not from `@/lib/places`, and
  // rebuilt whenever they change — see the note on `places`. The search module
  // is still not a static import: this component is preloaded on hover of the
  // call button, and the engine belongs to a conversation that may never
  // happen.
  //
  // But it used to be fetched on the FIRST TOOL CALL, which is the one moment
  // it must not be. `show_places` runs while شوق is mid-sentence and the
  // visitor is listening; hanging a chunk fetch off it puts the network between
  // her question and her answer, on the flow whose tool replies all end «لا
  // تسكتين». It starts when the call does instead — there is nothing to do
  // during ring-back but wait — and the tool awaits a promise that is by then
  // already settled. One loader per `places` identity, so an admin edit still
  // rebuilds the index rather than answering from the old rows.
  //
  // The page orders its results with `answerOrder` (answer-order.ts) since 3
  // October, so this does too: «the same search the page runs» has to include
  // the order, or she names one place first and the screen another.
  const loadIndex = useMemo(() => {
    let pending: Promise<{
      mod: typeof import("@/lib/search");
      order: typeof import("@/lib/answer-order");
      index: import("@/lib/search").SearchIndex;
    }> | null = null;
    return () =>
      (pending ??= Promise.all([import("@/lib/search"), import("@/lib/answer-order")]).then(
        ([mod, order]) => ({ mod, order, index: mod.buildIndex(places) }),
        (err) => {
          // Forget a failure, as SalemChat does: a chunk that failed once on a
          // weak line during ring-back left every show_places in the call
          // answering with no count and no names.
          pending = null;
          throw err;
        }
      ));
  }, [places]);

  useEffect(() => {
    if (!agentMode || !dialling) return;
    void loadIndex().catch(() => {
      // The tool call retries and falls through to its generic wording.
    });
  }, [agentMode, dialling, loadIndex]);

  useEffect(() => {
    if (!agentMode || phase !== "live" || started) {
      setStartHint(false);
      return;
    }
    const t = window.setTimeout(() => setStartHint(true), START_NUDGE_MS);
    return () => window.clearTimeout(t);
  }, [agentMode, phase, started]);

  useEffect(() => {
    if (!agentMode) return;
    const register = (event: Event) => {
      // The widget only dispatches this once the visitor has pressed its Start
      // button and cleared its terms gate — it is the one honest «the call is
      // starting» signal there is. It comes again after a voice switch, when
      // the widget is mounted fresh and has to be started again.
      setStarted(true);
      // A call that has just begun is not over yet — see connectedRef. This is
      // also how a redial from the widget's own Start makes the sheet live again.
      connectedRef.current = false;
      setEndedByWidget(false);
      connected();
      const detail = (event as CustomEvent<{ config?: Record<string, unknown> }>).detail;
      if (!detail?.config) return;
      // Whose grammar the tools speak in — read once, for this call. See agentSay.
      const say = agentSay(personaRef.current);
      (detail.config as { clientTools?: Record<string, unknown> }).clientTools = {
        show_places: async ({ query }: { query?: string }) => {
          const q = (query ?? "").trim();
          if (!q) return "ما وصلت كلمات بحث — ما تغيّر شي على الشاشة.";
          // Before the await, not after: loading the index is the slow part,
          // and the sheet used to say nothing until it was over.
          setLastAction(`${WAIN_AI_COPY.searching} «${q}»…`);
          setLastQuery(q);
          router.push(`/search?q=${encodeURIComponent(q)}`);
          let names: string[] = [];
          let total = -1;
          try {
            const { mod, order, index } = await loadIndex();
            const found = order
              .answerOrder(q, mod.search(q, index, { limit: 40 }), index, places)
              .hits.filter((h) => h.doc.kind === "place");
            total = found.length;
            names = found.slice(0, 3).map((h) => h.doc.title);
            setLastSlug(found[0] ? found[0].doc.id.replace(/^place:/, "") : null);
          } catch {
            // The page is still navigating and will show whatever it finds;
            // fall through to the generic wording rather than fail the call.
          }
          // Said to the caller, not to her: the same fact, in the sheet that
          // is covering the page it happened on. `countAr` and not a
          // hand-written «٧ مكان» — see place-kit, where this exact agreement
          // rule has now been got wrong by hand three separate times.
          // The names are the two she is about to read out, so the sheet and
          // her voice say the same thing.
          setLastAction(
            total >= 0
              ? `${WAIN_AI_COPY.didSearch} «${q}» — ${countAr(total, PLACES_COUNT)}` +
                  (names.length > 0 ? `: ${names.slice(0, 2).join("، ")}` : "")
              : `${WAIN_AI_COPY.didSearch} «${q}»`
          );
          if (total === 0) {
            return (
              `ما لقيت ولا مكان يطابق «${q}» — الشاشة الحين تقول «ما لقينا شي». ` +
              say(
                "قولي له بصراحة إن هالكلمات ما طلّعت شي، ورشّحي أقرب مكان من معرفتك، " +
                  "ونادي show_places مرة ثانية بكلمة أوسع (مثلاً «بحر» بدل «شاطئ هادي»). لا تسكتين.",
                "قول له بصراحة إن هالكلمات ما طلّعت شي، ورشّح أقرب مكان من معرفتك، " +
                  "ونادِ show_places مرة ثانية بكلمة أوسع (مثلاً «بحر» بدل «شاطئ هادي»). لا تسكت."
              )
            );
          }
          const summary =
            total > 0
              ? `${countAr(total, MATCHING_PLACES)} لـ «${q}» الحين على الخريطة قدام الزائر، أولها: ${names.join("، ")}. `
              : `الأماكن المطابقة لـ «${q}» الحين على الخريطة قدام الزائر. `;
          // One place, not the list. On 7 October a live call answered «بحر»
          // with two beaches and their descriptions before the map line, the
          // caller spoke over her at the fourth second, and the closing
          // question never came: on a phone line a list is the part nobody
          // hears the end of.
          return (
            summary +
            say(
              "اختاري منها مكان واحد بس يناسب طلبه، وقولي بجملة وحدة ليش وإنه على الخريطة قدامه، " +
                "وبعدها سؤال قصير يرجّع له الدور. لا تعدّدين أماكن. لا تسكتين.",
              "اختار منها مكان واحد بس يناسب طلبه، وقول بجملة وحدة ليش وإنه على الخريطة قدامه، " +
                "وبعدها سؤال قصير يرجّع له الدور. لا تعدّد أماكن. لا تسكت."
            )
          );
        },
        open_place: async ({ slug }: { slug?: string }) => {
          const s = (slug ?? "").trim();
          if (!/^[a-z0-9-]+$/.test(s)) {
            setLastAction(WAIN_AI_COPY.noPlace);
            return "ما لقيت مكان بهذا المعرّف — ما تغيّر شي على الشاشة.";
          }
          // The live rows, not `getPlace()` from the snapshot: a place
          // approved since the last deploy used to make her answer «ما فيه
          // مكان بالمعرّف» and refuse to navigate — to a page the visitor
          // could already see in the results behind her.
          const place = places.find((pl) => pl.slug === s);
          if (!place) {
            setLastAction(WAIN_AI_COPY.noPlace);
            return (
              `ما فيه مكان بالمعرّف (${s}) في قائمتك — ما تغيّر شي على الشاشة. ` +
              say(
                "تأكدي من الـ slug اللي في قاعدة المعرفة، أو حطي الأماكن على الخريطة بـ show_places بداله.",
                "تأكد من الـ slug اللي في قاعدة المعرفة، أو حط الأماكن على الخريطة بـ show_places بداله."
              )
            );
          }
          router.push(`/places/${s}/`);
          setLastAction(`${WAIN_AI_COPY.didOpen} «${place.nameAr}»`);
          setLastSlug(s);
          return (
            `صفحة «${place.nameAr}» (${s}) الحين مفتوحة قدام الزائر، فيها الصور وبيانات التواصل. ` +
            say(
              "قولي له إنك فتحتيها، واسأليه سؤال قصير يرجّع له الدور. لا تسكتين.",
              "قول له إنك فتحتها، واسأله سؤال قصير يرجّع له الدور. لا تسكت."
            )
          );
        },
      };
    };
    window.addEventListener("elevenlabs-convai:call", register);
    return () => window.removeEventListener("elevenlabs-convai:call", register);
    // `places` is in here on purpose. The handlers close over the rows, so a
    // registration left in place across an admin edit would answer from the
    // rows as they were when the call started — the same staleness this
    // change is about, only narrower and therefore harder to notice.
  }, [agentMode, router, places, loadIndex]);


  /**
   * The bundle is `loadWidget()`'s job now, not this effect's.
   *
   * This used to inject the script itself and, if it found a tag with the right
   * src already there, set `agentReady` on the spot. That was true while this
   * was the only injector. The button now starts the same fetch on pointerdown
   * — which is the point, it is 451KB — so «a tag exists» became «a tag exists
   * and may be half-downloaded», and the call would have announced «متصل» over
   * a bundle still on the wire. One shared promise resolves when it has
   * actually loaded, and rejects once if it never does.
   */
  useEffect(() => {
    if (!agentMode || !dialling || agentReady || agentFailed) return;
    let alive = true;
    loadWidget()
      .then(widgetRuns)
      .then(
        (runs) => {
          if (!alive) return;
          if (runs) return setAgentReady(true);
          // A bundle this browser could not run will not run on the next dial
          // either, so that one is ours: the sheet says she is not available
          // here and the redial is the free call, as after a refusal for
          // credits.
          markWidgetBroken();
          refusedRef.current = true;
          setAgentFailed(true);
        },
        () => alive && setAgentFailed(true)
      );
    return () => {
      alive = false;
    };
  }, [agentMode, dialling, agentReady, agentFailed]);

  useEffect(() => {
    const slot = slotRef.current;
    if (!agentMode || !dialling || !agentReady || !slot) return;
    if (slot.childElementCount === 0) {
      const el = document.createElement("elevenlabs-convai");
      el.setAttribute("agent-id", agentIdFor(persona));
      // Deliberately NOT `default-expanded`. Rendered for real (the published
      // 0.18.1 bundle, this agent's own widget config, 390px): collapsed, it
      // is a compact card at the bottom with a big labelled «بدء مكالمة»
      // button, leaving this sheet's heading, hang-up button and privacy note
      // visible above it — which is exactly what the heading below points at
      // («تحت»). Expanded, it becomes a full chat panel that covers the middle
      // of the sheet, and the call control shrinks to an unlabelled phone
      // icon beside a text box. The first version of this fix set it, on the
      // theory that the button was hidden behind a launcher; it never was.
      // Safari with «Block All Cookies» throws on any read of localStorage,
      // and the widget makes one, unguarded, to name the caller — after the
      // terms and before the call starts — so «قبول» did nothing and no call
      // ever began (8 October, read out of 0.19.0). Where storage cannot be
      // read, the caller gets a name for this call only, and the widget never
      // goes looking for one.
      try {
        window.localStorage.getItem("elevenlabs_convai_user_id");
      } catch {
        el.setAttribute("user-id", crypto.randomUUID?.() ?? `wain-${Date.now()}`);
      }
      slot.appendChild(el);
      // Her text box is the widget's own, 14px inside its shadow root —
      // measured on the real 0.19.0 bundle — and iPhone Safari zooms the page
      // into any field under 16px when it takes focus, and leaves the whole
      // call sheet zoomed (8 October). The root is open, so the floor the
      // site's own fields have goes in here: after the append, because the
      // widget renders into it on connect and a first render clears whatever
      // was there before it.
      const floor = document.createElement("style");
      floor.textContent = "@media (pointer: coarse) { textarea, input { font-size: 16px !important; } }";
      el.shadowRoot?.appendChild(floor);
      // A fresh widget on a call that is already live (its slot was emptied under
      // it) has to be started again, so the sheet goes back to asking for that
      // until the widget's own call event says it has.
      if (phaseRef.current === "live") {
        setStarted(false);
        setReached(false);
        // The widget is new, so nothing it showed before counts any more.
        setEndedByWidget(false);
        connectedRef.current = false;
      }
    }
    // The widget is mounted — but mounting is NOT the call connecting. It
    // still has to be started (and asks for the microphone then), so all this
    // does is stop the ring-back, which has nothing left to dial, and swap it
    // for the instruction to press Start. The «متصل» tone, the clock and the
    // word itself wait for `started`.
    if (phaseRef.current !== "ringing") return;
    silenceRing();
    setPhase("live");
  }, [agentMode, dialling, agentReady, silenceRing, persona]);

  /**
   * The account out of credits, read where the widget writes it.
   *
   * 7 October: the account ran dry on the live site, and the widget took the
   * refusal into its own panel — «[quota_exceeded] You've run out of credits»,
   * in English — and told the page nothing (0.19.0 dispatches one event, the
   * call event, before the session opens). So the sheet kept saying «على
   * الخط» over a call that had already been refused. Its shadow root is open,
   * so the refusal is read off the text it renders; the widget goes, the sheet
   * says so, and this device skips the agent for a while — the redial is the
   * free call (lib/agent-health.ts).
   */
  useEffect(() => {
    const root = slotRef.current?.querySelector("elevenlabs-convai")?.shadowRoot;
    if (!agentMode || !dialling || !agentReady || !root) return;
    const check = () => {
      // The widget's error text only, never the whole root: the root holds the
      // conversation too, and a caller who typed «I've run out of credits on
      // my phone» ended a healthy call (review of 7 October, on the real
      // 0.19.0 bundle). It writes a server error into `.text-base-error`; its
      // dialog, used when the transcript is off, is caught by the bracketed
      // code, which only the server's own reason carries.
      const said = Array.from(root.querySelectorAll(".text-base-error"), (n) => n.textContent ?? "").join(" ");
      if (!isQuotaRefusal(said) && !/\[quota_exceeded\]/i.test(root.textContent ?? "")) return;
      observer.disconnect();
      markAgentUnavailable();
      refusedRef.current = true;
      slotRef.current?.replaceChildren();
      teardown();
      setErrorText(callCopy(personaRef.current).agentUnavailable);
      setPhase("error");
    };
    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    check();
    return () => observer.disconnect();
  }, [agentMode, dialling, agentReady, started, persona, teardown]);

  /**
   * The widget's own end, read where it draws its controls (see endedByWidget).
   *
   * Two steps, and the first is what keeps it from crying wolf: a start control
   * counts as an end only once this call's إنهاء has been seen (connectedRef).
   * A إنهاء back on the widget is the other way round — a redial from the
   * widget's own Start, which makes the sheet live again.
   */
  useEffect(() => {
    const root = slotRef.current?.querySelector("elevenlabs-convai")?.shadowRoot;
    if (!agentMode || phase !== "live" || !started || !root) return;
    const check = () => {
      if (root.querySelector(`button[aria-label="${WIDGET_END_LABEL}"]`)) {
        connectedRef.current = true;
        setEndedByWidget(false);
        return;
      }
      if (connectedRef.current && root.querySelector(`button[aria-label="${WIDGET_START_LABEL}"]`))
        setEndedByWidget(true);
    };
    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });
    check();
    return () => observer.disconnect();
  }, [agentMode, phase, started, persona]);

  // A widget that never loads is a call that never connects — say so rather
  // than ringing for ever.
  useEffect(() => {
    if (!agentFailed || phase !== "ringing") return;
    silenceRing();
    setErrorText(refusedRef.current ? callCopy(personaRef.current).agentUnavailable : callCopy(personaRef.current).callFailed);
    setPhase("error");
  }, [agentFailed, phase, silenceRing]);

  /**
   * Agent mode: the microphone is asked for inside the tap, and the sheet
   * says so when it cannot be had.
   *
   * The widget owns the microphone and asks for it itself — but only once the
   * visitor has found its Start button, and a refusal, a missing device or a
   * mic held by another app is reported (if at all) inside the widget's own
   * small UI, or not at all. Nothing on this sheet could tell «she never
   * heard me» from «she is thinking». Asking first turns each of those into
   * the same sentence the local path already uses, before the visitor has
   * spoken to anything.
   *
   * The launcher starts the probe in the tap (`probeMic`, the way it starts
   * the free call's recogniser) and this adopts its answer; a redial from the
   * sheet is its own tap, so that one asks here. This file's comment said
   * «inside the tap» for a fortnight over a probe that ran from an effect
   * (14 October). The stream is released at once: this is a permission probe,
   * not a capture. Browsers remember the grant for the origin, so the
   * widget's own request afterwards does not prompt a second time. Anything
   * that is not a definite «no mic» (an API that is simply absent, an exotic
   * error) is left for the widget to deal with — this only speaks when it
   * KNOWS.
   */
  const checkMic = useCallback((probe: number, pending: Promise<MicProbeResult> | null) => {
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    const result =
      pending ??
      (md?.getUserMedia
        ? md.getUserMedia({ audio: true }).then(
            (stream): MicProbeResult => {
              stream.getTracks().forEach((t) => t.stop());
              return { ok: true };
            },
            (err: unknown): MicProbeResult => ({ ok: false, name: (err as { name?: string } | null)?.name ?? "" })
          )
        : null);
    if (!result) return;
    void result.then((r) => {
      if (r.ok) return;
      // A token, not `phaseRef`. The ref is only updated in an effect AFTER
      // React commits, and a microphone the visitor blocked earlier rejects
      // within milliseconds — before that effect has run, so the ref still
      // said «idle» and this returned without a word. That is the single
      // most common real case, and the first version of this handler
      // failed it silently (found by the mic-refused assertions in
      // shouq-agent). The token says exactly what is needed: is this still
      // the call that asked? Hanging up, the dial timeout and any other
      // teardown bump it, so a late rejection cannot resurrect a call the
      // visitor already ended.
      if (probe !== micProbe.current) return;
      const { name } = r;
      // Inside an app's own browser the refusal is the host app's, not a
      // switch the caller can find: the same sentence the free call uses,
      // with its «اكتب لسالم» way out (errorCopy). It read «allow the
      // microphone» here until 14 October.
      const text =
        name === "NotAllowedError" || name === "SecurityError"
          ? isInAppBrowser()
            ? WAIN_AI_COPY.speechOff
            : WAIN_AI_COPY.micDenied
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? WAIN_AI_COPY.noMic
            : name === "NotReadableError" || name === "AbortError"
              ? WAIN_AI_COPY.micBusy
              : null;
      if (!text) return;
      teardown();
      setErrorText(text);
      setPhase("error");
    });
  }, [teardown]);

  /* ---- placing the call --------------------------------------------------- */
  const startCall = useCallback(() => {
    // The launcher's decision, taken even when no call starts here, so it
    // cannot carry over to a later redial from this sheet.
    const asked = takeRequestedMode();
    const requestedWho = takeRequestedPersona();
    const probed = takeMicProbe();
    if (phase !== "idle" && phase !== "ended" && phase !== "error" && phase !== "answered") {
      // A second tap in the moment between this call adopting the tap's
      // recogniser and the launcher hearing «ringing» starts another, and it
      // used to stay listening — holding the microphone beside the live call
      // — until a later dial adopted it, dead. Nothing starts here, so nothing
      // the tap started may stay.
      takeLocalRecognition()?.rec.abort();
      return;
    }
    // The redial from the ended screen starts a call too, and an answer can
    // still be read out there. The launcher's tap stops it as well (see
    // ShouqCallButton); this covers the redial that does not come from a tap.
    stopVoice();
    haptic("tap");
    // Spend the gesture's audio permission now — see primeAudio(). By the time
    // شوق has an answer we are a navigation and a fetch away from here, and
    // iOS will not start audio then.
    primeAudio();
    setErrorText("");
    setTranscript("");
    setSeconds(0);
    setAgentFailed(false);
    setStarted(false);
    setReached(false);
    setEndedByWidget(false);
    connectedRef.current = false;
    // Or a fresh call opens announcing what the previous one did.
    setLastAction("");
    setLastSlug(null);
    setLastQuery(null);
    // Clearing the slot here means the mount effect below sees an empty one and
    // creates a genuinely fresh connection, with this call's agent, for every
    // dial. A redial from the sheet keeps the persona of the call it redials.
    const who = requestedWho ?? personaRef.current;
    personaRef.current = who;
    setPersona(who);
    slotRef.current?.replaceChildren();
    silenceRing();
    ringStartedAt.current = Date.now();
    stopRing.current = ringback();
    dialTimer.current = window.setTimeout(() => {
      dialTimer.current = null;
      if (phaseRef.current !== "ringing") return;
      teardown();
      // «Check the microphone» is the free call's advice: its ring is the
      // microphone prompt. An agent call that rang out is a widget that never
      // mounted, and the microphone was probed and fine before it rang — so
      // that one is told the line could not be reached (14 October).
      setErrorText(agentModeRef.current ? callCopy(personaRef.current).callFailed : WAIN_AI_COPY.noAnswer);
      setPhase("error");
    }, DIAL_TIMEOUT_MS);
    // A call from the launcher goes the way its tap went — the tap may already
    // have started the recogniser. A redial from this sheet decides here, and
    // a refusal it just showed wins over storage that may not have kept it.
    // Each persona has its own agent: with none for this one, the call is the
    // free call, never the other persona's agent.
    const agent = agentEnabledFor(who) && (asked ? asked === "agent" : !refusedRef.current && callAgentAvailable());
    refusedRef.current = false;
    // An agent call leaves no recogniser behind: one started by an earlier tap
    // would hold the microphone, and a later redial would adopt it, dead.
    if (agent) takeLocalRecognition()?.rec.abort();
    agentModeRef.current = agent;
    setAgentMode(agent);
    setPhase("ringing");
    if (!agent) startListening();
    else checkMic(++micProbe.current, probed);
  }, [phase, startListening, checkMic, silenceRing, teardown]);

  useEffect(() => () => teardown(), [teardown]);

  // Tell the launcher what the call is doing. It renders the pulsing handset
  // and شوق's moving mouth, and it lives in the static chunk, so this is the
  // only way it can know.
  useEffect(() => {
    onPhase(phase);
  }, [phase, onPhase]);

  /**
   * A call that fails should feel and sound like one.
   *
   * Hanging up deliberately buzzes and plays the tone that says the line is
   * down. Six different failures — the microphone refused, nobody spoke, the
   * widget never connected, the twenty-second dial timeout — did neither.
   * The ring-back just stopped and some text appeared. On a phone, silence
   * after ringing is the one outcome that means «keep waiting», so the
   * interface was saying the opposite of what had happened, in the moment the
   * visitor most needs telling.
   *
   * `error` was already in the haptic vocabulary and had never been called
   * from anywhere in the app.
   *
   * It lives here, on the transition, rather than at the six `setPhase`
   * sites — a seventh failure will be added one day, and it should not have
   * to remember this.
   */
  const wasErr = useRef(false);
  useEffect(() => {
    const isErr = phase === "error";
    if (isErr && !wasErr.current) {
      haptic("error");
      hangup();
    }
    wasErr.current = isErr;
  }, [phase]);

  /**
   * The tap that loaded this file is the tap that places the call.
   *
   * The launcher cannot call `startCall` itself — the whole point of the split
   * is that it does not have it — so it counts taps instead and this runs one
   * call per count. The first count arrives with the mount, which is the tap
   * that fetched the chunk; every later one is a call placed after a previous
   * one ended, with the component still mounted and the chunk already cached.
   */
  const startRef = useRef(startCall);
  startRef.current = startCall;
  useEffect(() => {
    if (startSignal > 0) startRef.current();
  }, [startSignal]);

  const open = phase !== "idle";
  // The bar after a free call's answer (see Phase): the page it sits over is
  // the point, so it must scroll, and nothing is taken away from it.
  const asBar = phase === "answered";

  /**
   * The dialog takes focus when it opens.
   *
   * Nothing moved focus before: the tap's button unmounts with /find a moment
   * later, so focus fell to the body under an `aria-modal` dialog, and a
   * screen reader was left reading the page the sheet had just covered
   * (14 October). The dialog itself is focused (`tabIndex=-1`), so what is
   * read first is its name — «مركز اتصال وين — شوق» — and the status after it.
   */
  useEffect(() => {
    if (!open || asBar) return;
    panelRef.current?.focus({ preventScroll: true });
  }, [open, asBar]);

  /**
   * The bar belongs to the page the answer landed on. A caller who taps a
   * result and leaves /search is done with the call; a bar that followed them
   * round the site would be a call nobody is on.
   */
  useEffect(() => {
    if (!asBar) return;
    const home = persona === "salem" ? "/salem" : "/search";
    if (!pathname.startsWith(home)) closeSheet();
  }, [asBar, pathname, persona, closeSheet]);

  /**
   * The page behind the call stays where it was.
   *
   * The sheet is `fixed inset-0` and scrolls only when its own content
   * overflows, which on a phone it mostly does not — and then a finger dragging
   * on it scrolled the DOCUMENT behind: `overscroll-contain` only holds a box
   * that has somewhere to scroll. On an iPhone that also slides Safari's
   * toolbar in and out, which resizes the viewport the sheet is pinned to, so
   * the call screen jumped under the finger; and a hang-up landed on a page
   * scrolled somewhere the visitor never went (8 October). Safari honours
   * `overflow: hidden` on the root element since 16, which is the one lock that
   * needs no position hack and leaves programmatic scrolling — her tools'
   * route changes — alone. The rule is in globals.css.
   */
  useEffect(() => {
    if (!open || asBar) return;
    const root = document.documentElement;
    root.setAttribute("data-call-open", "");
    return () => root.removeAttribute("data-call-open");
  }, [open, asBar]);

  // The page under the bar gets room for it at its foot (globals.css), or the
  // last result sits under the bar with no way to scroll past it.
  useEffect(() => {
    if (!asBar) return;
    const root = document.documentElement;
    root.setAttribute("data-call-bar", "");
    return () => root.removeAttribute("data-call-bar");
  }, [asBar]);

  // Where a caller carries on: the place she opened, and her last search with
  // سالم. On the error screen as well as the ended one — a refusal for credits
  // in the middle of a call used to drop both (review of 7 October), and
  // سالم, answering from the guide, is the way on that still works. His own
  // call ends wherever his tools drove the page, so it offers the way back to
  // his chat when that is not where the caller is.
  const carryOn = (
    <>
      {lastSlug && (
        <Link
          href={`/places/${lastSlug}/#share`}
          onClick={closeSheet}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-coral-700 px-5 text-sm font-semibold text-white transition hover:bg-coral-800"
        >
          <IconSend className="size-4" aria-hidden="true" />
          رسّلها للربع
        </Link>
      )}
      {lastQuery && persona === "shouq" && (
        <Link
          href={salemHandoff(lastQuery, "call")}
          onClick={closeSheet}
          className="inline-flex min-h-11 items-center rounded-xl bg-sea-600 px-5 text-sm font-semibold text-white transition hover:bg-sea-700"
        >
          {copy.toSalem}
        </Link>
      )}
      {persona === "salem" && !pathname.startsWith("/salem") && (
        <Link
          href="/salem"
          onClick={closeSheet}
          className="inline-flex min-h-11 items-center rounded-xl bg-sea-600 px-5 text-sm font-semibold text-white transition hover:bg-sea-700"
        >
          {WAIN_AI_COPY.backToSalem}
        </Link>
      )}
    </>
  );

  /**
   * The line under her name: what the call is doing right now.
   *
   * **The running clock is deliberately NOT in here**, and that is the whole
   * point of splitting it out. This string sits in an `aria-live` region, and
   * it used to read `متصل · ٠٠:٠٧` — so it changed every second and a screen
   * reader re-read the whole line every second, over whatever شوق was saying.
   * Measured on a built agent-mode export: **six distinct values in five
   * seconds**, which is a live region narrating a stopwatch rather than
   * reporting a call. The duration is rendered beside this, visible and in the
   * accessibility tree, and simply not announced.
   *
   * `ended` is the exception and keeps its duration: it fires once, it is
   * final, and how long the call lasted is the news rather than a tick. A call
   * the widget ended is the same news, so it lands here too (endedByWidget).
   */
  const status =
    phase === "ringing"
      ? WAIN_AI_COPY.ringing
      : phase === "live"
        ? agentMode && !started
          ? copy.readyToStart
          : agentMode && endedByWidget
            ? `${WAIN_AI_COPY.ended} · ${callDuration(seconds)}`
            : WAIN_AI_COPY.onCall
        : phase === "answering"
          ? copy.answering
          : phase === "ended"
            ? `${WAIN_AI_COPY.ended} · ${callDuration(seconds)}`
            : copy.role;

  // The launcher lives in the static chunk; this file is only the sheet.
  if (!open) return null;

  /**
   * After a free call's answer: a bar over the results, not the full sheet.
   *
   * The answer is on the page, spoken by the page; the one thing left to do
   * on the call is ask the next question, and that has to be a tap of its own
   * (WebKit starts recognition only inside a gesture). The bar is what a
   * phone's own call shrinks to when you go and look at something else. It is
   * not a launcher — no `aria-controls` — so the one-call-button rule on
   * /search (find.test) still counts zero there.
   */
  if (asBar) {
    return (
      <div
        id="wain-ai-bar"
        role="region"
        aria-label={`${WAIN_AI_COPY.centre} — ${copy.name}`}
        className="fixed inset-x-0 bottom-0 z-[60] border-t border-line bg-white px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 shadow-md standalone:bottom-[calc(4.25rem+env(safe-area-inset-bottom))] standalone:pb-2"
      >
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimiser */}
          <img
            src={persona === "salem" ? "/find/salem-face.jpg" : "/find/shouq-face.jpg"}
            alt=""
            aria-hidden="true"
            width={320}
            height={320}
            decoding="async"
            className="size-9 shrink-0 rounded-full object-cover ring-2 ring-white"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink-900">{copy.name}</span>
            <span aria-live="polite" className="block truncate text-xs text-ink-600">
              {lastAction || copy.answered}
            </span>
          </span>
          <button
            type="button"
            onClick={startCall}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-palm-600 px-3 text-sm font-semibold text-white transition hover:bg-palm-700 active:scale-95"
          >
            <IconCall className="size-4" aria-hidden="true" />
            {WAIN_AI_COPY.askAgain}
          </button>
          <button
            type="button"
            onClick={closeSheet}
            aria-label={WAIN_AI_COPY.close}
            className="grid size-11 shrink-0 place-items-center rounded-full text-ink-700 transition hover:bg-sand-100"
          >
            <IconClose className="size-5" />
          </button>
        </div>
      </div>
    );
  }

  return (
        <div
          id="wain-ai-panel"
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={`${WAIN_AI_COPY.centre} — ${copy.name}`}
          // Full screen on a tap, not a floating card any more — a call
          // takes over the whole screen the way a phone's own call screen
          // does. `inset-0` replaces the old `start-5` + capped width +
          // rounded corners: there is nothing beside it left to round
          // against. `overflow-y-auto` is the safety net for a short
          // viewport with the agent-mode conversation slot expanded; the
          // page underneath is fully covered either way, which is what
          // `tests/shouq-agent.test.mjs`'s "mostly behind it" note above
          // this component now reads as "entirely behind it".
          className="wain-ai-panel fixed inset-0 z-[60] flex flex-col overflow-y-auto overscroll-contain bg-white"
        >
          {/* Same reason as the launcher: the coral-500 end of this gradient
              cannot carry white body text at AA. pt- carries the safe-area
              inset itself now — full screen means this header IS the top
              edge, where the floating card used to sit clear of it. */}
          <header className="flex shrink-0 items-center gap-3 bg-gradient-to-l from-coral-800 to-coral-600 p-4 pt-[calc(1rem+env(safe-area-inset-top))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] text-white">
            <span className="min-w-0 flex-1">
              <span className="block font-display text-lg font-semibold leading-tight">
                {copy.name}
              </span>
              {/* The status is the one thing that changes without the visitor
                  touching anything, so it is the thing that gets announced —
                  and the ONLY one. The headline below used to carry
                  `aria-live` too and say «يرن…» at the same moment this did,
                  so one event was announced twice; what it shows the rest of
                  the time is the caller's own words read back to them, which
                  is not news to the person who just said them. */}
              {/* No icon before the status: it was a map pin, which said
                  «location» on a line that reports a call. */}
              <span className="flex items-center gap-1 text-xs text-coral-50">
                <span aria-live="polite">{status}</span>
                {/* Outside the live region on purpose — see `status`. Visible,
                    readable by navigating to it, never announced. `ended`
                    prints its own duration inside the announcement instead. */}
                {clockRunning && (
                  <span dir="ltr" className="tabular-nums">
                    · {callDuration(seconds)}
                  </span>
                )}
              </span>
            </span>
            <button
              type="button"
              onClick={closeSheet}
              aria-label={WAIN_AI_COPY.close}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-white/15 transition hover:bg-white/25"
            >
              <IconClose className="size-5" />
            </button>
          </header>

          {/* flex-1 + justify-center: the body fills whatever height the
              header didn't take, and centres its content in it rather than
              pinning it to the top of an otherwise-empty screen — the one
              layout change full-screen actually asked for beyond the
              container itself. pb- carries the bottom safe-area inset,
              since the hang-up button is now the last thing near the
              home-indicator strip rather than sitting inside a card with
              margin below it. */}
          {/* Three zones, top to bottom: who she is, the conversation (and the
              widget's own «بدء مكالمة», which lives in it), and the buttons.
              The body used to be one small centred cluster — a 56px face, the
              slot and the hang-up button stacked in the middle of a full
              white screen — so the Start button had nothing around it to
              say it was the thing to press, and the red hang-up sat right
              under it at the same size. The middle zone takes the spare
              height now and the buttons are pinned to the foot, where a
              thumb already is; `max-w-md` stops all of it stretching across
              a desktop window. */}
          <div className="flex flex-1 flex-col p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
           <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
            {(phase === "ringing" || phase === "live" || phase === "answering") && (
              <div className="flex flex-1 flex-col text-center">
                {/* Her photo, as on /find, with the drawn face as a small
                    badge: the badge is what moves its mouth while she
                    answers (`shouq--talking`), the photo is who she is.
                    The halo breathes in place (`animate-pulse`) instead of
                    `animate-ping`, which scaled it to 2× and laid it over
                    the headline under the face. */}
                <span className="relative mx-auto mt-4 grid size-24 shrink-0 place-items-center sm:size-28">
                  {phase !== "answering" && (
                    <span className="absolute -inset-2 animate-pulse rounded-full bg-coral-100 motion-reduce:animate-none" />
                  )}
                  {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimiser */}
                  <img
                    src={persona === "salem" ? "/find/salem-face.jpg" : "/find/shouq-face.jpg"}
                    alt=""
                    aria-hidden="true"
                    width={320}
                    height={320}
                    decoding="async"
                    className="relative size-24 rounded-full object-cover shadow-md ring-4 ring-white sm:size-28"
                  />
                  {/* Her drawn face is hers: his badge is a handset, sounding
                      while he answers. The glyph was drawn on his photo too
                      until 14 October. */}
                  <span className="absolute -bottom-1 -end-1 grid size-9 place-items-center rounded-full bg-coral-600 text-white ring-2 ring-white">
                    {persona === "salem" ? (
                      <IconCall className={`size-5 ${talking ? "call--live" : ""}`} />
                    ) : (
                      <IconShouq className={`size-5 shouq ${talking ? "shouq--talking" : ""}`} />
                    )}
                  </span>
                </span>

                {/* No `aria-live` — the header owns the announcement. */}
                <p className="mt-4 text-balance font-display text-xl font-semibold leading-snug text-ink-900">
                  {phase === "ringing"
                    ? copy.connectingLine
                    : phase === "answering"
                      ? copy.answering
                      : agentMode && !started
                        ? WAIN_AI_COPY.pressStart
                        : transcript ||
                          (agentMode ? copy.onTheLine : WAIN_AI_COPY.listening)}
                </p>
                {startHint && (
                  <p className="mt-2 text-sm font-semibold text-coral-800">{WAIN_AI_COPY.startNudge}</p>
                )}
                {/* Ringing is the one moment with nothing to hear and nothing
                    to do, so it carries what she is for; once she is on the
                    line, the short examples are enough. */}
                {phase === "ringing" && (
                  <p className="mt-1 text-xs leading-relaxed text-ink-500">
                    {copy.greeting}
                  </p>
                )}
                {phase === "live" && !transcript && (!agentMode || (started && !endedByWidget)) && (
                  <p className="mt-1 text-xs text-ink-500">{WAIN_AI_COPY.listeningExamples}</p>
                )}

                {/* Agent mode puts the conversation itself here. */}
                {/* Once she is on the line the slot takes the spare height
                    (`flex-1`) for the conversation. Before that it holds one
                    button, so it is centred in the free space (`my-auto`) and
                    carries a coral ring: «بدء مكالمة» is inside it and is the
                    one thing to press, so the box is what gets pointed at
                    rather than the page around it. */}
                {agentMode && (
                  <div
                    onClickCapture={() => setReached(true)}
                    className={`wain-ai-slot flex flex-col justify-center rounded-3xl bg-sand-100 p-3 ${
                      phase === "live" && !started && !reached
                        ? "my-auto h-44 ring-2 ring-coral-400"
                        : "mt-4 min-h-[19rem] flex-1"
                    }`}
                  >
                    {agentReady ? (
                      <div ref={slotRef} />
                    ) : (
                      <p className="py-4 text-center text-sm font-semibold text-ink-500">
                        {copy.loading}
                      </p>
                    )}
                  </div>
                )}

                {/* What she changed on the page under this sheet. Its own
                    live region rather than the header's: it is different news
                    from «the call is connected», and the two never fire at
                    the same moment — a tool only runs on a call that has
                    already announced itself live. */}
                {lastAction && (
                  <p
                    aria-live="polite"
                    className="mt-3 rounded-xl bg-sea-50 px-3 py-2 text-xs font-semibold leading-relaxed text-sea-800"
                  >
                    {lastAction}
                  </p>
                )}

                {/* The buttons, pinned to the foot (`mt-auto`) and full width,
                    one column: two 44px targets with a gap between them, not
                    two small pills side by side that can touch at 320px. There
                    is no voice switch here: each persona has its own agent. */}
                <div className="mt-auto flex flex-col gap-2 pt-4">
                  {/* One red button that hangs up, on every path, meaning
                      exactly one thing — round and labelled under, the way a
                      phone's own call screen draws it (2 October). It was a
                      full-width bar, and on a live call the ElevenLabs panel
                      sat over it; the label stays inside the button so the
                      whole thing is one target with one name. */}
                  <button
                    type="button"
                    onClick={endCall}
                    className="group mx-auto inline-flex flex-col items-center gap-1.5 rounded-2xl px-3 py-1 text-sm font-semibold text-coral-800"
                  >
                    <span className="grid size-16 place-items-center rounded-full bg-coral-700 text-white shadow-md transition group-hover:bg-coral-800 group-active:scale-95">
                      <IconPhone className="size-7 rotate-[135deg]" />
                    </span>
                    {WAIN_AI_COPY.hangUp}
                  </button>
                </div>
              </div>
            )}

            {phase === "ended" && (
              <div className="my-auto text-center">
                <p className="py-2 font-display text-lg font-semibold text-ink-900">
                  {WAIN_AI_COPY.ended}
                </p>
                <p className="text-sm text-ink-500" dir="ltr">
                  {callDuration(seconds)}
                </p>
                {/* What she last did to the page behind this sheet — the one
                    thing a caller who hangs up wants to find again. */}
                {lastAction && (
                  <p className="mx-auto mt-3 max-w-xs rounded-xl bg-sea-50 px-3 py-2 text-xs font-semibold leading-relaxed text-sea-800">
                    {lastAction}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {carryOn}
                  <button
                    type="button"
                    onClick={startCall}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white transition hover:bg-ink-800"
                  >
                    <IconPhone className="size-4" />
                    {WAIN_AI_COPY.callAgain}
                  </button>
                  <button
                    type="button"
                    onClick={closeSheet}
                    className="inline-flex min-h-11 items-center rounded-xl border border-line-control bg-white px-5 text-sm font-semibold text-ink-700 transition hover:border-sea-300"
                  >
                    {WAIN_AI_COPY.back}
                  </button>
                </div>
              </div>
            )}

            {phase === "error" && (
              <div className="my-auto text-center">
                <p className="py-2 text-sm font-semibold text-ink-600" role="alert">
                  {errorText}
                </p>
                {/* When the browser cannot listen at all, another call fails the
                    same way. Typing to سالم answers the same question. */}
                {(errorText === WAIN_AI_COPY.speechOff || errorText === SPEECH_OFF_APPLE) && (
                  <Link
                    href="/salem"
                    onClick={closeSheet}
                    className="mb-2 inline-flex min-h-11 items-center rounded-xl bg-sea-600 px-5 text-sm font-semibold text-white transition hover:bg-sea-700"
                  >
                    {WAIN_AI_COPY.typeToSalem}
                  </Link>
                )}
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {carryOn}
                  <button
                    type="button"
                    onClick={startCall}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white transition hover:bg-ink-800"
                  >
                    <IconPhone className="size-4" />
                    {WAIN_AI_COPY.callAgain}
                  </button>
                  <button
                    type="button"
                    onClick={closeSheet}
                    className="inline-flex min-h-11 items-center rounded-xl border border-line-control bg-white px-5 text-sm font-semibold text-ink-700 transition hover:border-sea-300"
                  >
                    {WAIN_AI_COPY.back}
                  </button>
                </div>
              </div>
            )}

            <p className="mt-3 text-center text-2xs leading-relaxed text-ink-500">
              {copy.micNote}{" "}
              <Link href="/privacy" className="underline hover:text-coral-700">
                الخصوصية
              </Link>
            </p>
           </div>
          </div>
        </div>
  );
}
