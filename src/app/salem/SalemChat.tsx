"use client";

import { useEffect, useRef, useState } from "react";
import { IconSend } from "@/components/icons";
import { SALEM_AI_COPY, WAIN_AI_AGENT_ID } from "@/lib/wain-ai";
import { startSalemChat, type SalemChatHandle, type SalemStatus } from "@/lib/salem-chat";

/** A typed-chat line — شوق/سالم's own reply, the visitor's own, or a note
 * from this page itself (a tool it could not run). Kept apart from
 * `SalemMessage` (which only ever carries "user" | "agent") because a
 * system note is not something either side of the conversation said. */
type ChatLine = { role: "user" | "agent" | "system"; text: string };

/**
 * سالم's own full page: a typed chat, not a call.
 *
 * Deliberately does not import `@/lib/places` or `usePlaces()` — see the
 * "catalogue must not reach a client bundle" rule in CLAUDE.md. That means
 * `show_places`/`open_place`, the tools شوق's own call uses to put results on
 * screen (`WainAiCall.tsx`), have nothing to act on here: `lib/salem-chat.ts`
 * answers the tool call with an error instead of leaving it to hang, and
 * `onToolUnavailable` below turns that into a system line in the transcript
 * so a visitor knows why nothing appeared. He can still recommend places by
 * name in the text itself — only the map/results panel is unavailable here.
 */
export default function SalemChat() {
  const notConfigured = WAIN_AI_AGENT_ID === "";
  const [status, setStatus] = useState<SalemStatus>(notConfigured ? "error" : "connecting");
  const [messages, setMessages] = useState<ChatLine[]>([
    { role: "agent", text: SALEM_AI_COPY.greeting },
  ]);
  const [draft, setDraft] = useState("");
  const handleRef = useRef<SalemChatHandle | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /**
   * Opens a session and points `handleRef` at it. Called once on mount, and
   * again by the "ابدأ من جديد" button once `status` has settled to
   * "error" or "disconnected" — before this, retrying meant a page reload,
   * because nothing ever called `startSalemChat` a second time.
   */
  function connect() {
    const handle = startSalemChat({
      onStatus: setStatus,
      onMessage: (m) => setMessages((prev) => [...prev, m]),
      onToolUnavailable: () =>
        setMessages((prev) => [...prev, { role: "system", text: SALEM_AI_COPY.toolUnavailable }]),
    });
    handleRef.current = handle;
  }

  useEffect(() => {
    if (notConfigured) return;
    connect();
    return () => handleRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connect/notConfigured close over stable setters and a build-time constant; re-running this effect on every render would open a new socket each time
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || status !== "connected") return;
    setMessages((prev) => [...prev, { role: "user", text }]);
    handleRef.current?.send(text);
    setDraft("");
  }

  const statusLine = notConfigured
    ? SALEM_AI_COPY.notConfigured
    : status === "connecting"
      ? SALEM_AI_COPY.connecting
      : status === "connected"
        ? SALEM_AI_COPY.connected
        : status === "disconnected"
          ? SALEM_AI_COPY.disconnected
          : SALEM_AI_COPY.failed;

  return (
    // text-white here: not decorative — the sr-only <label> below inherits
    // whatever colour this sets, and without an explicit one it fell back to
    // the page's default (dark) text colour sitting on this dark background.
    // A sighted visitor never sees the label either way, but audit:color
    // measures every text node this DOM walker's visibility check does not
    // exclude, sr-only included, and correctly caught a real 1.10:1 pair —
    // dark ink text nobody was ever meant to see against a dark backdrop.
    <div className="flex min-h-dvh flex-col bg-sea-950 text-white">
      {/* A slim band, not the full-bleed 50vh hero /find's halves use — this
          page is a working chat, so the photo introduces him once rather
          than filling the viewport every time a message arrives. */}
      <header className="flex items-center gap-3 border-b border-white/10 bg-sea-950 px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimiser */}
        <img
          src="/find/salem-face.jpg"
          alt=""
          aria-hidden="true"
          width={96}
          height={96}
          className="size-11 shrink-0 rounded-full object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-bold text-white">{SALEM_AI_COPY.name}</p>
          <p aria-live="polite" className="truncate text-xs text-sand-200">
            {statusLine}
          </p>
        </div>
      </header>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m, i) =>
          m.role === "system" ? (
            <p key={i} role="status" className="mx-auto max-w-[85%] rounded-2xl bg-white/10 px-4 py-2 text-center text-xs text-sand-200">
              {m.text}
            </p>
          ) : (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <p
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user" ? "bg-sea-600 text-white" : "bg-white text-ink-900"
                }`}
              >
                {m.text}
              </p>
            </div>
          )
        )}
        {status === "error" && (
          <p role="alert" className="mx-auto max-w-[85%] rounded-2xl bg-coral-50 px-4 py-2.5 text-center text-sm text-coral-700">
            {notConfigured ? SALEM_AI_COPY.notConfigured : SALEM_AI_COPY.failed}
          </p>
        )}
        {/* Not for notConfigured — that comes from a build-time constant, so
            retrying opens the exact same session the agent id already
            refused. "error" and "disconnected" are the two states a fresh
            socket can actually answer differently. */}
        {!notConfigured && (status === "error" || status === "disconnected") && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => {
                setMessages((prev) => [...prev, { role: "agent", text: SALEM_AI_COPY.greeting }]);
                connect();
              }}
              className="mt-1 inline-flex min-h-6 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-ink-900 transition hover:bg-sand-100"
            >
              {SALEM_AI_COPY.reconnect}
            </button>
          </div>
        )}
      </div>

      <form onSubmit={send} className="flex items-stretch gap-2 border-t border-white/10 bg-sea-950 p-3">
        <label htmlFor="salem-q" className="sr-only">
          {SALEM_AI_COPY.placeholder}
        </label>
        <input
          id="salem-q"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={SALEM_AI_COPY.placeholder}
          disabled={status !== "connected"}
          // No `disabled:opacity-*` — the box already reads a normal white
          // field, and the header's own status line is what says "not yet".
          className="h-11 min-w-0 flex-1 rounded-full bg-white px-4 text-base text-ink-900 placeholder:text-ink-400 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={status !== "connected" || draft.trim() === ""}
          aria-label={SALEM_AI_COPY.send}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-sea-600 text-white transition hover:bg-sea-700 disabled:opacity-40"
        >
          <IconSend className="size-5" />
        </button>
      </form>
    </div>
  );
}
