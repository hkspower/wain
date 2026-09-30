/// [AgentSession] over the official ElevenLabs Flutter SDK (WebRTC via LiveKit).
library;

import 'dart:async';

import 'package:elevenlabs_agents/elevenlabs_agents.dart';
import 'package:permission_handler/permission_handler.dart';

import 'call_controller.dart';

class ElevenLabsSession implements AgentSession {
  ConversationClient? _client;
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
    String? voiceId,
    required Map<String, ToolHandler> tools,
  }) async {
    final client = ConversationClient(
      clientTools: {for (final e in tools.entries) e.key: _Tool(e.value)},
      callbacks: ConversationCallbacks(
        onConnect: ({required conversationId}) => _onConnected?.call(),
        onDisconnect: (_) => _onDisconnected?.call(),
        onModeChange: ({required mode}) =>
            _onSpeaking?.call(mode == ConversationMode.speaking),
        onError: (message, [context]) => _onError?.call(message),
      ),
    );
    _client = client;
    await client.startSession(
      agentId: agentId,
      overrides: voiceId == null
          ? null
          : ConversationOverrides(tts: TtsOverrides(voiceId: voiceId)),
    );
  }

  @override
  Future<void> end() async => _client?.endSession();

  @override
  void dispose() {
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
    return MicResult.denied;
  } catch (_) {
    return MicResult.ok;
  }
}
