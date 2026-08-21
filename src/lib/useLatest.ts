"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Only the newest answer counts.
 *
 * The admin screens reload a list after every action — approve, reject, mark
 * ready — and each reload is a fresh request racing whatever is still in
 * flight. Two requests, two answers, and no rule about which arrives first:
 * mark an order ready, and the list reloaded a moment earlier can land
 * afterwards and paint the order as new again. Nothing is broken in the
 * database; the screen is simply showing an older truth than the one it
 * already had. Then the admin clicks it again.
 *
 * This wraps an async function so that every call abandons the one before it:
 * the previous request is aborted, and any answer from a superseded call is
 * dropped rather than applied. Unmounting abandons everything, which also
 * removes the "setState on an unmounted component" class of bug in the same
 * stroke.
 */
export function useLatestRequest(): {
  run: <T>(fn: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void) => Promise<void>;
  abort: () => void;
} {
  const seq = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  const abort = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    // Bump the sequence too: an in-flight call that has already resolved but
    // not yet run its `apply` must still be discarded.
    seq.current += 1;
  }, []);

  const run = useCallback(
    async <T,>(fn: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void) => {
      controller.current?.abort();
      const mine = ++seq.current;
      const ac = new AbortController();
      controller.current = ac;
      try {
        const value = await fn(ac.signal);
        if (mine !== seq.current || !mounted.current || ac.signal.aborted) return;
        apply(value);
      } catch {
        // A superseded or unmounted request has no one to report to. A real
        // failure is the caller's to surface from inside `fn`, where it knows
        // what sentence to show.
      } finally {
        if (controller.current === ac) controller.current = null;
      }
    },
    []
  );

  return { run, abort };
}
