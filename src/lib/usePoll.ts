"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Ask again, but only when asking is worth anything.
 *
 * A `setInterval` around a fetch is the easy version and it is wrong in four
 * separate ways, all of which «طلباتي» had:
 *
 *   - It keeps polling a tab nobody is looking at. A phone in a pocket spent
 *     the afternoon waking the radio every 45 seconds to re-read an order that
 *     had already been collected.
 *   - It keeps polling after the answer can no longer change.
 *   - It does *not* poll at the one moment the answer is wanted — coming back
 *     to the tab to check whether the order is ready shows up to 45 seconds of
 *     stale data before the next tick.
 *   - It keeps hammering a network that is plainly down, at full rate.
 *
 * So: the timer only runs while the document is visible, a refresh fires the
 * instant the tab is looked at again or the connection returns, the caller can
 * declare the answer final and stop the whole thing, and repeated failures
 * back off instead of drumming.
 *
 * Overlap is impossible by construction: one request may be in flight, and a
 * new one aborts it rather than racing it, so an older answer can never
 * overwrite a newer one.
 */

export interface PollOptions<T> {
  /** Normal gap between polls, in ms. */
  intervalMs: number;
  /** Returns true when the answer is final and polling should stop for good. */
  isFinal?: (value: T) => boolean;
  /** Skip the network entirely — e.g. nothing is configured to talk to. */
  enabled?: boolean;
  /**
   * Stop polling while the tab is not being looked at. True for anything whose
   * only purpose is to be read, since nobody is reading it.
   *
   * False for the order queue, and the difference matters: a shop leaves the
   * queue open in a background tab all day, and that is precisely when a new
   * order must still be noticed. Pausing there would mean the alert only ever
   * arrived once somebody had already looked.
   */
  pauseWhenHidden?: boolean;
}

export interface PollState<T> {
  value: T | undefined;
  /** True once a first attempt has completed, however it went. */
  settled: boolean;
  /** Consecutive failures. Zero after any success. */
  failures: number;
  /** Ask now, out of band. Safe to call from an event handler. */
  refresh: () => void;
}

const MAX_BACKOFF_MULTIPLE = 8;

export function usePoll<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  { intervalMs, isFinal, enabled = true, pauseWhenHidden = true }: PollOptions<T>
): PollState<T> {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [settled, setSettled] = useState(false);
  const [failures, setFailures] = useState(0);

  // The fetcher is usually an inline arrow, so a new identity every render.
  // Kept in a ref so it never restarts the timer; the effect below depends
  // only on things that really should restart it.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const isFinalRef = useRef(isFinal);
  isFinalRef.current = isFinal;

  const doneRef = useRef(false);
  const inFlight = useRef<AbortController | null>(null);
  const failuresRef = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const run = useCallback(async () => {
    if (doneRef.current || !enabled) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const next = await fetcherRef.current(controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      failuresRef.current = 0;
      setFailures(0);
      setValue(next);
      if (isFinalRef.current?.(next)) doneRef.current = true;
    } catch {
      if (controller.signal.aborted || !mounted.current) return;
      failuresRef.current += 1;
      setFailures(failuresRef.current);
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      if (mounted.current && !controller.signal.aborted) setSettled(true);
    }
  }, [enabled]);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) {
      setSettled(true);
      return;
    }

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      if (doneRef.current) return;
      // Doubling per consecutive failure, capped: a network that is down stops
      // being asked every few seconds, but comes back to full rate the moment
      // one request succeeds.
      const multiple = Math.min(MAX_BACKOFF_MULTIPLE, 2 ** failuresRef.current);
      timer.current = setTimeout(tick, intervalMs * multiple);
    };

    const hidden = () =>
      pauseWhenHidden && typeof document !== "undefined" && document.hidden;

    const tick = async () => {
      // Nothing is gained by polling a tab nobody can see; the visibility
      // listener below catches up the moment it is looked at again.
      if (hidden()) return schedule();
      await run();
      schedule();
    };

    void tick();

    const onWake = () => {
      if (doneRef.current || hidden()) return;
      void tick();
    };

    document.addEventListener("visibilitychange", onWake);
    addEventListener("online", onWake);
    addEventListener("focus", onWake);

    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      inFlight.current?.abort();
      document.removeEventListener("visibilitychange", onWake);
      removeEventListener("online", onWake);
      removeEventListener("focus", onWake);
    };
  }, [enabled, intervalMs, pauseWhenHidden, run]);

  const refresh = useCallback(() => {
    void run();
  }, [run]);

  return { value, settled, failures, refresh };
}
