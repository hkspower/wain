import {
  WAIN_AI_AGENT_ENABLED,
  WAIN_AI_API_ORIGIN,
  WAIN_AI_WIDGET_SRC,
} from "@/lib/wain-ai";
import { WAIN_AI_WIDGET_INTEGRITY } from "@/lib/widget-src.g";
import { getRecognition, speechLang, type SpeechRecognitionLike } from "@/lib/speech";
import { agentAvailable } from "@/lib/agent-health";
import type { Phase } from "@/components/WainAiCall";

/**
 * Two window events between the button that starts a call and the call itself,
 * because the two cannot be in the same React tree.
 *
 * The button belongs in the search box — it is the page's one voice control,
 * sitting where the visitor is already looking. The call cannot live there:
 * `open_place` is a route change, the `<elevenlabs-convai>` element is created
 * imperatively inside `WainAiCall`, and a call the search page owned would be
 * torn down by its own tool mid-sentence. So the call stays in the root layout
 * and the two talk across the gap.
 *
 * A window event rather than a context provider or a store: this is one
 * request and one status, between exactly two components, and wrapping the
 * whole app in a provider to carry them would put a client boundary around
 * every server-rendered page for a feature that is one button.
 *
 * `phase` travels back because the button has to be honest about what it
 * started — the pulse while ringing, the moving mouth while she talks, and
 * `aria-expanded` on a dialog it does not render. Without the return trip it
 * would be a button that claims nothing and reports nothing.
 */

const CALL = "wain-ai:call";
const PHASE = "wain-ai:phase";

let requestedAt = 0;
let lastPhase: Phase = "idle";

/** Ask for a call. Do the gesture work (haptic, primeAudio) before this. */
export function requestCall(): void {
  requestedAt = Date.now();
  window.dispatchEvent(new Event(CALL));
}

/**
 * Whether a call is on screen, or was asked for a moment ago and is still
 * loading. /search uses it to keep its box from grabbing focus under the call
 * sheet: the tap on /find pushes /search at once, and on Android the keyboard
 * that focus opens covered the hang-up button.
 */
export function callActive(): boolean {
  if (lastPhase !== "idle" && lastPhase !== "ended" && lastPhase !== "error") return true;
  return Date.now() - requestedAt < 3000;
}

/* ── listening, started inside the tap ────────────────────────────────────────
 *
 * The call is a lazy component in another tree, so it used to start the
 * recogniser after a window event, a chunk load and an effect — outside the
 * tap. WebKit wants `start()` inside the gesture and answers `not-allowed`
 * otherwise, which the call read as a blocked microphone (3 October: «ما وصلنا
 * صوتك» on iPhones with the microphone allowed). So in free mode the button
 * starts the engine synchronously, here, and the call adopts it.
 *
 * The engine can report before the call has attached — `start` in a few
 * milliseconds, an error at once — so every event is buffered and replayed in
 * order when it does.
 */
type RecEvent =
  | { kind: "start" }
  | { kind: "result"; e: Parameters<NonNullable<SpeechRecognitionLike["onresult"]>>[0] }
  | { kind: "error"; e: { error: string } }
  | { kind: "end" };

export interface RecHandlers {
  onstart: () => void;
  onresult: NonNullable<SpeechRecognitionLike["onresult"]>;
  onerror: NonNullable<SpeechRecognitionLike["onerror"]>;
  onend: () => void;
}

export interface PendingRecognition {
  rec: SpeechRecognitionLike;
  /** `start()` threw — nothing will ever arrive. */
  failed: boolean;
  attach(h: RecHandlers): void;
}

let pending: PendingRecognition | null = null;

/** Start listening now, inside the tap. Returns false where nothing can listen. */
export function startLocalRecognition(): boolean {
  pending?.rec.abort();
  pending = null;
  const rec = getRecognition();
  if (!rec) return false;
  rec.lang = speechLang();
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  const queue: RecEvent[] = [];
  let live: RecHandlers | null = null;
  const deliver = (ev: RecEvent) => {
    if (!live) return void queue.push(ev);
    if (ev.kind === "start") live.onstart();
    else if (ev.kind === "result") live.onresult(ev.e);
    else if (ev.kind === "error") live.onerror(ev.e);
    else live.onend();
  };
  rec.onstart = () => deliver({ kind: "start" });
  rec.onresult = (e) => deliver({ kind: "result", e });
  rec.onerror = (e) => deliver({ kind: "error", e });
  rec.onend = () => deliver({ kind: "end" });
  const handle: PendingRecognition = {
    rec,
    failed: false,
    attach(h) {
      live = h;
      for (const ev of queue.splice(0)) deliver(ev);
    },
  };
  try {
    rec.start();
  } catch {
    handle.failed = true;
  }
  pending = handle;
  return true;
}

/** The engine the tap started, once. Null when there is none. */
export function takeLocalRecognition(): PendingRecognition | null {
  const p = pending;
  pending = null;
  return p;
}

/** Returns an unsubscribe, so it can be an effect body. */
export function onCallRequest(fn: () => void): () => void {
  window.addEventListener(CALL, fn);
  return () => window.removeEventListener(CALL, fn);
}

export function publishPhase(phase: Phase): void {
  lastPhase = phase;
  window.dispatchEvent(new CustomEvent<Phase>(PHASE, { detail: phase }));
}

export function onPhase(fn: (phase: Phase) => void): () => void {
  const handler = (event: Event) => fn((event as CustomEvent<Phase>).detail);
  window.addEventListener(PHASE, handler);
  return () => window.removeEventListener(PHASE, handler);
}

/* ── getting the widget there before the tap does ─────────────────────────────
 *
 * Also here, and for the same reason as the events: the button and the call are
 * in different trees, and the work that has to start EARLY belongs to the
 * button while the work that has to be honest about it belongs to the call.
 * Both need one answer to «is the widget loaded», so it is owned once.
 *
 * The chain used to be strictly serial and to start at the tap: fetch the
 * WainAiCall chunk, mount it, only then create the <script>, cold DNS + TLS to
 * the CDN, 451KB of widget, and only then a cold DNS + TLS to ElevenLabs before
 * a session can open. The visitor hears ring-back through all of it.
 */

let warmed = false;

/**
 * DNS and TLS to the voice service, on the first sign of interest — a hover,
 * a focus, a finger landing. A socket opened only for somebody who has
 * already reached for the button, and free to anyone who never does.
 */
export function warmCall(): void {
  // Nothing to warm for a device the agent refused lately (lib/agent-health.ts):
  // its next call is the free one.
  if (warmed || typeof document === "undefined" || !agentAvailable()) return;
  warmed = true;
  // The widget itself is on this origin now (vendor-widget.mjs), so only the
  // API is left to warm. Its fetches are CORS, hence `crossorigin`.
  const link = document.createElement("link");
  link.rel = "preconnect";
  link.href = WAIN_AI_API_ORIGIN;
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}

let widgetLoad: Promise<void> | null = null;

/**
 * Load the widget bundle, once, and tell the truth about when it is there.
 *
 * The call component used to inject this script itself and treat «a tag with
 * this src exists» as «loaded», which was fine while it was the only injector.
 * It is not any more — the button starts the fetch on pointerdown — and that
 * shortcut would have made the call announce «متصل» over a bundle still on the
 * wire. A promise cannot be wrong about it.
 *
 * A rejection is deliberately NOT remembered: the network can be back by the
 * next tap, and the previous code retried on every dial.
 */
export function loadWidget(): Promise<void> {
  if (!widgetLoad) {
    widgetLoad = new Promise<void>((resolve, reject) => {
      if (!WAIN_AI_AGENT_ENABLED) {
        reject(new Error("agent mode is off"));
        return;
      }
      if (document.querySelector('script[data-wain-widget="loaded"]')) {
        resolve();
        return;
      }
      /**
       * Anything left from a failed attempt is dead and must go.
       *
       * A <script> fires `error` ONCE. An earlier version adopted a tag that
       * was already in the document and attached listeners to it, which is
       * correct for one still in flight and a trap for one that has already
       * failed: the listeners never fire and the promise never settles.
       *
       * Measured, because the sandbox blocks this CDN and so exercises the
       * failure path for real — the call sat on «يرن…» for the full
       * twenty-second dial timeout and then said «طوّلنا نرن», when the fetch
       * had failed at 926ms and should have said so.
       */
      document.querySelectorAll("script[data-wain-widget]").forEach((el) => el.remove());
      const script = document.createElement("script");
      script.dataset.wainWidget = "loading";
      script.src = WAIN_AI_WIDGET_SRC;
      // A changed file on the server is refused, not run. Same origin, so no
      // `crossorigin` is needed for the check to apply.
      script.integrity = WAIN_AI_WIDGET_INTEGRITY;
      script.async = true;
      script.addEventListener("load", () => {
        script.dataset.wainWidget = "loaded";
        resolve();
      });
      script.addEventListener("error", () => {
        script.remove();
        reject(new Error("widget script failed"));
      });
      document.head.appendChild(script);
    });
    widgetLoad.catch(() => {
      widgetLoad = null;
    });
  }
  return widgetLoad;
}

/**
 * Start the bundle on a finger that is already down.
 *
 * pointerdown lands 100–300ms before the click it becomes, and that is most of
 * a cold connection. Separate from `warmCall` on purpose: a hover should not
 * pull 451KB for somebody who was on their way past.
 */
export function armCall(): void {
  if (!agentAvailable()) return;
  warmCall();
  void loadWidget().catch(() => {
    /* The dial will retry and report it honestly. Nothing to say here. */
  });
}
