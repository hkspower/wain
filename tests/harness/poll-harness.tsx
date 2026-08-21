/**
 * usePoll, rendered for real.
 *
 * The hook's whole value is in when it does *not* ask — a hidden tab, an
 * answer that can no longer change, a network that keeps refusing — and none
 * of that can be checked by reading it. So it is mounted here with a fetcher
 * that counts calls and a control surface on `window`, and the test drives the
 * page the way a phone would: hide it, show it, take the network away.
 */
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { usePoll } from "@/lib/usePoll";

interface Reply {
  n: number;
  final: boolean;
}

declare global {
  interface Window {
    poll: {
      /** How many times the fetcher has been entered. */
      calls: number;
      /** How many were in flight at once, at the highest. */
      peakConcurrent: number;
      /** Make the next replies fail. */
      failNext: number;
      /** Make the next reply final. */
      finishNext: boolean;
      /** What the component is showing. */
      value: () => Reply | undefined;
      settled: () => boolean;
      failures: () => number;
      reset: () => void;
    };
  }
}

const state = {
  calls: 0,
  peakConcurrent: 0,
  failNext: 0,
  finishNext: false,
  live: 0,
  value: undefined as Reply | undefined,
  settled: false,
  failures: 0,
};

window.poll = {
  get calls() {
    return state.calls;
  },
  set calls(v: number) {
    state.calls = v;
  },
  get peakConcurrent() {
    return state.peakConcurrent;
  },
  set peakConcurrent(v: number) {
    state.peakConcurrent = v;
  },
  get failNext() {
    return state.failNext;
  },
  set failNext(v: number) {
    state.failNext = v;
  },
  get finishNext() {
    return state.finishNext;
  },
  set finishNext(v: boolean) {
    state.finishNext = v;
  },
  value: () => state.value,
  settled: () => state.settled,
  failures: () => state.failures,
  reset: () => {
    state.calls = 0;
    state.peakConcurrent = 0;
    state.failNext = 0;
    state.finishNext = false;
  },
};

/** Resolves after a beat, so "in flight" is a real window the test can catch
 *  two requests overlapping inside, if the hook ever let them. */
function reply(signal: AbortSignal): Promise<Reply> {
  state.calls += 1;
  state.live += 1;
  state.peakConcurrent = Math.max(state.peakConcurrent, state.live);
  const shouldFail = state.failNext > 0;
  if (shouldFail) state.failNext -= 1;
  const final = state.finishNext;

  return new Promise<Reply>((resolve, reject) => {
    const t = setTimeout(() => {
      state.live -= 1;
      if (shouldFail) reject(new Error("wain/network"));
      else resolve({ n: state.calls, final });
    }, 30);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        state.live -= 1;
        reject(new Error("aborted"));
      },
      { once: true }
    );
  });
}

function Probe() {
  const [interval] = useState(200);
  const { value, settled, failures } = usePoll<Reply>(reply, {
    intervalMs: interval,
    isFinal: (v) => v.final,
  });
  state.value = value;
  state.settled = settled;
  state.failures = failures;
  return (
    <output id="probe">
      {value ? value.n : "-"}/{failures}/{settled ? "settled" : "waiting"}
    </output>
  );
}

createRoot(document.getElementById("root")!).render(<Probe />);
