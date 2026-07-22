import { useEffect, useRef } from "react";

// Calls onIdle() after `timeoutMs` of no user activity (default 15 min).
// Also fires when the tab/app is re-shown past the timeout.
export function useIdleLock(onIdle: () => void, timeoutMs = 15 * 60 * 1000) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActive = useRef<number>(Date.now());

  useEffect(() => {
    const bump = () => {
      lastActive.current = Date.now();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(onIdle, timeoutMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (Date.now() - lastActive.current >= timeoutMs) onIdle();
        else bump();
      }
    };

    const events = ["mousedown", "keydown", "touchstart", "scroll", "pointerdown"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    document.addEventListener("visibilitychange", onVisibility);
    bump();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, bump));
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [onIdle, timeoutMs]);
}
