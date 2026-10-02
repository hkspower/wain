/// The typed conversation with شوق — a plain WebSocket, not the SDK.
///
/// The wire protocol is read out of ElevenLabs' published client and written
/// as plain socket calls, for the same reason the web does: a text chat needs
/// the handshake, `user_message`/`agent_response`, the ping keepalive and an
/// answer to every tool call — and nothing of the audio stack the SDK drags in.
///
/// The override carries `conversation.text_only` and the `tts.voice_id` of
/// سالم — the latest decision (his identity is back on /find and /salem). The
/// agent behind it is still شوق's, prompt and all; that tension is accepted
/// and recorded in CLAUDE.md, not hidden here.
library;

import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import 'config.dart';

class ChatMessage {
  /// "user" | "agent"
  final String role;
  final String text;
  const ChatMessage(this.role, this.text);
}

enum ChatStatus { connecting, connected, disconnected, error }

typedef ChatTool = FutureOr<String> Function(Map<String, dynamic> parameters);

/// Who is calling, from the server's own list (`conversation_initiation_source`).
/// «wain-salem-chat» until 1 October, a name the server does not know — and no
/// typed conversation was ever recorded. The Flutter SDK sends «flutter_sdk».
const _source = 'flutter_sdk';

/// What a bubble shows of her reply — the web's `cleanReply`, ported.
///
/// Voice directions first: «[happy]», «[warm]», «[laughs softly]». Her TTS
/// went to eleven_v4_turbo with expressive mode on (2 October), which has the
/// model write them for the voice to act on, and this socket hands over the raw
/// text — the next test suite had them in 32 replies. Latin letters only, so an
/// Arabic phrase in brackets stays. Then the phone filler («ثانية وحدة…», the
/// 3s soft timeout): at the head of a reply it goes, and a reply that is only
/// the filler comes back empty and draws nothing — she is still working.
String cleanReply(String text) => text
    .replaceAll(RegExp(r"\[[a-zA-Z][a-zA-Z' -]{0,30}\]"), ' ')
    .replaceAll(RegExp(r'[ \t]{2,}'), ' ')
    .trim()
    .replaceFirst(RegExp(r'^\s*ثانية\s+وحدة\s*[….،.]*\s*'), '')
    .trim();

/// The server refused for something no retry this minute changes — the
/// account out of credits, as every conversation was on 2 October («[quota_
/// exceeded] You've run out of credits»). The web's `isUnavailable`, ported.
bool isUnavailable(String reason) => RegExp(
  r'quota_exceeded|run out of credits|insufficient[_ ]credits',
  caseSensitive: false,
).hasMatch(reason);

typedef ChannelFactory = WebSocketChannel Function(
  Uri uri,
  Iterable<String> protocols,
);

WebSocketChannel defaultChannel(Uri uri, Iterable<String> protocols) =>
    WebSocketChannel.connect(uri, protocols: protocols);

const Duration kConnectTimeout = Duration(seconds: 12);

class ChatHandle {
  final void Function(String text) send;
  final void Function() close;
  const ChatHandle({required this.send, required this.close});
}

const ChatHandle _noop = ChatHandle(send: _ignore, close: _ignore0);
void _ignore(String _) {}
void _ignore0() {}

ChatHandle startSalemChat({
  required void Function(ChatStatus) onStatus,
  required void Function(ChatMessage) onMessage,
  required void Function() onToolUnavailable,

  /// Called just before the error status when the server said why it
  /// refused and the reason is [isUnavailable].
  void Function()? onUnavailable,
  Map<String, ChatTool>? clientTools,
  String? agentId,
  ChannelFactory connect = defaultChannel,
  Duration connectTimeout = kConnectTimeout,
}) {
  final id = agentId ?? kAgentId;
  if (id.isEmpty) {
    onStatus(ChatStatus.error);
    return _noop;
  }

  final uri = Uri.parse(
    'wss://api.elevenlabs.io/v1/convai/conversation'
    '?agent_id=${Uri.encodeQueryComponent(id)}&source=$_source&version=1',
  );
  final WebSocketChannel channel;
  try {
    channel = connect(uri, const ['convai']);
  } catch (_) {
    onStatus(ChatStatus.error);
    return _noop;
  }

  var deliberatelyClosed = false;
  var settled = false;
  // Set once the server has said why it refused, so the close that follows
  // cannot overwrite it with a guess.
  var unavailable = false;
  onStatus(ChatStatus.connecting);

  Timer? timer;
  timer = Timer(connectTimeout, () {
    if (settled) return;
    settled = true;
    deliberatelyClosed = true;
    onStatus(ChatStatus.error);
    channel.sink.close();
  });

  void sendJson(Map<String, dynamic> m) {
    try {
      channel.sink.add(jsonEncode(m));
    } catch (_) {
      /* a closed socket: nothing to tell */
    }
  }

  // The handshake goes out as soon as the socket is ready.
  channel.ready
      .then((_) {
        sendJson({
          'type': 'conversation_initiation_client_data',
          'conversation_config_override': {
            'conversation': {'text_only': true},
            'tts': {'voice_id': kSalemVoiceId},
          },
          'source_info': {'source': _source, 'version': '1'},
        });
      })
      .catchError((_) {
        if (settled || deliberatelyClosed) return;
        settled = true;
        timer?.cancel();
        onStatus(ChatStatus.error);
      });

  channel.stream.listen(
    (event) {
      Map<String, dynamic> data;
      try {
        final decoded = jsonDecode(event as String);
        if (decoded is! Map<String, dynamic>) return;
        data = decoded;
      } catch (_) {
        return;
      }
      switch (data['type']) {
        case 'error' || 'client_error':
          if (isUnavailable(event)) unavailable = true;
        case 'conversation_initiation_metadata':
          settled = true;
          timer?.cancel();
          onStatus(ChatStatus.connected);
        case 'agent_response':
          final evt = data['agent_response_event'];
          final raw = evt is Map ? evt['agent_response'] : null;
          final text = raw is String ? cleanReply(raw) : '';
          if (text.isNotEmpty) onMessage(ChatMessage('agent', text));
        case 'ping':
          final evt = data['ping_event'];
          sendJson({
            'type': 'pong',
            'event_id': evt is Map ? evt['event_id'] : null,
          });
        case 'client_tool_call':
          final evt = data['client_tool_call'];
          if (evt is! Map) return;
          final callId = evt['tool_call_id'];
          final name = evt['tool_name'];
          ChatTool? handler;
          if (name is String) handler = clientTools?[name];
          final run = handler;
          if (run == null) {
            // Answered with an error rather than left to hang, as the real
            // client does for a tool nobody registered.
            sendJson({
              'type': 'client_tool_result',
              'tool_call_id': callId,
              'result': 'not available in text chat',
              'is_error': true,
            });
            onToolUnavailable();
            return;
          }
          final params = evt['parameters'];
          Future<String>.sync(
                () => run(
                  params is Map
                      ? params.cast<String, dynamic>()
                      : <String, dynamic>{},
                ),
              )
              .then(
                (result) => sendJson({
                  'type': 'client_tool_result',
                  'tool_call_id': callId,
                  'result': result,
                  'is_error': false,
                }),
              )
              .catchError(
                (Object err) => sendJson({
                  'type': 'client_tool_result',
                  'tool_call_id': callId,
                  'result': err.toString(),
                  'is_error': true,
                }),
              );
      }
    },
    onError: (_) {
      settled = true;
      timer?.cancel();
      if (deliberatelyClosed) return;
      if (unavailable) onUnavailable?.call();
      onStatus(ChatStatus.error);
    },
    onDone: () {
      timer?.cancel();
      if (isUnavailable(channel.closeReason ?? '')) unavailable = true;
      if (deliberatelyClosed) return;
      settled = true;
      if (unavailable) {
        onUnavailable?.call();
        onStatus(ChatStatus.error);
        return;
      }
      onStatus(
        channel.closeCode == 1000 ? ChatStatus.disconnected : ChatStatus.error,
      );
    },
  );

  return ChatHandle(
    send: (text) => sendJson({'type': 'user_message', 'text': text}),
    close: () {
      deliberatelyClosed = true;
      timer?.cancel();
      channel.sink.close(1000, 'user closed chat');
    },
  );
}
