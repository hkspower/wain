"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PlaceCard from "@/components/PlaceCard";
import ShareHangout from "@/components/ShareHangout";
import { IconSend } from "@/components/icons";
import type { Place } from "@/lib/places";
import { WAIN_AI_CHAT_COPY, WAIN_AI_AGENT_ID, SALEM_NAME } from "@/lib/wain-ai";
import { startSalemChat, type SalemChatHandle, type SalemFailure, type SalemStatus } from "@/lib/salem-chat";
import { usePlaces } from "@/lib/usePlaces";
import { formatOpenPlace, formatShowPlaces } from "@/lib/salem-tools";

/** A typed-chat line — شوق's own reply, the visitor's own, a note from this
 * page itself (a tool it could not run), or one of her two tool RESULTS
 * rendered inline: a row of place cards from `show_places`, or one fuller
 * card from `open_place`. Kept apart from `SalemMessage` (which only ever
 * carries "user" | "agent") because none of the other three is something
 * either side of the conversation SAID.
 *
 * Both card lines carry SLUGS only — `salem-tools.ts`'s own pure half never
 * touches the catalogue, so it cannot hand back a trimmed copy of a place's
 * fields. This component already holds `places` (`usePlaces()`, below), so
 * it resolves each slug against the live rows and renders the real
 * `PlaceCard` — the same one /explore and every "أماكن مشابهة" rail use —
 * rather than a second, ad-hoc card shape that would drift from it. */
type ChatLine =
  | { role: "user" | "agent" | "system"; text: string }
  | { role: "places"; query: string; slugs: string[] }
  | { role: "place"; slug: string };

/**
 * سالم's typed chat — his name, his portrait, his voice on the wire.
 *
 * Third pass on the identity question, and worth reading the first two
 * before touching this again. It shipped as his page once — his name, his
 * photo, a hand-written «أنا سالم» greeting — over an agent whose prompt
 * never changed to match: same first-person FEMININE grammar throughout, a
 * real `first_message` that says «أنا شوق». Corrected to name her instead
 * while still switching the TTS voice to his, then corrected again to drop
 * the voice switch too. Both were the right call for what they were fixing.
 *
 * Reversed again on request, 30 September, that history read back first: his
 * name and photo are back (`SALEM_NAME`, `public/find/salem-face.jpg` —
 * regenerated, the originals having been deleted with the second
 * correction), and `lib/salem-chat.ts` sends his `tts.voice_id` override
 * once more. What did NOT come back is the hand-written greeting — the first
 * line in the transcript is still whatever the wire actually sends, never a
 * scripted one that could disagree with it — because the agent's own prompt
 * is unchanged and its `first_message` still says «أنا شوق». That line will
 * still appear, under his name and his photo, the first time anyone actually
 * talks to him. See `SALEM_VOICE_ID`'s own comment in `lib/wain-ai.ts` for
 * the full account of why that was accepted rather than solved.
 *
 * `show_places`/`open_place` are wired now, on request — see
 * `lib/salem-tools.ts` for why they could not simply be `WainAiCall.tsx`'s
 * own versions (those navigate the page; this page IS the page, and a
 * navigation would end the conversation) and for the pure half of the
 * logic. `usePlaces()` is the one narrow exception to "the catalogue must
 * not reach a client bundle" this file makes, same as `WainAiCall.tsx`
 * already does — safe because this component is its own route's chunk, not
 * the shared bundle every page pays for.
 *
 * `ShareHangout` rides along with both tool results — «integrate hangout»,
 * on request. It did not need building: a شوق CALL already reaches it twice
 * over, for free, because `show_places` navigates to /search (which mounts
 * `SearchPlan`'s own `ShareHangout`) and `open_place` navigates to a place
 * page (which mounts one directly, in `PlaceView.tsx`). Neither tool result
 * on THIS page ever leaves it — that is the whole premise of this file — so
 * neither destination's panel was ever reachable here, and a caller who
 * typed instead of called had a place shown with no way to send it to the
 * group. `SalemPlacesResult`, below, is the fix: the same component, the
 * same `choices`/`onChoose` shape `SearchPlan` already uses, so the time
 * rules, the summer rule and the message format stay the one file that
 * already owns them rather than a second copy drifting from it here.
 */
export default function SalemChat() {
  const notConfigured = WAIN_AI_AGENT_ID === "";
  const [status, setStatus] = useState<SalemStatus>(notConfigured ? "error" : "connecting");
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  // Why the session failed, for the banner — see SalemFailure.
  const [failure, setFailure] = useState<SalemFailure | null>(null);
  // A message is out and her reply has not come: the typing bubble, and the
  // send button held back so a second question does not cross the first.
  const [pending, setPending] = useState(false);
  // True from a session opening until her first line lands: she speaks first,
  // and until then the transcript is empty.
  const [awaitingGreeting, setAwaitingGreeting] = useState(false);
  // A reply is taking long (see WAIN_AI_CHAT_COPY.slow).
  const [slow, setSlow] = useState(false);
  const handleRef = useRef<SalemChatHandle | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Whether the visitor is reading the bottom of the transcript. Forcing the
  // list down on every new line took the place away from anyone scrolled up to
  // re-read an earlier answer.
  const stickRef = useRef(true);
  const { places } = usePlaces();

  // Same shape as WainAiCall.tsx's own `loadIndex`, for the same reason: the
  // search engine belongs to a conversation that may never happen, so it is
  // a runtime import() started on approach (here: as soon as a session opens,
  // since unlike the call there is no separate "ringing" moment to hide it
  // behind) rather than a static one paid by every visit to this page.
  const loadIndex = useMemo(() => {
    let pending: Promise<{ mod: typeof import("@/lib/search"); index: import("@/lib/search").SearchIndex }> | null =
      null;
    return () =>
      (pending ??= import("@/lib/search").then((mod) => ({ mod, index: mod.buildIndex(places) })));
  }, [places]);

  useEffect(() => {
    if (notConfigured) return;
    void loadIndex().catch(() => {
      // The tool call retries and falls through to its generic wording.
    });
  }, [notConfigured, loadIndex]);

  /**
   * Opens a session and points `handleRef` at it. Called once on mount, and
   * again by the "ابدأ من جديد" button once `status` has settled to
   * "error" or "disconnected" — before this, retrying meant a page reload,
   * because nothing ever called `startSalemChat` a second time.
   */
  function connect() {
    handleRef.current?.close();
    setFailure(null);
    setPending(false);
    setAwaitingGreeting(true);
    // A second session's greeting would otherwise land directly under the
    // first one's last line, as if it were the next thing said.
    setMessages((prev) =>
      prev.length > 0 ? [...prev, { role: "system", text: WAIN_AI_CHAT_COPY.newConversation }] : prev
    );
    const handle = startSalemChat({
      onStatus: (s, f) => {
        setStatus(s);
        if (s === "error" || s === "disconnected") setAwaitingGreeting(false);
        setFailure(s === "error" ? (f ?? "refused") : null);
      },
      onPending: setPending,
      onMessage: (m) => {
        if (m.role === "agent") setAwaitingGreeting(false);
        setMessages((prev) => [...prev, m]);
      },
      onNoReply: () => setMessages((prev) => [...prev, { role: "system", text: WAIN_AI_CHAT_COPY.noReply }]),
      // She corrected what she had just said: replace that bubble rather than
      // leave both on screen.
      onCorrection: ({ original, corrected }) =>
        setMessages((prev) => {
          let at = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            const line = prev[i];
            if (line.role === "agent" && (original === "" || line.text === original)) {
              at = i;
              break;
            }
          }
          if (at < 0) return prev;
          const next = prev.slice();
          next[at] = { role: "agent", text: corrected };
          return next;
        }),
      onToolUnavailable: () =>
        setMessages((prev) => [...prev, { role: "system", text: WAIN_AI_CHAT_COPY.toolUnavailable }]),
      clientTools: {
        show_places: async ({ query }) => {
          const q = String(query ?? "").trim();
          if (!q) return "ما وصلت كلمات بحث — ما تغيّر شي عند الزائر.";
          const { mod, index } = await loadIndex();
          const hits = mod.search(q, index, { limit: 40 });
          const { spoken, slugs } = formatShowPlaces(q, hits, places);
          setMessages((prev) => [...prev, { role: "places", query: q, slugs }]);
          return spoken;
        },
        open_place: async ({ slug }) => {
          const { spoken, slug: opened } = formatOpenPlace(String(slug ?? ""), places);
          if (opened) setMessages((prev) => [...prev, { role: "place", slug: opened }]);
          return spoken;
        },
      },
    });
    handleRef.current = handle;
  }

  useEffect(() => {
    if (notConfigured) return;
    connect();
    return () => handleRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connect/notConfigured close over stable setters, `places`/`loadIndex` via a ref-free closure, and a build-time constant; re-running this effect on every render would open a new socket each time
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickRef.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [messages, pending]);

  const typing = status === "connected" && (pending || awaitingGreeting);
  useEffect(() => {
    if (!typing) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(t);
  }, [typing]);

  function submit(raw: string): boolean {
    const text = raw.trim();
    if (!text || status !== "connected" || pending) return false;
    // Send first, draw the bubble only if the message left: it used to be the
    // other way round, so a closed socket showed a message that was never sent.
    if (!handleRef.current?.send(text)) {
      setMessages((prev) => [...prev, { role: "system", text: WAIN_AI_CHAT_COPY.sendFailed }]);
      return false;
    }
    stickRef.current = true;
    setMessages((prev) => [...prev, { role: "user", text }]);
    return true;
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    if (submit(draft)) setDraft("");
  }

  // Starters are for a conversation that has not begun: gone once anyone has
  // typed, and gone while a reply is on its way.
  const showStarters =
    status === "connected" && !pending && !awaitingGreeting && !messages.some((m) => m.role === "user");

  const failureText =
    failure === "timeout"
      ? WAIN_AI_CHAT_COPY.failedTimeout
      : failure === "dropped"
        ? WAIN_AI_CHAT_COPY.failedDropped
        : WAIN_AI_CHAT_COPY.failed;

  const statusLine = notConfigured
    ? WAIN_AI_CHAT_COPY.notConfigured
    : status === "connecting"
      ? WAIN_AI_CHAT_COPY.connecting
      : status === "connected"
        ? WAIN_AI_CHAT_COPY.connected
        : status === "disconnected"
          ? WAIN_AI_CHAT_COPY.disconnected
          : WAIN_AI_CHAT_COPY.offline;

  return (
    // text-white here: not decorative — the sr-only <label> below inherits
    // whatever colour this sets, and without an explicit one it fell back to
    // the page's default (dark) text colour sitting on this dark background.
    // A sighted visitor never sees the label either way, but audit:color
    // measures every text node this DOM walker's visibility check does not
    // exclude, sr-only included, and correctly caught a real 1.10:1 pair —
    // dark ink text nobody was ever meant to see against a dark backdrop.
    <div className="flex min-h-dvh flex-col bg-sea-950 text-white">
      <header className="flex items-center gap-3 border-b border-white/10 bg-sea-950 px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimiser */}
        <img
          src="/find/salem-face.jpg"
          alt=""
          aria-hidden="true"
          width={320}
          height={320}
          className="size-11 shrink-0 rounded-full object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-bold text-white">{SALEM_NAME}</p>
          <p aria-live="polite" className="truncate text-xs text-sand-200">
            {statusLine}
          </p>
        </div>
      </header>

      {/* role="log": the transcript is the one thing on this page that changes
          without the visitor touching it, and a screen reader heard none of
          her replies — only the header's status line was a live region. */}
      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {messages.map((m, i) => {
          if (m.role === "system") {
            return (
              <p key={i} role="status" className="mx-auto max-w-[85%] rounded-2xl bg-white/10 px-4 py-2 text-center text-xs text-sand-200">
                {m.text}
              </p>
            );
          }
          if (m.role === "places") {
            // Her own words already carry the count and the first names
            // (formatShowPlaces' `spoken`, read by the agent); the rail is
            // the thing itself, not a repeat of what she said about it. Real
            // `PlaceCard`s, matching /explore's own rail — see this file's
            // `ChatLine` comment for why the ad-hoc pill this used to be was
            // replaced rather than restyled. `SalemPlacesResult` owns its own
            // `ShareHangout`, on the same reasoning.
            const cards = m.slugs.flatMap((slug) => {
              const place = places.find((p) => p.slug === slug);
              return place ? [place] : [];
            });
            return <SalemPlacesResult key={i} places={cards} query={m.query} />;
          }
          if (m.role === "place") {
            const place = places.find((p) => p.slug === m.slug);
            if (!place) return null;
            return (
              <div key={i} className="space-y-2">
                <div className="w-48">
                  <PlaceCard place={place} />
                </div>
                <ShareHangout place={place} />
              </div>
            );
          }
          return (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <p
                className={`max-w-[80%] whitespace-pre-line rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user" ? "bg-sea-600 text-white" : "bg-white text-ink-900"
                }`}
              >
                {m.text}
              </p>
            </div>
          );
        })}
        {typing && (
          <div className="flex flex-col items-start gap-1">
            <p className="rounded-2xl bg-white px-4 py-3 text-ink-900">
              <span className="sr-only">{WAIN_AI_CHAT_COPY.typing}</span>
              <span aria-hidden="true" className="flex gap-1">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="size-1.5 animate-pulse rounded-full bg-ink-400"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </span>
            </p>
            {slow && <p className="px-1 text-xs text-sand-200">{WAIN_AI_CHAT_COPY.slow}</p>}
          </div>
        )}
        {showStarters && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-sand-200">{WAIN_AI_CHAT_COPY.starterLabel}</span>
            {WAIN_AI_CHAT_COPY.starters.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => submit(q)}
                className="inline-flex min-h-6 items-center rounded-full bg-white/10 px-3 text-sm text-white transition hover:bg-white/20"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {status === "error" && (
          <p role="alert" className="mx-auto max-w-[85%] rounded-2xl bg-coral-50 px-4 py-2.5 text-center text-sm text-coral-700">
            {notConfigured ? WAIN_AI_CHAT_COPY.notConfigured : failureText}
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
              onClick={connect}
              className="mt-1 inline-flex min-h-6 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-ink-900 transition hover:bg-sand-100"
            >
              {WAIN_AI_CHAT_COPY.reconnect}
            </button>
          </div>
        )}
      </div>

      <form onSubmit={send} className="flex items-stretch gap-2 border-t border-white/10 bg-sea-950 p-3">
        <label htmlFor="salem-q" className="sr-only">
          {WAIN_AI_CHAT_COPY.placeholder}
        </label>
        <input
          id="salem-q"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={status === "connected" ? WAIN_AI_CHAT_COPY.placeholder : statusLine}
          disabled={status !== "connected"}
          // No `disabled:opacity-*` — the box already reads a normal white
          // field, and the header's own status line is what says "not yet".
          className="h-11 min-w-0 flex-1 rounded-full bg-white px-4 text-base text-ink-900 placeholder:text-ink-400 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={status !== "connected" || pending || draft.trim() === ""}
          aria-label={WAIN_AI_CHAT_COPY.send}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-sea-600 text-white transition hover:bg-sea-700 disabled:opacity-40"
        >
          <IconSend className="size-5" />
        </button>
      </form>
    </div>
  );
}

/**
 * One `show_places` turn, as its own component so its "أي مكان؟" selection —
 * `ShareHangout`'s own chip row, only shown when there is more than one
 * choice — is local to THIS turn rather than shared across every
 * `show_places` call in the conversation. Without that, picking a different
 * place in an earlier turn's row would silently retarget a later one too,
 * because both would be reading and writing the same piece of state.
 */
function SalemPlacesResult({ places, query }: { places: Place[]; query: string }) {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const target = places.find((p) => p.slug === activeSlug) ?? places[0];

  if (!target) {
    return (
      <p className="mx-auto max-w-[85%] rounded-2xl bg-white/10 px-4 py-2 text-center text-xs text-sand-200">
        {WAIN_AI_CHAT_COPY.noResults} «{query}»
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1">
        {places.map((place) => (
          <li key={place.slug} className="w-40 shrink-0 snap-start">
            <PlaceCard place={place} />
          </li>
        ))}
      </ul>
      {/* SearchPlan.tsx's own shape: `choices` only when there is a real
          choice to make, `onChoose` closing over this turn's own state. */}
      <ShareHangout place={target} choices={places.length > 1 ? places : undefined} onChoose={setActiveSlug} />
    </div>
  );
}
