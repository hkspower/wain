/// شوق's FREE call — the phone's own speech recognition, our own search, the
/// phone's own voice. No ElevenLabs, no network of ours, no credits.
///
/// The live app is the free build since 2 October (config.dart): the paid
/// agent's account ran dry and a live call showed its English quota error over
/// our own sheet. This is the app's half of the website's local mode
/// (`WainAiCall.tsx`): listen once, hand what was heard to the same
/// `show_places` tool the agent drives (it opens /search with the words), and
/// end — the search screen speaks its own answer once voice is on.
///
/// It sits behind [AgentSession] so the controller, the sheet and every test
/// of them stay as they are; only `main.dart` chooses which session to build.
library;

import 'dart:async';

import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart';

import 'call_controller.dart';

/// The device recogniser, narrowed to what a call uses — so a test can drive
/// it without a microphone or a platform channel.
abstract class Recognizer {
  Future<bool> init({required void Function(String error) onError});

  /// Listens once; [onWords] gets every partial and the final result.
  Future<void> listen({
    required String localeId,
    required void Function(String words, bool isFinal) onWords,
  });
  Future<void> stop();
}

class DeviceRecognizer implements Recognizer {
  final SpeechToText _stt = SpeechToText();

  @override
  Future<bool> init({required void Function(String error) onError}) =>
      _stt.initialize(onError: (e) => onError(e.errorMsg));

  @override
  Future<void> listen({
    required String localeId,
    required void Function(String words, bool isFinal) onWords,
  }) => _stt.listen(
    onResult: (SpeechRecognitionResult r) =>
        onWords(r.recognizedWords, r.finalResult),
    listenOptions: SpeechListenOptions(
      partialResults: true,
      listenMode: ListenMode.search,
      cancelOnError: true,
      localeId: localeId,
      listenFor: const Duration(seconds: 15),
      pauseFor: const Duration(seconds: 3),
    ),
  );

  @override
  Future<void> stop() => _stt.stop();
}

/// What the controller shows while she listens — the words as they arrive.
typedef HeardListener = void Function(String words);

class LocalSession implements AgentSession {
  LocalSession({
    Recognizer? recognizer,
    this.onHeard,
    this.onAnswered,
    this.answerDelay = const Duration(milliseconds: 700),
  }) : _rec = recognizer ?? DeviceRecognizer();

  final Recognizer _rec;

  /// Every partial transcript, for the sheet.
  final HeardListener? onHeard;

  /// The final words, after the search has opened — main.dart turns the
  /// spoken answer on here, the way the web's call does.
  final void Function(String words)? onAnswered;

  /// How long «شوق ترد…» shows before the sheet gets out of the way.
  final Duration answerDelay;

  /// The language her ear is set to: Kuwaiti Arabic, as on the web
  /// (`SPEECH_LANG` in speech.ts). A device without it falls back to its own
  /// Arabic, which the plugin handles.
  static const String localeId = 'ar_KW';

  void Function()? _connected;
  void Function(bool)? _speaking;
  void Function()? _disconnected;
  void Function(String)? _error;
  bool _done = false;
  Timer? _answer;

  @override
  void listen({
    required void Function() onConnected,
    required void Function(bool speaking) onSpeaking,
    required void Function() onDisconnected,
    required void Function(String message) onError,
  }) {
    _connected = onConnected;
    _speaking = onSpeaking;
    _disconnected = onDisconnected;
    _error = onError;
  }

  @override
  Future<void> start({
    required String agentId,
    String? voiceId,
    required Map<String, ToolHandler> tools,
  }) async {
    // No speech service, or its permission refused: said as a failure while
    // still «ringing», which the controller turns into a sentence.
    final ok = await _rec.init(onError: (_) => _finish(error: 'recognizer'));
    if (_done) return;
    if (!ok) {
      _done = true;
      _error?.call('unavailable');
      return;
    }
    _connected?.call();
    var heard = '';
    await _rec.listen(
      localeId: localeId,
      onWords: (words, isFinal) async {
        if (_done) return;
        heard = words.trim();
        onHeard?.call(heard);
        if (!isFinal) return;
        if (heard.isEmpty) {
          _finish(error: kNoSpeech);
          return;
        }
        _speaking?.call(true);
        await tools['show_places']?.call({'query': heard});
        onAnswered?.call(heard);
        _answer = Timer(answerDelay, _finish);
      },
    );
  }

  void _finish({String? error}) {
    if (_done) return;
    _done = true;
    _answer?.cancel();
    if (error != null) {
      _error?.call(error);
    } else {
      _disconnected?.call();
    }
  }

  @override
  Future<void> end() async {
    _done = true;
    _answer?.cancel();
    await _rec.stop();
  }

  @override
  void dispose() {
    _done = true;
    _answer?.cancel();
  }
}

/// The error a free call reports when it heard nothing — the controller says
/// «ما سمعناك» for it rather than ending the call silently.
const String kNoSpeech = 'no_speech';
