"use client";

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { onCallRequest, publishPhase } from "@/lib/wain-ai-bus";
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
 */
const WainAiCall = dynamic(() => import("@/components/WainAiCall"), {
  ssr: false,
});

/**
 * The one place a failure of the call's own code is caught.
 *
 * This component sits OUTSIDE `<main>` in the root layout, so the route's
 * `error.tsx` — which wraps the page's children — never sees it. A chunk that
 * failed to load on a weak line, or a throw inside the sheet, used to replace
 * the WHOLE tree with Next's bare «Application error»: the page the caller was
 * on, the tab bar and the way out, gone for one call that could not start
 * (14 October). Caught here, the site stays as it was; the caller is told in
 * one line, and the next tap tries again — `retryOn` is the tap counter, and a
 * new value clears the failure so the chunk is asked for once more.
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

  useEffect(() => onCallRequest(() => setStarts((n) => n + 1)), []);

  // Straight back out to the button, which renders the pulse, the moving mouth
  // and aria-expanded from it without knowing how a call works.
  const onPhase = useCallback((phase: Phase) => publishPhase(phase), []);

  const onFail = useCallback(() => {
    // The launcher is told the call is over, so its pulse stops.
    publishPhase("idle");
    setFailedStart(startsRef.current);
  }, []);

  if (starts === 0) return null;
  return (
    <>
      <CallBoundary retryOn={starts} onFail={onFail}>
        <WainAiCall startSignal={starts} onPhase={onPhase} />
      </CallBoundary>
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
