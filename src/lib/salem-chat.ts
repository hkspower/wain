/**
 * سالم's typed chat — a minimal, hand-rolled client for ElevenLabs
 * Conversational AI's text-only WebSocket protocol. The agent behind it is his
 * own (`SALEM_AGENT_ID`), never شوق's: the two never share a socket, a prompt
 * or a voice (14 October, the owner's decision).
 *
 * This socket sends no voice override. His agent speaks in its own voice, and
 * a text-only session renders no audio anyway. Until 14 October it sent
 * `tts.voice_id` on شوق's agent, which is the mix that is gone now.
 *
 * Not the `@elevenlabs/client` SDK. Importing just its `TextConversation`
 * still pulls in the SDK's own connection factory, which references
 * `WebRTCConnection` unconditionally (a `switch` branch, not a dynamic
 * import) and therefore `livekit-client` — measured at 148KB gzipped for a
 * bundle that, for a text-only session, never opens anything but a plain
 * WebSocket. Same call the MCP server already made (`mcp/wain-mcp.mjs`'s own
 * comment): write the transport out rather than carry the parts an SDK
 * bundles for every caller, not just this one.
 *
 * The wire shapes below were read out of the published `@elevenlabs/client`
 * source on the npm registry, which is reachable from here — `api.
 * elevenlabs.io` itself is not, so nothing below has been exercised against
 * a live agent from this session. Same limitation every ElevenLabs feature in
 * this repository carries; say so rather than claim more.
 */
import { SALEM_AGENT_ID } from "@/lib/wain-ai";
import { isQuotaRefusal } from "@/lib/agent-health";

export interface SalemMessage {
  role: "user" | "agent";
  text: string;
}

export type SalemStatus = "connecting" | "connected" | "disconnected" | "error";

/**
 * WHY a session failed, for the status "error" only. One sentence for all
 * three was wrong for each of them: a timeout is usually the network, a
 * refusal at the handshake is not something a retry fixes on the spot, and a
 * socket that dies in the middle of a conversation is neither.
 */
export type SalemFailure = "timeout" | "refused" | "dropped" | "unavailable" | "interrupted";

/*
 * «interrupted»: the page was in the background while the line was opening,
 * and the line then failed or ran out of time. iOS suspends a page within
 * seconds of the visitor switching app or locking the phone, so the timer
 * comes due, or the socket closes, with nothing from the server behind it.
 * That is not the agent's answer, and treating it as one switched her off on
 * the device for a quarter of an hour (8 October) — the page tries again.
 */

/**
 * The server said no for a reason no retry on this page can change: the
 * account is out of credits. Measured, 2 October — every conversation that
 * afternoon, typed and called, ended at 0 s with `error.code 3000`, «[quota_
 * exceeded] You've run out of credits…», and the page said «جرّب مرة ثانية»
 * over a door that would stay shut until somebody topped the account up.
 * The reason reaches the client as the WebSocket's close reason (the SDK this
 * was read out of hands it on as the error message); a message carrying the
 * same text is read the same way in case it arrives first.
 */
export function isUnavailable(reason: string): boolean {
  return isQuotaRefusal(reason);
}

export interface SalemChatHandle {
  /**
   * Returns whether the message actually left. It used to return nothing and
   * drop the text silently on a socket that was not open, after the page had
   * already drawn the visitor's bubble — a sent message that never was.
   */
  send: (text: string) => boolean;
  close: () => void;
}

/**
 * One client tool's implementation: takes the agent's own parameters,
 * returns (or resolves to) the string that goes back to her as the tool
 * result — exactly the contract `WainAiCall.tsx`'s `clientTools` already
 * follow, so `show_places`/`open_place` read the same when wired here as
 * they do on a call. Anything the handler throws is sent back as an error
 * result rather than left unanswered.
 */
type SalemClientTool = (parameters: Record<string, unknown>) => Promise<string> | string;

interface SalemChatCallbacks {
  onStatus: (status: SalemStatus, failure?: SalemFailure) => void;
  onMessage: (message: SalemMessage) => void;
  /**
   * true from the moment a message is sent until her reply (or the end of the
   * session) — what the page draws as «typing». Optional, so a caller that does
   * not draw one is unaffected.
   */
  onPending?: (pending: boolean) => void;
  /**
   * She corrected something she had already said. The wire shape is
   * `agent_response_correction_event: { original_agent_response,
   * corrected_agent_response, event_id }`, read out of `@elevenlabs/types`; the
   * agent's `client_events` list includes the event, so it does arrive.
   */
  onCorrection?: (correction: { original: string; corrected: string }) => void;
  /** The reply never came and the typing state ended by timeout. */
  onNoReply?: () => void;
  /**
   * The server says she is slow: her soft-timeout filler arrived on its own,
   * which it sends after 3s of silence. The page's own 10s timer is the
   * backstop for a channel that never sends it.
   */
  onSlow?: () => void;
  /**
   * Tools this page can actually run, keyed by name — `SalemChat.tsx` passes
   * `show_places`/`open_place` here once it carries `usePlaces()`. A tool
   * she calls that is NOT in this map (or when this option is left out
   * entirely) is answered with an error instead of left to hang — the same
   * shape the real SDK sends for an unregistered tool — and `onToolUnavailable`
   * fires so the page can say so in the transcript.
   */
  clientTools?: Record<string, SalemClientTool>;
  onToolUnavailable: () => void;
}

/**
 * The agent's soft-timeout filler («ثانية وحدة…», `soft_timeout_config.message`,
 * 3s) exists to fill silence on a PHONE. Typed, it would sit in a bubble at the
 * head of every slow answer, or as a bubble of its own, as if she had finished.
 * A test run of her showed it captured at the front of a reply ahead of the
 * real text. Whether the text channel sends it separately is not something
 * this session could see (the socket is refused here), so both shapes are
 * handled: a reply that is only the filler is ignored — she is still working —
 * and one that opens with it loses it.
 */
export function stripFiller(text: string): string {
  return text.replace(/^\s*ثانية\s+وحدة\s*[….،.]*\s*/u, "").trim();
}

/**
 * Voice-direction tags — «[happy]», «[warm]», «[laughs softly]». The agent's
 * TTS went to eleven_v4_turbo with `expressive_mode` on (2 October), which
 * tells the model to write them for the voice to act on; the call widget hides
 * them (`strip_audio_tags`), but this socket hands over the raw text, and the
 * very next suite had them in 32 of her replies — «[sad] ما عندي مطعم ياباني…».
 * Latin letters only, so an Arabic phrase someone puts in brackets survives.
 */
export function stripAudioTags(text: string): string {
  return text
    .replace(/\[[a-z][a-z' -]{0,30}\]/gi, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** What a bubble shows: no voice directions, no phone filler. */
export function cleanReply(text: string): string {
  return stripFiller(stripAudioTags(text));
}

/**
 * Who is calling, from the server's own list (`conversation_initiation_source`).
 * This said «wain-salem-chat» until 1 October — a name nobody had told the
 * server — and in all that time not one typed conversation was recorded for
 * the agent, while every widget call was, down to the 0-second ones. «js_sdk»
 * is what the SDK this client was read out of sends.
 */
const SOURCE = "js_sdk";

const NOOP_HANDLE: SalemChatHandle = { send: () => false, close: () => {} };

/**
 * How long "نوصّل شوق…" waits before giving up.
 *
 * The socket's own `open`/`close`/`error` events only fire for a connection
 * the network actually resolved one way or the other — a handshake accepted
 * and then left silent (a proxy that ate the request, a malformed init
 * payload dropped without an error) settles NONE of them, so without a timer
 * `status` sits at "connecting" for ever and the input stays disabled with
 * no way out but a reload. The same failure shape already cost the call
 * widget a 20-second dial timeout once (see CLAUDE.md, «loadWidget() … a
 * rejection is deliberately not remembered») — this is that lesson applied
 * to a plain WebSocket instead of a `<script>` tag.
 */
const CONNECT_TIMEOUT_MS = 12000;

/**
 * A reply that never comes must not leave the typing indicator, and the send
 * button it disables, up for ever. Generous: the agent can call a tool first.
 */
const PENDING_TIMEOUT_MS = 45000;

/**
 * Opens the session and returns a handle immediately — the same
 * fire-then-attach shape `requestCall` uses in `wain-ai-bus.ts`, so a caller
 * can send the socket to a ref before the connection settles.
 */
export function startSalemChat({
  onStatus,
  onMessage,
  onPending,
  onCorrection,
  onNoReply,
  onSlow,
  clientTools,
  onToolUnavailable,
}: SalemChatCallbacks): SalemChatHandle {
  if (!SALEM_AGENT_ID) {
    onStatus("error");
    return NOOP_HANDLE;
  }

  const url =
    `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(SALEM_AGENT_ID)}` +
    `&source=${SOURCE}&version=1`;

  let socket: WebSocket;
  try {
    socket = new WebSocket(url, ["convai"]);
  } catch {
    onStatus("error");
    return NOOP_HANDLE;
  }

  let deliberatelyClosed = false;
  let settled = false;
  // Whether the handshake ever completed — it is what tells a refusal from a
  // connection that dropped mid-conversation.
  let wasConnected = false;
  let pending = false;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  const setPending = (next: boolean) => {
    clearTimeout(pendingTimer);
    if (next)
      pendingTimer = setTimeout(() => {
        if (pending) onNoReply?.();
        setPending(false);
      }, PENDING_TIMEOUT_MS);
    if (pending === next) return;
    pending = next;
    onPending?.(next);
  };
  // Set once the server has said why, so the `error`/`close` pair that
  // follows cannot overwrite it with a guess.
  let unavailable = false;
  // Whether the page has been out of sight since this line started opening.
  const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
  let wasHidden = hidden();
  const onVisibility = () => {
    if (hidden()) wasHidden = true;
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  const failure = (): SalemFailure =>
    unavailable ? "unavailable" : wasConnected ? "dropped" : wasHidden ? "interrupted" : "refused";
  onStatus("connecting");

  const connectTimer = setTimeout(() => {
    if (settled) return;
    settled = true;
    onStatus("error", wasHidden ? "interrupted" : "timeout");
    deliberatelyClosed = true;
    socket.close();
  }, CONNECT_TIMEOUT_MS);
  // Only the opening needs to know; a line that is up has its own failures.
  const stopWatching = () => {
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  };

  socket.addEventListener("open", () => {
    // The one message the server requires before anything else: the
    // overrides this session wants, in the shape `overrides.ts` in the
    // published SDK constructs it. `text_only` is what keeps the server
    // from ever opening a mic/audio track on its side. No voice override:
    // the agent's own voice applies (see this file's header).
    socket.send(
      JSON.stringify({
        type: "conversation_initiation_client_data",
        conversation_config_override: { conversation: { text_only: true } },
        source_info: { source: SOURCE, version: "1" },
      })
    );
  });

  socket.addEventListener("message", (event) => {
    let data: { type?: string; [k: string]: unknown };
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data.type === "error" || data.type === "client_error") {
      // A refusal for credits sent as a message ends the session here. The
      // SDK treats an `error` event as non-fatal, so the server may keep the
      // socket open, and waiting for its close left the page on «طوّلنا نوصله
      // — تأكد من النت» (the connect timer) or «ما وصلنا رد» (45 s later).
      if (!isUnavailable(JSON.stringify(data))) return;
      unavailable = true;
      if (deliberatelyClosed) return;
      settled = true;
      deliberatelyClosed = true;
      clearTimeout(connectTimer);
      setPending(false);
      socket.close(1000, "unavailable");
      onStatus("error", "unavailable");
      return;
    }
    switch (data.type) {
      case "conversation_initiation_metadata":
        settled = true;
        wasConnected = true;
        clearTimeout(connectTimer);
        stopWatching();
        onStatus("connected");
        return;
      case "agent_response": {
        const evt = data.agent_response_event as { agent_response?: string } | undefined;
        const text = cleanReply(evt?.agent_response ?? "");
        // Only the filler: she is still working, so the typing state stays —
        // and it is the server telling us she is slow, three seconds in,
        // where the page's own hint used to wait ten.
        if (!text && evt?.agent_response) {
          if (pending) onSlow?.();
          return;
        }
        setPending(false);
        if (text) onMessage({ role: "agent", text });
        return;
      }
      case "agent_response_correction": {
        const evt = data.agent_response_correction_event as
          | { original_agent_response?: string; corrected_agent_response?: string }
          | undefined;
        if (evt?.corrected_agent_response) {
          // Both sides cleaned, or the original no longer matches the bubble
          // it is meant to find.
          onCorrection?.({
            original: cleanReply(evt.original_agent_response ?? ""),
            corrected: cleanReply(evt.corrected_agent_response),
          });
        }
        return;
      }
      case "ping": {
        const evt = data.ping_event as { event_id?: number } | undefined;
        socket.send(JSON.stringify({ type: "pong", event_id: evt?.event_id }));
        return;
      }
      case "client_tool_call": {
        const evt = data.client_tool_call as
          | { tool_call_id?: string; tool_name?: string; parameters?: Record<string, unknown> }
          | undefined;
        const toolCallId = evt?.tool_call_id;
        const handler = evt?.tool_name ? clientTools?.[evt.tool_name] : undefined;
        // Her sentence before a tool arrives as a reply of its own and ends
        // the typing state, while the tool and her answer after it — two to
        // four seconds on the one real call — are still to come. The dots
        // went away and the box opened in the middle of her turn; a second
        // question typed there crossed the first answer.
        setPending(true);
        if (!handler) {
          // No handler registered for this tool name — the same error shape
          // the real SDK sends for one, so the call resolves instead of
          // leaving the agent waiting on a reply that never comes.
          socket.send(
            JSON.stringify({
              type: "client_tool_result",
              tool_call_id: toolCallId,
              result: "not available in text chat",
              is_error: true,
            })
          );
          onToolUnavailable();
          return;
        }
        Promise.resolve()
          .then(() => handler(evt?.parameters ?? {}))
          .then((result) => {
            socket.send(
              JSON.stringify({ type: "client_tool_result", tool_call_id: toolCallId, result, is_error: false })
            );
          })
          .catch((err) => {
            socket.send(
              JSON.stringify({
                type: "client_tool_result",
                tool_call_id: toolCallId,
                result: err instanceof Error ? err.message : String(err),
                is_error: true,
              })
            );
          });
        return;
      }
      default:
        // interruption, user_transcript, vad_score,
        // internal_tentative_agent_response: all meaningful for an audio call,
        // none of them change what a typed transcript shows. (The corrections
        // above DO: they replace text the visitor has already read.)
        return;
    }
  });

  socket.addEventListener("close", (event) => {
    clearTimeout(connectTimer);
    stopWatching();
    setPending(false);
    if (isUnavailable(event.reason ?? "")) unavailable = true;
    if (deliberatelyClosed) return;
    settled = true;
    if (unavailable) onStatus("error", "unavailable");
    else if (event.code === 1000) onStatus("disconnected");
    else onStatus("error", failure());
  });

  socket.addEventListener("error", () => {
    // Closing a socket that is still connecting (the connect timeout, or the
    // visitor leaving) fires `error` too; the reason was already given.
    if (deliberatelyClosed) return;
    settled = true;
    clearTimeout(connectTimer);
    setPending(false);
    onStatus("error", failure());
  });

  return {
    send(text: string) {
      if (socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify({ type: "user_message", text }));
      setPending(true);
      return true;
    },
    close() {
      deliberatelyClosed = true;
      clearTimeout(connectTimer);
      stopWatching();
      setPending(false);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, "user closed chat");
      }
    },
  };
}
