"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconPinSolid } from "@/components/icons";
import {
  FAHAD_AGENT_ID,
  FAHAD_COPY,
  FAHAD_ENABLED,
  FAHAD_WIDGET_SRC,
} from "@/lib/fahad";

/** Voice-wave mark used as فهد's avatar. */
function FahadMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 11v2" opacity=".55" />
      <path d="M8 8v8" opacity=".8" />
      <path d="M12 5v14" />
      <path d="M16 8v8" opacity=".8" />
      <path d="M20 11v2" opacity=".55" />
    </svg>
  );
}

export default function FahadLauncher() {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);

  // Load the widget bundle only once the visitor actually asks for فهد, so
  // the CDN request never touches the critical path of a normal visit.
  useEffect(() => {
    if (!open || ready || failed) return;

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${FAHAD_WIDGET_SRC}"]`
    );
    if (existing) {
      setReady(true);
      return;
    }

    const script = document.createElement("script");
    script.src = FAHAD_WIDGET_SRC;
    script.async = true;
    script.onload = () => setReady(true);
    script.onerror = () => setFailed(true);
    document.body.appendChild(script);
  }, [open, ready, failed]);

  // <elevenlabs-convai> is a custom element, so create it through the DOM
  // rather than JSX once its defining bundle has loaded.
  useEffect(() => {
    const slot = slotRef.current;
    if (!ready || !slot || slot.childElementCount > 0) return;
    const el = document.createElement("elevenlabs-convai");
    el.setAttribute("agent-id", FAHAD_AGENT_ID);
    slot.appendChild(el);
  }, [ready]);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!FAHAD_ENABLED) return null;

  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="fahad-panel"
        className="fixed bottom-5 start-5 z-50 flex items-center gap-2.5 rounded-full bg-gradient-to-b from-coral-500 to-coral-700 py-3 pe-5 ps-4 text-white shadow-xl shadow-coral-700/30 transition duration-300 hover:-translate-y-0.5 hover:shadow-2xl active:scale-[0.97]"
      >
        <span className="relative grid size-8 place-items-center rounded-full bg-white/20">
          <FahadMark className="size-5" />
          <span
            aria-hidden="true"
            className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full bg-sun-300 ring-2 ring-coral-600"
          />
        </span>
        <span className="font-display text-base font-bold">{FAHAD_COPY.launcher}</span>
      </button>

      {/* Panel */}
      {open && (
        <div
          id="fahad-panel"
          ref={panelRef}
          role="dialog"
          aria-label={`${FAHAD_COPY.name} — ${FAHAD_COPY.role}`}
          className="fixed bottom-24 start-5 z-50 w-[min(22rem,calc(100vw-2.5rem))] overflow-hidden rounded-3xl border border-sand-200 bg-white shadow-2xl"
        >
          <header className="flex items-center gap-3 bg-gradient-to-l from-coral-700 to-coral-500 p-4 text-white">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/20">
              <FahadMark className="size-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-lg font-bold leading-tight">
                {FAHAD_COPY.name}
              </span>
              <span className="flex items-center gap-1 text-xs text-coral-50">
                <IconPinSolid className="size-3" />
                {FAHAD_COPY.role}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={FAHAD_COPY.close}
              className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15 transition hover:bg-white/25"
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </header>

          <div className="p-4">
            <p className="text-sm leading-relaxed text-ink-600">{FAHAD_COPY.greeting}</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-500">{FAHAD_COPY.hint}</p>

            <div className="mt-4 min-h-24 rounded-2xl bg-sand-50 p-3">
              {failed ? (
                <p className="py-4 text-center text-sm font-semibold text-ink-600">
                  ما قدرنا نشغّل فهد الحين — جرّب مرة ثانية بعدين.
                </p>
              ) : ready ? (
                <div ref={slotRef} />
              ) : (
                <p className="py-4 text-center text-sm font-semibold text-ink-500">
                  {FAHAD_COPY.loading}
                </p>
              )}
            </div>

            <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-500">
              {FAHAD_COPY.micNote}{" "}
              <Link href="/privacy" className="underline hover:text-coral-700">
                الخصوصية
              </Link>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
