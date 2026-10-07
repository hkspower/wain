"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import BackButton from "@/components/BackButton";
import PlaceCard from "@/components/PlaceCard";
import SearchMap from "@/components/SearchMap";
import ShareHangout from "@/components/ShareHangout";
import ShouqCallButton from "@/components/ShouqCallButton";
import { IconGo, IconMap, IconSend, IconSpeaker, IconSpeakerOff } from "@/components/icons";
import type { Place } from "@/lib/places";
import { WAIN_AI_CHAT_COPY } from "@/lib/salem-copy";
import {
  WAIN_AI_AGENT_ENABLED,
  WAIN_AI_RECORDING,
  SALEM_NAME,
  type SalemHandoffFrom,
} from "@/lib/wain-ai";
import { answerParts, placeTryLine, whenParts, type SpeechPart } from "@/lib/voice-lines";
import { primeAudio, speak, stop as stopVoice } from "@/lib/voice";
import type { ChatContext } from "@/lib/salem-followup";
import { startSalemChat, type SalemChatHandle, type SalemFailure, type SalemStatus } from "@/lib/salem-chat";
import { agentAvailable, markAgentUnavailable } from "@/lib/agent-health";
import { usePlaces } from "@/lib/usePlaces";
import { formatOpenPlace, formatShowPlaces } from "@/lib/salem-tools";
import { CHOICE_MAX } from "@/lib/hangout";

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
  | { role: "places"; query: string; slugs: string[]; chips?: string[] }
  | { role: "place"; slug: string }
  | { role: "where"; slug: string };

/** Where the conversation is kept while the visitor is on a place page.
 * A card in the chat is a link, and coming back with the browser's back
 * button used to land on «هلا! أنا سالم» and nothing else — the answer they
 * had followed was gone. Session storage: this tab, this visit, this device;
 * nothing leaves the page, which is what the notice under the chat says. */
const KEPT = "wain:salem:v1";
/** Lines kept, the newest. A long chat is a long JSON string on every turn. */
const KEPT_LINES = 60;
/** His replies read aloud — this device's choice, like صوت وين's. */
const READ_PREF = "wain-salem-read";

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
/** How long the retry waits after the server said she is unavailable. */
const UNAVAILABLE_RETRY_MS = 30000;

/**
 * The free build — the live site since 2 October (see wain-ai.ts): no agent,
 * no socket, nothing sent anywhere. Each message is answered from وين's own
 * search inside the page, with the same cards and hangout panel `show_places`
 * draws for the agent, and a sentence from `answerParts` — the words the
 * free CALL already speaks on /search, so the two free paths say the same
 * thing about the same place. It used to be «المحادثة مو متاحة الحين» under
 * a notice that the chat was being saved: a dead end that also claimed
 * something untrue.
 */
const FREE = !WAIN_AI_AGENT_ENABLED;

/**
 * An agent build answers this way too when the agent cannot: a refusal for
 * credits (lib/agent-health.ts) used to leave «سالم مو متاح» over a page whose
 * search engine was already loaded. So «free» is state, not only the build:
 * it starts as the build says, and turns on at a refusal, or at mount when
 * this device met one in the last quarter hour.
 */

/** How long a free answer may take before the chat says it got none. */
const FREE_REPLY_MS = 10_000;

export default function SalemChat() {
  const [free, setFree] = useState(FREE);
  const freeRef = useRef(FREE);
  const [status, setStatus] = useState<SalemStatus>(FREE ? "connected" : "connecting");
  const [messages, setMessages] = useState<ChatLine[]>(() =>
    FREE ? [{ role: "agent", text: WAIN_AI_CHAT_COPY.freeGreeting }] : []
  );
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
  // After an «unavailable» refusal the retry button waits; see below.
  const [retryReady, setRetryReady] = useState(true);
  const handleRef = useRef<SalemChatHandle | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Whether the visitor is reading the bottom of the transcript. Forcing the
  // list down on every new line took the place away from anyone scrolled up to
  // re-read an earlier answer.
  const stickRef = useRef(true);
  const { places } = usePlaces();
  // The memory: what the last answer was, and which of its places the visitor
  // last pointed at (a pin or a card), for «وين بالضبط؟».
  const ctxRef = useRef<ChatContext | null>(null);
  const activeRef = useRef<string | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const readAloudRef = useRef(false);
  readAloudRef.current = readAloud;

  // Same shape as WainAiCall.tsx's own `loadIndex`, for the same reason: the
  // search engine belongs to a conversation that may never happen, so it is
  // a runtime import() started on approach (here: as soon as a session opens,
  // since unlike the call there is no separate "ringing" moment to hide it
  // behind) rather than a static one paid by every visit to this page.
  // answer-order.ts comes with it: it is the ordering /search uses, so the
  // same question names the same place here and there — and it sits on the
  // search module, so it belongs to the same lazy load.
  const loadIndex = useMemo(() => {
    let pending: Promise<{
      mod: typeof import("@/lib/search");
      order: typeof import("@/lib/answer-order");
      follow: typeof import("@/lib/salem-followup");
      index: import("@/lib/search").SearchIndex;
    }> | null = null;
    // salem-followup rides with the search because it folds words with the
    // search's own `normalise` — up front it would carry the engine with it.
    return () =>
      (pending ??= Promise.all([
        import("@/lib/search"),
        import("@/lib/answer-order"),
        import("@/lib/salem-followup"),
      ]).then(
        ([mod, order, follow]) => ({ mod, order, follow, index: mod.buildIndex(places) }),
        (err) => {
          // Forget a failure: a remembered rejection failed every message
          // after the first, for the rest of the visit.
          pending = null;
          throw err;
        }
      ));
  }, [places]);

  // The socket opens once, at mount, so its tool handlers outlive the first
  // render — and that render's `places` is the build-time snapshot, replaced
  // by the server's rows a moment later. They read these instead, or a place
  // renamed or unpublished in the admin is answered the old way (the call's
  // tools had the same fix, WainAiCall.tsx).
  const placesRef = useRef(places);
  const loadIndexRef = useRef(loadIndex);
  useEffect(() => {
    placesRef.current = places;
    loadIndexRef.current = loadIndex;
  }, [places, loadIndex]);

  // The box is live in the server HTML, before the page's script has run, and
  // a tap or an Enter then did nothing — or submitted the form the old way and
  // reloaded the page with the question gone. It waits for this instead.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  // The conversation, back where it was after a visit to a place page (see
  // KEPT). Free build only: an agent conversation lives on its socket, and a
  // transcript restored without the session behind it would be a chat that
  // cannot answer. Restored after mount — the HTML is one file for everybody.
  const restoredRef = useRef(false);
  useEffect(() => {
    try {
      setReadAloud(localStorage.getItem(READ_PREF) === "1");
    } catch {
      /* private mode — off */
    }
    // The HTML of an agent build says «connecting»; a device that met a
    // refusal in the last quarter hour is answered here instead, at once.
    const fallback = !FREE && !agentAvailable();
    if (!FREE && !fallback) return;
    if (fallback) answerHere(false);
    try {
      const raw = sessionStorage.getItem(KEPT);
      const kept = raw ? (JSON.parse(raw) as { messages?: ChatLine[]; ctx?: ChatContext | null }) : null;
      if (kept?.messages?.length) {
        setMessages(kept.messages);
        ctxRef.current = kept.ctx ?? null;
      }
    } catch {
      /* private mode, or a shape from an older build — start fresh */
    }
    restoredRef.current = true;
  }, []);
  useEffect(() => {
    if (!freeRef.current || !restoredRef.current) return;
    try {
      sessionStorage.setItem(KEPT, JSON.stringify({ messages: messages.slice(-KEPT_LINES), ctx: ctxRef.current }));
    } catch {
      /* full or private — the chat still works, it just will not survive a back */
    }
  }, [messages]);

  // A question handed over from somewhere else — «كمّل مع سالم» on /search,
  // «اسأل سالم» on an invitation. Asked once, as the visitor's own message,
  // and taken off the address bar so a reload does not ask it again.
  const handoffRef = useRef<{ q: string; from: SalemHandoffFrom | null } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q")?.trim();
    if (!q) return;
    const from = params.get("from");
    handoffRef.current = { q: q.slice(0, 120), from: from === "call" || from === "shouq" ? from : null };
    params.delete("q");
    params.delete("from");
    const rest = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
  }, []);

  // Sized to the screen that is actually visible. `h-dvh` alone ignored the
  // keyboard on iPhones (the browser panned the page and the header slid
  // off), and inside a `min-h-screen` body the page scrolled under the chat by
  // the height of the toolbar. The frame is fixed to the visual viewport now,
  // and the page behind it does not scroll.
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    const vv = window.visualViewport;
    const fit = () => {
      const el = frameRef.current;
      if (!el || !vv) return;
      el.style.setProperty("--vvh", `${vv.height}px`);
      el.style.top = `${vv.offsetTop}px`;
    };
    fit();
    vv?.addEventListener("resize", fit);
    vv?.addEventListener("scroll", fit);
    return () => {
      root.style.overflow = before;
      vv?.removeEventListener("resize", fit);
      vv?.removeEventListener("scroll", fit);
    };
  }, []);

  useEffect(() => {
    void loadIndex().catch(() => {
      // The tool call (or the free answer) retries on its own.
    });
  }, [loadIndex]);

  /**
   * The free build's reply: our own search, our own words, no wire — read
   * against the last answer first (lib/salem-followup.ts), so «أرخص», «غيره»
   * and «وين بالضبط؟» answer what he just said instead of starting again.
   */
  async function answerLocally(q: string) {
    setPending(true);
    try {
      // Bounded: a search chunk stuck on a weak connection kept the dots up and
      // the box locked for ever. Ten seconds, then say so; the next message
      // tries again.
      const { mod, order, follow, index } = await Promise.race([
        loadIndex(),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), FREE_REPLY_MS)),
      ]);
      const clock = order.kuwaitClock();
      const ctx = ctxRef.current;
      const intent = follow.readFollowUp(q, ctx, activeRef.current);
      const bySlug = (slug: string) => places.find((p) => p.slug === slug);
      const lines: ChatLine[] = [];
      let parts: SpeechPart[] = [];

      // Cards for a list of slugs, the answer's own sentence, and the memory
      // and the chips that go with them.
      const showList = (query: string, slugs: string[], ranked: string[], seen: string[], spoken: SpeechPart[]) => {
        const next: ChatContext = { query, ranked, seen, shown: slugs };
        const shown = slugs.flatMap((s) => bySlug(s) ?? []);
        lines.push({ role: "places", query, slugs, chips: follow.followUpChips(next, shown, clock) });
        ctxRef.current = next;
        activeRef.current = null;
        parts = spoken;
      };
      const search = (query: string) => {
        const { hits } = order.answerOrder(query, mod.search(query, index, { limit: 40 }), index, places, clock);
        const ranked = hits.filter((h) => h.doc.kind === "place").map((h) => h.doc.id.replace(/^place:/, ""));
        return { hits, ranked: ranked.filter((s) => bySlug(s)) };
      };

      if (ctx && intent.kind === "more") {
        const slugs = follow.nextPlaces(ctx);
        if (slugs.length === 0) {
          lines.push({ role: "agent", text: WAIN_AI_CHAT_COPY.moreNone });
        } else {
          const top = bySlug(slugs[0])!;
          const spoken = [{ key: `try-${top.slug}`, text: placeTryLine(top) }, ...whenParts(top, clock.month, clock.hour)];
          lines.push({ role: "agent", text: `${WAIN_AI_CHAT_COPY.moreIntro} ${spoken.map((p) => p.text).join(" ")}` });
          showList(ctx.query, slugs, ctx.ranked, [...ctx.seen, ...slugs], spoken);
        }
      } else if (intent.kind === "pick" || intent.kind === "where") {
        const place = bySlug(intent.slug)!;
        activeRef.current = place.slug;
        if (intent.kind === "pick") {
          parts = [{ key: `try-${place.slug}`, text: placeTryLine(place) }, ...whenParts(place, clock.month, clock.hour)];
          lines.push({ role: "agent", text: parts.map((p) => p.text).join(" ") }, { role: "place", slug: place.slug });
        } else {
          parts = [{ text: `${place.nameAr} — ${place.areaAr}.` }];
          lines.push({ role: "agent", text: `${parts[0].text} ${WAIN_AI_CHAT_COPY.where}` }, { role: "where", slug: place.slug });
        }
      } else {
        // («غيره» with nothing remembered cannot happen — readFollowUp needs a
        // last answer to call anything a follow-up — but it reads as asked.)
        const query = intent.kind === "more" ? q : intent.query;
        const { hits, ranked } = search(query);
        if (ranked.length === 0 && intent.kind === "refine" && ctx) {
          // Nothing fits both — say so, and leave the last answer where it is
          // rather than replacing it with the dead end.
          lines.push({ role: "agent", text: WAIN_AI_CHAT_COPY.refineNone });
        } else if (ranked.length === 0) {
          lines.push({ role: "agent", text: WAIN_AI_CHAT_COPY.freeEmpty });
          ctxRef.current = null;
        } else {
          const { slugs } = formatShowPlaces(query, hits, places);
          const found = slugs.flatMap((slug) => bySlug(slug) ?? []);
          const spoken = answerParts(hits, found, clock);
          lines.push({ role: "agent", text: spoken.map((p) => p.text).join(" ") });
          showList(query, slugs, ranked, slugs, spoken);
        }
      }
      setMessages((prev) => [...prev, ...lines]);
      if (readAloudRef.current && parts.length) speak(parts, { persona: "salem" });
    } catch {
      setMessages((prev) => [...prev, { role: "system", text: WAIN_AI_CHAT_COPY.noReply }]);
    } finally {
      setPending(false);
    }
  }

  /**
   * From here on he answers from our own search, as the free build does. Said
   * once in the transcript — the notice under the box changes with it, since
   * nothing typed leaves the device any more. `refused` is the refusal itself;
   * otherwise this device met one earlier and the agent is not tried at all.
   */
  function answerHere(refused: boolean) {
    freeRef.current = true;
    restoredRef.current = true;
    handleRef.current?.close();
    handleRef.current = null;
    setFree(true);
    setFailure(null);
    setPending(false);
    setAwaitingGreeting(false);
    setStatus("connected");
    setMessages((prev) => [
      ...prev,
      { role: "system", text: WAIN_AI_CHAT_COPY.agentFallback },
      ...(refused && prev.some((m) => m.role === "agent") ? [] : [{ role: "agent" as const, text: WAIN_AI_CHAT_COPY.freeGreeting }]),
    ]);
  }

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
        // A refusal for credits: he answers from our own search instead, and
        // this device skips the agent for a while (lib/agent-health.ts).
        if (s === "error" && f === "unavailable") {
          markAgentUnavailable();
          answerHere(true);
          return;
        }
        if (freeRef.current) return;
        setStatus(s);
        if (s === "error" || s === "disconnected") setAwaitingGreeting(false);
        setFailure(s === "error" ? (f ?? "refused") : null);
      },
      onPending: setPending,
      onMessage: (m) => {
        if (m.role === "agent") setAwaitingGreeting(false);
        setMessages((prev) => [...prev, m]);
        // His reply in his voice, a sentence at a time through the bridge
        // (lib/voice.ts) — the agent's own audio is off on this channel.
        if (m.role === "agent" && readAloudRef.current) speak([{ text: m.text }], { persona: "salem" });
      },
      onNoReply: () => setMessages((prev) => [...prev, { role: "system", text: WAIN_AI_CHAT_COPY.noReply }]),
      onSlow: () => setSlow(true),
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
          const { mod, order, index } = await loadIndexRef.current();
          const live = placesRef.current;
          const { hits } = order.answerOrder(q, mod.search(q, index, { limit: 40 }), index, live);
          const { spoken, slugs } = formatShowPlaces(q, hits, live);
          setMessages((prev) => [...prev, { role: "places", query: q, slugs }]);
          return spoken;
        },
        open_place: async ({ slug }) => {
          const { spoken, slug: opened } = formatOpenPlace(String(slug ?? ""), placesRef.current);
          if (opened) setMessages((prev) => [...prev, { role: "place", slug: opened }]);
          return spoken;
        },
      },
    });
    handleRef.current = handle;
  }

  useEffect(() => {
    if (FREE || !agentAvailable()) return;
    connect();
    return () => handleRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connect closes over stable setters, `places`/`loadIndex` through refs, and a build-time constant; re-running this effect on every render would open a new socket each time
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickRef.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = reduced ? "auto" : "smooth";
    // A reply is a sentence, then its cards, its map and its share panel —
    // taller than a small phone. Scrolled to the bottom, the sentence was
    // above the screen and the visitor met a share form (320×568, 3 October).
    // So a new reply is scrolled to where it STARTS; the bottom is for the
    // visitor's own message and the typing dots.
    let lastUser = -1;
    messages.forEach((m, i) => {
      if (m.role === "user") lastUser = i;
    });
    const replyStart = !pending && lastUser >= 0 && lastUser < messages.length - 1 ? lastUser + 1 : -1;
    const start = replyStart >= 0 ? el.querySelector<HTMLElement>(`[data-line="${replyStart}"]`) : null;
    if (start) {
      const top = el.scrollTop + start.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
      el.scrollTo({ top, behavior });
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior });
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
    if (freeRef.current) {
      stickRef.current = true;
      setMessages((prev) => [...prev, { role: "user", text }]);
      void answerLocally(text);
      return true;
    }
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

  // The handed-over question goes as soon as the chat can take it: at once in
  // the free build, after her greeting on a socket.
  useEffect(() => {
    const handoff = handoffRef.current;
    if (!handoff || !ready || status !== "connected" || pending || awaitingGreeting) return;
    handoffRef.current = null;
    // A NEW question, whatever this tab remembers: read against an older chat,
    // «شي رخيص» from her came out as a narrowing of that chat's subject, and
    // the cards were not the ones she had just named. Asked fresh, the same
    // ordering her answer uses (lib/answer-order.ts) puts the same place first.
    ctxRef.current = null;
    activeRef.current = null;
    if (handoff.from) {
      const label = handoff.from === "call" ? WAIN_AI_CHAT_COPY.fromCall : WAIN_AI_CHAT_COPY.fromShouq;
      setMessages((prev) => [...prev, { role: "system", text: `${label}: «${handoff.q}»` }]);
    }
    submit(handoff.q);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- submit closes over the same state listed here
  }, [ready, status, pending, awaitingGreeting]);

  function toggleReadAloud() {
    const on = !readAloud;
    // Inside the tap, so iOS lets the first reply play.
    if (on) primeAudio();
    else stopVoice();
    setReadAloud(on);
    try {
      localStorage.setItem(READ_PREF, on ? "1" : "0");
    } catch {
      /* private mode — this visit only */
    }
  }

  // Leaving the chat should not leave him talking.
  useEffect(() => () => stopVoice(), []);

  function send(e: React.FormEvent) {
    e.preventDefault();
    if (submit(draft)) setDraft("");
  }

  // Starters are for a conversation that has not begun: gone once anyone has
  // typed, and gone while a reply is on its way.
  const showStarters =
    status === "connected" && !pending && !awaitingGreeting && !messages.some((m) => m.role === "user");

  // An «unavailable» refusal will refuse again if retried at once, so the
  // button only comes back after a while — a page that offers a retry it
  // knows will fail is the «جرّب مرة ثانية» this state exists to replace.
  useEffect(() => {
    if (failure !== "unavailable") {
      setRetryReady(true);
      return;
    }
    setRetryReady(false);
    const t = setTimeout(() => setRetryReady(true), UNAVAILABLE_RETRY_MS);
    return () => clearTimeout(t);
  }, [failure]);

  const failureText =
    failure === "unavailable"
      ? WAIN_AI_CHAT_COPY.unavailable
      : failure === "timeout"
      ? WAIN_AI_CHAT_COPY.failedTimeout
      : failure === "dropped"
        ? WAIN_AI_CHAT_COPY.failedDropped
        : WAIN_AI_CHAT_COPY.failed;

  const statusLine = free
    ? WAIN_AI_CHAT_COPY.freeStatus
    : status === "connecting"
      ? WAIN_AI_CHAT_COPY.connecting
      : status === "connected"
        ? WAIN_AI_CHAT_COPY.connected
        : status === "disconnected"
          ? WAIN_AI_CHAT_COPY.disconnected
          : failure === "unavailable"
            ? WAIN_AI_CHAT_COPY.unavailableStatus
            : WAIN_AI_CHAT_COPY.offline;

  return (
    // text-white here: not decorative — the sr-only <label> below inherits
    // whatever colour this sets, and without an explicit one it fell back to
    // the page's default (dark) text colour sitting on this dark background.
    // A sighted visitor never sees the label either way, but audit:color
    // measures every text node this DOM walker's visibility check does not
    // exclude, sr-only included, and correctly caught a real 1.10:1 pair —
    // dark ink text nobody was ever meant to see against a dark backdrop.
    //
    // The height is EXACT, not a minimum. It was `min-h-dvh`, and a minimum
    // gives the transcript's `overflow-y-auto` nothing to overflow: the page
    // grew instead, the box and her newest reply slid below the fold, and the
    // scroll-to-newest effect scrolled a list that could not scroll. Reported
    // as «she did not answer», 1 October. Installed, the body already pads
    // for the tab bar, so the frame is that much shorter.
    <div
      ref={frameRef}
      className="fixed inset-x-0 top-0 z-10 flex h-[var(--vvh,100dvh)] flex-col overflow-hidden bg-sea-950 text-white standalone:h-[calc(var(--vvh,100dvh)-4.25rem-env(safe-area-inset-bottom))]"
    >
      {/* On a wide screen every row keeps to one centred 42rem column
          (`md:px-[calc(50%-21rem)]`): the chat used to run the whole
          window, her replies against one edge, the visitor's against the
          other, and a 1200px input box (7 October). The bars stay full
          width; only what is in them lines up. */}
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-sea-950 px-4 py-3 md:px-[calc(50%-21rem)]">
        {/* In the header, not floating: this page is one fixed frame, so the
            header never scrolls away and a floating circle would sit on his
            portrait. Opened from a shared link, there is no page of ours
            behind it, and /find is where he is offered. */}
        <BackButton floating={false} fallback="/find" />
        {/* 144px for a 44px circle: three device pixels to the CSS pixel and a
            little over. It was the 320px portrait, 24KB, competing with the
            page's scripts for the link before the socket opens — leaving it
            out entirely saved 0.28s at 1.6 Mbps, measured. 4KB now. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimiser */}
        <img
          src="/find/salem-face.jpg"
          alt=""
          aria-hidden="true"
          width={144}
          height={144}
          className="size-11 shrink-0 rounded-full object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-bold text-white">{SALEM_NAME}</p>
          <p aria-live="polite" className="truncate text-xs text-sand-200">
            {statusLine}
          </p>
        </div>
        {/* His voice, on request: off until pressed, and remembered. */}
        <button
          type="button"
          onClick={toggleReadAloud}
          aria-pressed={readAloud}
          aria-label={WAIN_AI_CHAT_COPY.readAloud}
          title={WAIN_AI_CHAT_COPY.readAloud}
          className={`grid size-11 shrink-0 place-items-center rounded-full transition ${
            readAloud ? "bg-coral-600 text-white hover:bg-coral-700" : "bg-white/10 text-white hover:bg-white/20"
          }`}
        >
          {readAloud ? <IconSpeaker className="size-5" /> : <IconSpeakerOff className="size-5" />}
        </button>
        {/* The call itself, placed from here (7 October, on request). It was a
            link to /find — one call button on the site — so switching to her
            cost a page and a second tap. The real ShouqCallButton, never a
            look-alike: the tap has to spend its gesture on the audio and the
            recogniser, or the call rings silently. */}
        <ShouqCallButton size="pill" className="shrink-0" />
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
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 md:px-[calc(50%-21rem)]"
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
            // The chips belong to the newest answer only: under an older one
            // they would narrow something that is no longer the subject.
            const latest = !messages.slice(i + 1).some((x) => x.role === "places");
            return (
              <SalemPlacesResult
                key={i}
                places={cards}
                query={m.query}
                chips={latest && !pending && status === "connected" ? m.chips : undefined}
                onChip={(c) => submit(c)}
                onActive={latest ? (slug) => (activeRef.current = slug) : undefined}
              />
            );
          }
          if (m.role === "where") {
            const place = places.find((p) => p.slug === m.slug);
            if (!place) return null;
            return <SalemWhere key={i} place={place} />;
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
          // The corner nearest the speaker is the tail — hers on the start
          // side, the visitor's on the end — so the dots below and the reply
          // that replaces them are visibly the same bubble.
          return (
            <div key={i} data-line={i} className={`flex items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role !== "user" && <ReplyFace />}
              <p
                className={`animate-bubble-in max-w-[80%] whitespace-pre-line rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user" ? "rounded-ee-md bg-sea-600 text-white" : "rounded-es-md bg-white text-ink-900"
                }`}
              >
                {m.text}
              </p>
            </div>
          );
        })}
        {typing && (
          <div className="flex flex-col items-start gap-1">
            {/* Her bubble, at the height of one line of her reply, so the
                reply lands where the dots were instead of below a shorter box. */}
            <div className="flex items-end gap-2">
            <ReplyFace />
            <p data-typing="" className="animate-bubble-in flex h-10 items-center rounded-2xl rounded-es-md bg-white px-4 text-ink-900">
              <span className="sr-only">{WAIN_AI_CHAT_COPY.typing}</span>
              <span aria-hidden="true" className="flex items-center gap-1.5">
                {[0, 160, 320].map((delay) => (
                  <span
                    key={delay}
                    className="typing-dot size-2 rounded-full bg-ink-500"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </span>
            </p>
            </div>
            {slow && <p className="animate-bubble-in ps-9 text-xs text-sand-200">{WAIN_AI_CHAT_COPY.slow}</p>}
          </div>
        )}
        {showStarters && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-sand-200">{WAIN_AI_CHAT_COPY.starterLabel}</span>
            {WAIN_AI_CHAT_COPY.starters.map((q) => (
              <button
                key={q}
                type="button"
                disabled={!ready}
                onClick={() => submit(q)}
                className="inline-flex min-h-10 items-center rounded-full border border-white/20 bg-white/10 px-4 text-sm text-white transition hover:bg-white/20 disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {status === "error" && (
          <p role="alert" className="mx-auto max-w-[85%] rounded-2xl bg-coral-50 px-4 py-2.5 text-center text-sm text-coral-700">
            {failureText}
          </p>
        )}
        {/* "error" and "disconnected" are the two states a fresh socket can
            actually answer differently. The free build never reaches either. */}
        {!free && (status === "error" || status === "disconnected") && retryReady && (
          <div className="text-center">
            <button
              type="button"
              onClick={connect}
              className="mt-1 inline-flex min-h-tap items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-ink-900 transition hover:bg-sand-100"
            >
              {failure === "unavailable" ? WAIN_AI_CHAT_COPY.retryLater : WAIN_AI_CHAT_COPY.reconnect}
            </button>
          </div>
        )}
      </div>

      {/* Said before the first message, every visit, because the first
          message is already kept: the agent records and keeps conversations
          with no expiry (WAIN_AI_RECORDING). A line the visitor can read
          before typing is the consent; one buried in /privacy is not. */}
      {/* The free build sends nothing anywhere, so it says that instead —
          a recording notice over a chat that records nothing would be the
          same overstatement in the other direction. */}
      <p className="shrink-0 border-t border-white/10 bg-sea-950 px-4 pt-2 text-xs text-sand-200 md:px-[calc(50%-21rem)]">
        {free ? WAIN_AI_CHAT_COPY.freeNotice : WAIN_AI_RECORDING.chatNotice}{" "}
        <Link href="/privacy/#wain-ai" className="inline-flex min-h-tap items-center font-semibold text-white underline underline-offset-2">
          {WAIN_AI_RECORDING.chatNoticeLink}
        </Link>
      </p>
      <form
        onSubmit={send}
        className="flex shrink-0 items-stretch gap-2 bg-sea-950 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] standalone:pb-3 md:px-[calc(50%-21rem)]"
      >
        <label htmlFor="salem-q" className="sr-only">
          {WAIN_AI_CHAT_COPY.placeholder}
        </label>
        <input
          id="salem-q"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={status === "connected" ? WAIN_AI_CHAT_COPY.placeholder : statusLine}
          disabled={!ready || status !== "connected"}
          // No `disabled:opacity-*` — the box already reads a normal white
          // field, and the header's own status line is what says "not yet".
          className="h-11 min-w-0 flex-1 rounded-full bg-white px-4 text-base text-ink-900 placeholder:text-ink-400 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={!ready || status !== "connected" || pending || draft.trim() === ""}
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
 *
 * The map under the cards is /search's own (`SearchMap`, compact), and the
 * three point at one place together, as they do there: a pin, a card's ring
 * and the share panel's «أي مكان؟». It is a map per reply rather than one for
 * the chat, on request — each answer keeps its own places where they are.
 */
function SalemPlacesResult({
  places,
  query,
  chips,
  onChip,
  onActive,
}: {
  places: Place[];
  query: string;
  chips?: readonly string[];
  onChip?: (chip: string) => void;
  onActive?: (slug: string) => void;
}) {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const target = places.find((p) => p.slug === activeSlug) ?? places[0];
  const railRef = useRef<HTMLUListElement>(null);

  const choose = (slug: string | null) => {
    setActiveSlug(slug);
    if (!slug) return;
    onActive?.(slug);
    // Bring its card into the rail's view — the rail scrolls sideways, and a
    // pin pressed for the seventh place pointed at a card off the screen.
    const card = railRef.current?.querySelector<HTMLElement>(`[data-slug="${slug}"]`);
    card?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  };

  if (!target) {
    return (
      <p className="mx-auto max-w-[85%] rounded-2xl bg-white/10 px-4 py-2 text-center text-xs text-sand-200">
        {WAIN_AI_CHAT_COPY.noResults} «{query}»
      </p>
    );
  }

  return (
    <div className="space-y-2" data-salem-places="">
      <ul ref={railRef} className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1">
        {places.map((place) => (
          <li
            key={place.slug}
            data-slug={place.slug}
            onPointerEnter={() => choose(place.slug)}
            onFocus={() => choose(place.slug)}
            className={`w-40 shrink-0 snap-start rounded-3xl transition ${
              place.slug === activeSlug ? "ring-2 ring-sun-400 ring-offset-2 ring-offset-sea-950" : ""
            }`}
          >
            <PlaceCard place={place} />
          </li>
        ))}
      </ul>
      <div className="rounded-3xl border border-line bg-white p-4 sm:p-5 text-ink-900">
        <SearchMap places={places} active={activeSlug} onActive={choose} compact />
        <Link
          href={`/search/?q=${encodeURIComponent(query)}`}
          className="mt-2 inline-flex min-h-tap items-center gap-1.5 text-xs font-semibold text-sea-700 underline-offset-2 hover:underline"
        >
          <IconMap className="size-3.5" aria-hidden="true" />
          {WAIN_AI_CHAT_COPY.seeAll}
        </Link>
      </div>
      {/* SearchPlan.tsx's own shape: `choices` only when there is a real
          choice to make, `onChoose` closing over this turn's own state. */}
      <ShareHangout place={target} choices={places.length > 1 ? places.slice(0, CHOICE_MAX) : undefined} onChoose={choose} />
      {chips && chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1" data-followups="">
          <span className="text-xs text-sand-200">{WAIN_AI_CHAT_COPY.followLabel}</span>
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChip?.(c)}
              className="inline-flex min-h-tap items-center rounded-full bg-white/10 px-3 text-sm text-white transition hover:bg-white/20"
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** «وين بالضبط؟» — one place, on the map, with the way there. */
function SalemWhere({ place }: { place: Place }) {
  return (
    <div className="space-y-2 rounded-3xl border border-line bg-white p-4 sm:p-5 text-ink-900">
      <SearchMap places={[place]} active={place.slug} compact />
      <div className="flex flex-wrap gap-2">
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-tap items-center gap-1.5 rounded-xl bg-sea-600 px-4 text-sm font-semibold text-white transition hover:bg-sea-700"
        >
          {WAIN_AI_CHAT_COPY.directions}
          <IconGo className="size-4" aria-hidden="true" />
        </a>
        <Link
          href={`/places/${place.slug}/`}
          className="inline-flex min-h-tap items-center rounded-xl border border-line-control bg-white px-4 text-sm font-semibold text-ink-700 transition hover:border-sea-300 hover:text-sea-700"
        >
          {WAIN_AI_CHAT_COPY.openPlace}
        </Link>
      </div>
    </div>
  );
}

/**
 * His face beside each reply, at the foot of the bubble where the tail is, so
 * a reply reads as said by someone and not as a system line (7 October). The
 * same 144px file the header uses, so it costs no second download.
 */
function ReplyFace() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export, no image optimiser
    <img
      src="/find/salem-face.jpg"
      alt=""
      aria-hidden="true"
      width={144}
      height={144}
      className="size-7 shrink-0 rounded-full object-cover"
    />
  );
}
