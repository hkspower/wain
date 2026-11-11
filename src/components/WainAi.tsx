"use client";

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  onCallRequest,
  publishPhase,
  takeLocalRecognition,
  takeMicProbe,
  takeRequestedMode,
  takeRequestedPersona,
} from "@/lib/wain-ai-bus";
import { WAIN_AI_COPY } from "@/lib/wain-ai";
import type { Phase } from "@/components/WainAiCall";

/**
 * The call, mounted above the router and started from somewhere else.
 *
 * This used to be the button as well, floating over the corner of every page.
 * The button moved into the /search box, then — 1 October, asked for one way
 * to call her — to /find alone, and since 7 October سالم's header carries his
 * (`ShouqCallButton`, `FindChoice.tsx`, `SalemChat.tsx`).
 *
 * What stays here is only what has to outlive a route change. `open_place` is
 * a route change, and the `<elevenlabs-convai>` element is created
 * imperatively inside `WainAiCall` — so a call owned by the search page would
 * be torn down by its own tool: she opens the place, says «فتحت لك صفحته، تبي
 * شي ثاني؟», and the line is already dead.
 *
 * It renders nothing until somebody calls. Before the first request this is an
 * empty component in the layout, and `WainAiCall` — the ring-back tones, the
 * speech-recognition plumbing, the widget bridge, six phases of sheet markup,
 * 6.3K gzipped — is a chunk that has not been fetched.
 *
 * The chunk is asked for with a plain `import()` and the component kept in
 * state — not React.lazy, and not `next/dynamic`, which is one React.lazy
 * underneath. Two faults, both measured in one document on 10 November:
 *
 * - React.lazy keeps a load that rejected and throws it again on every later
 *   render without asking for the chunk a second time, so one failed fetch on
 *   a weak line left the call dead until a reload: every tap showed the
 *   failure line again while the chunk itself, fetched again by the button's
 *   preload, arrived fine.
 * - A rejected lazy is an error thrown in render, and on /find the tap that
 *   asks for the call also pushes /search. Caught by the boundary below while
 *   that navigation was still in flight, it left Next's router broken: the
 *   push never arrived, and the NEXT navigation — an ordinary link, or the
 *   retry itself — threw «Rendered more hooks than during the previous
 *   render» inside the router and replaced the whole site with «Application
 *   error». So «does not take the site down» held only until the next tap.
 *   From /salem, whose button does not navigate, the same failure was
 *   harmless, which is what placed it.
 *
 * A failed `import()` is a rejected promise and nothing more: no render
 * throws, the failure is said in one line, and the next tap asks again —
 * webpack forgets a chunk that failed, so the second `import()` is a second
 * fetch.
 */
type CallComponent = typeof import("@/components/WainAiCall").default;

/**
 * The one place a throw inside the call sheet is caught.
 *
 * This component sits OUTSIDE `<main>` in the root layout, so the route's
 * `error.tsx` — which wraps the page's children — never sees it. A throw
 * inside the sheet used to replace the WHOLE tree with Next's bare
 * «Application error»: the page the caller was on, the tab bar and the way
 * out, gone for one call that could not start (14 October). Caught here, the
 * site stays as it was; the caller is told in one line, and the next tap
 * mounts the sheet afresh — `retryOn` is the tap counter, and a new value
 * clears the failure.
 *
 * A chunk that fails to load does not come through here any more (see the
 * loader in WainAi). Not measured: whether a throw caught here while a
 * navigation is in flight breaks the router the way the rejected chunk did.
 */
class CallBoundary extends Component<
  { children: ReactNode; retryOn: number; onFail: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFail();
  }

  componentDidUpdate(prev: { retryOn: number }) {
    if (this.state.failed && prev.retryOn !== this.props.retryOn) this.setState({ failed: false });
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function WainAi() {
  /**
   * Taps, not a boolean.
   *
   * The first request mounts the call; every later one has to place a *new*
   * call through a component that is already mounted, and `true` a second time
   * is not an event. A counter is.
   */
  const [starts, setStarts] = useState(0);
  const startsRef = useRef(0);
  startsRef.current = starts;
  // The tap whose call failed to load, for the alert: it shows until a later
  // tap comes, which is the retry.
  const [failedStart, setFailedStart] = useState(0);
  // The call's component, once its chunk has arrived. Kept for the life of
  // the page: the call is built never to unmount (WainAiCall's startSignal),
  // and a fresh one on every tap would forget the persona a redial keeps.
  const [Call, setCall] = useState<CallComponent | null>(null);
  // One fetch at a time, and none once it has arrived.
  const loadRef = useRef<"none" | "loading" | "loaded">("none");

  // Straight back out to the button, which renders the pulse, the moving mouth
  // and aria-expanded from it without knowing how a call works.
  const onPhase = useCallback((phase: Phase) => publishPhase(phase), []);

  const onFail = useCallback(() => {
    // The launcher is told the call is over, so its pulse stops.
    publishPhase("idle");
    setFailedStart(startsRef.current);
    // What the tap prepared for a call that never started is let go. The
    // recogniser it started inside the gesture went on listening behind the
    // «ما قدرنا نشغّل المكالمة» line — nothing but the call, which never
    // loaded, or the next tap ever stopped it (measured: started, never
    // aborted). After a throw inside a call that had already taken them, these
    // are all empty and this does nothing.
    takeLocalRecognition()?.rec.abort();
    takeMicProbe();
    takeRequestedMode();
    takeRequestedPersona();
  }, []);

  const load = useCallback(() => {
    if (loadRef.current !== "none") return;
    loadRef.current = "loading";
    import("@/components/WainAiCall").then(
      (m) => {
        loadRef.current = "loaded";
        // Through the updater: a component is a function, and a function
        // handed to setState is called as an updater rather than stored.
        setCall(() => m.default);
      },
      () => {
        // Back to «none», so the next tap asks for the chunk again.
        loadRef.current = "none";
        onFail();
      },
    );
  }, [onFail]);

  // Asked for in the tap itself, not in an effect a render later: the button
  // has usually started the same fetch on the way to the tap, and this joins
  // it.
  useEffect(
    () =>
      onCallRequest(() => {
        setStarts((n) => n + 1);
        load();
      }),
    [load],
  );

  if (starts === 0) return null;
  return (
    <>
      {Call && (
        <CallBoundary retryOn={starts} onFail={onFail}>
          <Call startSignal={starts} onPhase={onPhase} />
        </CallBoundary>
      )}
      {failedStart > 0 && failedStart === starts && (
        <p
          role="alert"
          data-call-failed=""
          className="fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[60] rounded-2xl border border-coral-200 bg-white px-4 py-3 text-center text-sm font-semibold text-ink-800 shadow-xs standalone:bottom-[calc(5.25rem+env(safe-area-inset-bottom))]"
        >
          {WAIN_AI_COPY.failed}
        </p>
      )}
    </>
  );
}
