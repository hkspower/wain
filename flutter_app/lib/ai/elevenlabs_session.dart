/// [AgentSession] over the official ElevenLabs Flutter SDK (WebRTC via LiveKit).
library;

import 'dart:async';

import 'package:elevenlabs_agents/elevenlabs_agents.dart';
import 'package:permission_handler/permission_handler.dart';

import 'call_controller.dart';

/// What the session uses of the SDK's [ConversationClient]. A seam: the order
/// of [ElevenLabsSession.tell] and the client's own `connected`, and what a
/// failed update does to the call, are tested without a LiveKit room.
abstract class AgentLine {
  ConversationStatus get status;
  Future<void> startSession({required String agentId});
  void sendContextualUpdate(String text);
  Future<void> endSession();
  void dispose();
}

typedef AgentLineFactory = AgentLine Function(
  ConversationCallbacks callbacks,
  Map<String, ClientTool> tools,
);

class _SdkLine implements AgentLine {
  _SdkLine(ConversationCallbacks callbacks, Map<String, ClientTool> tools)
    : _client = ConversationClient(clientTools: tools, callbacks: callbacks);
  final ConversationClient _client;

  @override
  ConversationStatus get status => _client.status;
  @override
  Future<void> startSession({required String agentId}) =>
      _client.startSession(agentId: agentId);
  @override
  void sendContextualUpdate(String text) => _client.sendContextualUpdate(text);
  @override
  Future<void> endSession() => _client.endSession();
  @override
  void dispose() => _client.dispose();
}

/// How elevenlabs_agents 0.6.1 reports a contextual update that did not go
/// out — twice (conversation_client.dart, livekit_manager.dart,
/// message_handler.dart): this from the send itself, and [_dataStreamError]
/// from the data channel it failed on, carrying [_sendFailed].
const _updateFailed = 'Failed to send contextual update';
const _dataStreamError = 'Data stream error';
const _sendFailed = 'Failed to send message';

class ElevenLabsSession implements AgentSession {
  /// [line] is the SDK's client unless a test hands in its own.
  ElevenLabsSession({AgentLineFactory? line}) : _line = line ?? _SdkLine.new;
  final AgentLineFactory _line;
  AgentLine? _client;
  void Function()? _onConnected;
  void Function(bool)? _onSpeaking;
  void Function()? _onDisconnected;
  void Function(String)? _onError;

  @override
  void listen({
    required void Function() onConnected,
    required void Function(bool speaking) onSpeaking,
    required void Function() onDisconnected,
    required void Function(String message) onError,
  }) {
    _onConnected = onConnected;
    _onSpeaking = onSpeaking;
    _onDisconnected = onDisconnected;
    _onError = onError;
  }

  @override
  Future<void> start({
    required String agentId,
    required Map<String, ToolHandler> tools,
  }) async {
    final client = _line(
      ConversationCallbacks(
        onConnect: ({required conversationId}) => _onConnected?.call(),
        // A line told something before the client calls itself connected
        // gets it the moment it does (see [tell]).
        onStatusChange: ({required status}) {
          if (status == ConversationStatus.connected) _flush();
        },
        onDisconnect: (_) => _onDisconnected?.call(),
        onModeChange: ({required mode}) =>
            _onSpeaking?.call(mode == ConversationMode.speaking),
        onError: _error,
      ),
      {for (final e in tools.entries) e.key: _Tool(e.value)},
    );
    _client = client;
    // No overrides: the agent's own voice and settings, for either persona.
    await client.startSession(agentId: agentId);
  }

  /// What was told before the line could take it.
  String? _untold;

  /// `sendContextualUpdate` (elevenlabs_agents 0.6.1) THROWS unless the
  /// client's own status is `connected`, and that status is set only after
  /// `startSession` has sent its overrides — while the controller is told
  /// «connected» by `onConnect`, which is the server's conversation metadata.
  /// The metadata answers the overrides, so it should come second; a race the
  /// other way would have thrown out of the controller's handler, so the
  /// text waits for the status instead (read out of conversation_client.dart).
  @override
  void tell(String text) {
    _untold = text;
    _flush();
  }

  void _flush() {
    final client = _client;
    final text = _untold;
    if (client == null || text == null) return;
    if (client.status != ConversationStatus.connected) return;
    _untold = null;
    try {
      client.sendContextualUpdate(text);
    } catch (_) {
      // Only `_ensureConnected` throws here, and the check above rules it
      // out; a send that fails does so later, as two errors (see [_error]).
    }
  }

  /// A data-channel failure held back to see whether it was the update's.
  Timer? _heldSendError;

  /// The update's own failure was just reported; the data channel's report of
  /// the same send may still be on its way.
  bool _updateJustFailed = false;

  /// Errors on their way to the controller, which ends a live agent call on
  /// any of them — so a background note the agent was never going to answer
  /// hung up a call that was otherwise fine. A failed update is reported
  /// twice, and in an order that depends on how Dart completes the SDK's
  /// futures: so whichever of the two comes first opens one turn of the
  /// event loop for the other, and neither reaches the controller. Any other
  /// error goes on as it did; a send failure that turns out not to be the
  /// update's goes on one turn late. Two failed sends in one turn are one
  /// broken channel, reported once — and not at all when one was the update.
  void _error(String message, [dynamic context]) {
    if (message == _updateFailed) {
      _heldSendError?.cancel();
      _heldSendError = null;
      _updateJustFailed = true;
      Timer.run(() => _updateJustFailed = false);
      return;
    }
    if (message == _dataStreamError && '$context'.contains(_sendFailed)) {
      if (_updateJustFailed) return;
      _heldSendError ??= Timer(Duration.zero, () {
        _heldSendError = null;
        _onError?.call(message);
      });
      return;
    }
    _onError?.call(message);
  }

  @override
  Future<void> end() async => _client?.endSession();

  @override
  void dispose() {
    _untold = null;
    _heldSendError?.cancel();
    _heldSendError = null;
    _client?.dispose();
    _client = null;
  }
}

class _Tool implements ClientTool {
  final ToolHandler _handler;
  _Tool(this._handler);

  @override
  Future<ClientToolResult?> execute(Map<String, dynamic> parameters) async {
    try {
      return ClientToolResult.success(await _handler(parameters));
    } catch (e) {
      return ClientToolResult.failure(e.toString());
    }
  }
}

/// The microphone, asked for inside the tap. The browser build has no
/// `permission_handler` backend — it is the browser that prompts, at connect.
Future<MicResult> checkMicrophone() async {
  try {
    final status = await Permission.microphone.request();
    if (status.isGranted || status.isLimited) return MicResult.ok;
    if (status.isPermanentlyDenied || status.isRestricted) {
      return MicResult.blocked;
    }
    return MicResult.denied;
  } catch (_) {
    return MicResult.ok;
  }
}
