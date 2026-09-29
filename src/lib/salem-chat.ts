/**
 * سالم's line — a minimal, hand-rolled client for ElevenLabs Conversational
 * AI's text-only WebSocket protocol.
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
import { SALEM_VOICE_ID, WAIN_AI_AGENT_ID } from "@/lib/wain-ai";

export interface SalemMessage {
  role: "user" | "agent";
  text: string;
}

export type SalemStatus = "connecting" | "connected" | "disconnected" | "error";

export interface SalemChatHandle {
  send: (text: string) => void;
  close: () => void;
}

interface SalemChatCallbacks {
  onStatus: (status: SalemStatus) => void;
  onMessage: (message: SalemMessage) => void;
  /** He tried to call a tool this page has nothing to run — see SalemChat.tsx. */
  onToolUnavailable: () => void;
}

const NOOP_HANDLE: SalemChatHandle = { send: () => {}, close: () => {} };

/**
 * Opens the session and returns a handle immediately — the same
 * fire-then-attach shape `requestCall` uses in `wain-ai-bus.ts`, so a caller
 * can send the socket to a ref before the connection settles.
 */
export function startSalemChat({
  onStatus,
  onMessage,
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
  onStatus("connecting");

  socket.addEventListener("open", () => {
    // The one message the server requires before anything else: the
    // overrides this session wants, in the shape `overrides.ts` in the
    // published SDK constructs it. `text_only` is what keeps the server
    // from ever opening a mic/audio track on its side; `voice_id` is
    // cosmetic here (a text session renders no audio) but costs nothing to
    // set, and keeps this session's override shape identical to the
    // mid-call voice-swap's.
    socket.send(
      JSON.stringify({
        type: "conversation_initiation_client_data",
        conversation_config_override: {
          tts: { voice_id: SALEM_VOICE_ID },
          conversation: { text_only: true },
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
        onStatus("connected");
        return;
      case "agent_response": {
        const evt = data.agent_response_event as { agent_response?: string } | undefined;
        if (evt?.agent_response) onMessage({ role: "agent", text: evt.agent_response });
        return;
      }
      case "ping": {
        const evt = data.ping_event as { event_id?: number } | undefined;
        socket.send(JSON.stringify({ type: "pong", event_id: evt?.event_id }));
        return;
      }
      case "client_tool_call": {
        // show_places / open_place need the catalogue and the live map,
        // which this page deliberately does not carry — see SalemChat.tsx.
        // Answering with an error, the same shape the real SDK sends for an
        // unregistered tool, resolves the call instead of leaving the agent
        // waiting on a reply that never comes; she can then say so.
        const evt = data.client_tool_call as { tool_call_id?: string } | undefined;
        socket.send(
          JSON.stringify({
            type: "client_tool_result",
            tool_call_id: evt?.tool_call_id,
            result: "not available in text chat",
            is_error: true,
          })
        );
        onToolUnavailable();
        return;
      }
      default:
        // interruption, agent_response_correction, user_transcript,
        // vad_score, internal_tentative_agent_response: all meaningful for
        // an audio call, none of them change what a typed transcript shows.
        return;
    }
  });

  socket.addEventListener("close", (event) => {
    if (deliberatelyClosed) return;
    onStatus(event.code === 1000 ? "disconnected" : "error");
  });

  socket.addEventListener("error", () => {
    onStatus("error");
  });

  return {
    send(text: string) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "user_message", text }));
      }
    },
    close() {
      deliberatelyClosed = true;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, "user closed chat");
      }
    },
  };
}
