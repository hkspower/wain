/**
 * شوق's typed chat — a minimal, hand-rolled client for ElevenLabs
 * Conversational AI's text-only WebSocket protocol, answering as سالم.
 *
 * An earlier version of this page set `SALEM_VOICE_ID` as a `tts.voice_id`
 * override here — cosmetically, since a text-only session never renders
 * audio — then dropped it on request to keep her own voice unchanged. Both
 * of those were correct calls at the time; this is a third pass, not a
 * mistake being repeated: asked again on 30 September, with that history
 * read back first, to bring the override back. It is still cosmetic today
 * (text-only renders no audio either way) and still means something the
 * moment this page ever carries sound — see `SALEM_VOICE_ID`'s own comment
 * in `lib/wain-ai.ts`, which this now shares with `WainAiCall.tsx`'s
 * mid-call switch rather than describing only that one.
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
import { WAIN_AI_AGENT_ID, SALEM_VOICE_ID } from "@/lib/wain-ai";

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
export type SalemFailure = "timeout" | "refused" | "dropped";

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
  clientTools,
  onToolUnavailable,
}: SalemChatCallbacks): SalemChatHandle {
  if (!WAIN_AI_AGENT_ID) {
    onStatus("error");
    return NOOP_HANDLE;
  }

  const url =
    `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(WAIN_AI_AGENT_ID)}` +
    `&source=wain-salem-chat&version=1`;

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
    if (next) pendingTimer = setTimeout(() => setPending(false), PENDING_TIMEOUT_MS);
    if (pending === next) return;
    pending = next;
    onPending?.(next);
  };
  const failure = (): SalemFailure => (wasConnected ? "dropped" : "refused");
  onStatus("connecting");

  const connectTimer = setTimeout(() => {
    if (settled) return;
    settled = true;
    onStatus("error", "timeout");
    deliberatelyClosed = true;
    socket.close();
  }, CONNECT_TIMEOUT_MS);

  socket.addEventListener("open", () => {
    // The one message the server requires before anything else: the
    // overrides this session wants, in the shape `overrides.ts` in the
    // published SDK constructs it. `text_only` is what keeps the server
    // from ever opening a mic/audio track on its side. `tts.voice_id` is
    // back — see this file's own header for the third pass that put it
    // there — and stays cosmetic until this session ever carries audio.
    socket.send(
      JSON.stringify({
        type: "conversation_initiation_client_data",
        conversation_config_override: {
          conversation: { text_only: true },
          tts: { voice_id: SALEM_VOICE_ID },
        },
        source_info: { source: "wain-salem-chat", version: "1" },
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
    switch (data.type) {
      case "conversation_initiation_metadata":
        settled = true;
        wasConnected = true;
        clearTimeout(connectTimer);
        onStatus("connected");
        return;
      case "agent_response": {
        const evt = data.agent_response_event as { agent_response?: string } | undefined;
        setPending(false);
        if (evt?.agent_response) onMessage({ role: "agent", text: evt.agent_response });
        return;
      }
      case "agent_response_correction": {
        const evt = data.agent_response_correction_event as
          | { original_agent_response?: string; corrected_agent_response?: string }
          | undefined;
        if (evt?.corrected_agent_response) {
          onCorrection?.({
            original: evt.original_agent_response ?? "",
            corrected: evt.corrected_agent_response,
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
    setPending(false);
    if (deliberatelyClosed) return;
    settled = true;
    if (event.code === 1000) onStatus("disconnected");
    else onStatus("error", failure());
  });

  socket.addEventListener("error", () => {
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
      setPending(false);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, "user closed chat");
      }
    },
  };
}
