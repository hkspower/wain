"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { onCallRequest, publishPhase } from "@/lib/wain-ai-bus";
import type { Phase } from "@/components/WainAiCall";

/**
 * شوق's call, mounted above the router and started from somewhere else.
 *
 * This used to be the button as well, floating over the corner of every page.
 * The button is in the search box now (`ShouqCallButton`), where the question
 * is actually being asked and where the page already had a microphone.
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

export default function WainAi() {
  /**
   * Taps, not a boolean.
   *
   * The first request mounts the call; every later one has to place a *new*
   * call through a component that is already mounted, and `true` a second time
   * is not an event. A counter is.
   */
  const [starts, setStarts] = useState(0);

  useEffect(() => onCallRequest(() => setStarts((n) => n + 1)), []);

  // Straight back out to the button, which renders the pulse, the moving mouth
  // and aria-expanded from it without knowing how a call works.
  const onPhase = useCallback((phase: Phase) => publishPhase(phase), []);

  return starts > 0 ? <WainAiCall startSignal={starts} onPhase={onPhase} /> : null;
}
