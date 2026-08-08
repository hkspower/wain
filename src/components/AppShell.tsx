"use client";

import { useEffect } from "react";

/**
 * Two things that make the installed app behave like an app rather than a
 * page in a frame.
 *
 * 1. Registers the service worker, so وين opens and works with no connection.
 *    Without it, launching the app offline shows the browser's error page —
 *    which breaks the illusion completely.
 *
 * 2. Marks standalone launches on <html>. The compact app theme keys off
 *    `display-mode: standalone`, but iOS reports a home-screen launch through
 *    the non-standard `navigator.standalone` and older versions never match
 *    that media query — so an iPhone could get the website layout inside the
 *    app frame. The data attribute is a second signal the CSS also accepts.
 */
export default function AppShell() {
  useEffect(() => {
    const root = document.documentElement;

    const nav = navigator as Navigator & { standalone?: boolean };
    const mq = window.matchMedia("(display-mode: standalone)");
    const sync = () => {
      const app = mq.matches || nav.standalone === true;
      root.dataset.standalone = app ? "true" : "false";
    };
    sync();
    mq.addEventListener("change", sync);

    if ("serviceWorker" in navigator) {
      // Wait for load so registration never competes with first paint.
      const register = () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {
          // No offline support this visit; the site still works online.
        });
      };
      if (document.readyState === "complete") register();
      else window.addEventListener("load", register, { once: true });
    }

    return () => mq.removeEventListener("change", sync);
  }, []);

  return null;
}
