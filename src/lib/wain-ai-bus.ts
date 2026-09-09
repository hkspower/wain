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
