import {
  WAIN_AI_AGENT_ENABLED,
  WAIN_AI_API_ORIGIN,
  WAIN_AI_WIDGET_ORIGIN,
  WAIN_AI_WIDGET_SRC,
} from "@/lib/wain-ai";
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

/** Ask for a call. Do the gesture work (haptic, primeAudio) before this. */
export function requestCall(): void {
  window.dispatchEvent(new Event(CALL));
}

/** Returns an unsubscribe, so it can be an effect body. */
export function onCallRequest(fn: () => void): () => void {
  window.addEventListener(CALL, fn);
  return () => window.removeEventListener(CALL, fn);
}

export function publishPhase(phase: Phase): void {
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
 * DNS and TLS to both origins, on the first sign of interest — a hover, a
 * focus, a finger landing. Two sockets, opened only for somebody who has
 * already reached for the button, and free to anyone who never does.
 */
export function warmCall(): void {
  if (warmed || !WAIN_AI_AGENT_ENABLED || typeof document === "undefined") return;
  warmed = true;
  // See the notes in wain-ai.ts: the CDN is reached by a plain <script>, which
  // is a no-CORS request, and a preconnect carrying `crossorigin` would warm a
  // pool entry it cannot use. The API's fetches are CORS, so that one does.
  for (const [href, cors] of [
    [WAIN_AI_WIDGET_ORIGIN, false],
    [WAIN_AI_API_ORIGIN, true],
  ] as const) {
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = href;
    if (cors) link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }
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
  warmCall();
  void loadWidget().catch(() => {
    /* The dial will retry and report it honestly. Nothing to say here. */
  });
}
