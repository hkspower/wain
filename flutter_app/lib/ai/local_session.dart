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

  /// The locales this phone can recognise, as the platform names them.
  Future<List<String>> localeIds();

  /// Listens once; [onWords] gets every partial and the final result. A null
  /// [localeId] is the phone's own language.
  Future<void> listen({
    required String? localeId,
    required void Function(String words, bool isFinal) onWords,
  });
  Future<void> stop();
}

/// The speech plugin, as it actually behaves — which is the part that went
/// wrong. `SpeechToText()` is one object per process, and `initialize` returns
/// at once after the first success, keeping the FIRST call's `onError` for
/// ever. Every call made a new recogniser and passed its own handler, so from
/// the second call on, the phone's errors went to the first call's session,
/// long finished, and were dropped: a call that heard nothing sat «live» with
/// its clock running until the caller hung up (3 October).
abstract class SpeechEngine {
  Future<bool> initialize({required void Function(String error) onError});
  Future<List<String>> localeIds();
  Future<void> listen({
    required String? localeId,
    required void Function(String words, bool isFinal) onWords,
  });
  Future<void> stop();
}

class PluginSpeechEngine implements SpeechEngine {
  PluginSpeechEngine._();
  static final PluginSpeechEngine instance = PluginSpeechEngine._();
  final SpeechToText _stt = SpeechToText();

  @override
  Future<bool> initialize({required void Function(String error) onError}) =>
      _stt.initialize(onError: (e) => onError(e.errorMsg));

  @override
  Future<List<String>> localeIds() async =>
      (await _stt.locales()).map((l) => l.localeId).toList();

  @override
  Future<void> listen({
    required String? localeId,
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

/// One per call, over the one engine: it initialises the engine once, with a
/// handler that forwards to whichever call is current, so each call hears its
/// own errors.
class DeviceRecognizer implements Recognizer {
  DeviceRecognizer([SpeechEngine? engine])
    : _engine = engine ?? PluginSpeechEngine.instance;

  final SpeechEngine _engine;
  static final Expando<Future<bool>> _ready = Expando();
  static final Expando<void Function(String)> _route = Expando();

  @override
  Future<bool> init({required void Function(String error) onError}) async {
    _route[_engine] = onError;
    try {
      final ready = _ready[_engine] ??= _engine.initialize(
        onError: (e) => _route[_engine]?.call(e),
      );
      final ok = await ready;
      if (!ok) _ready[_engine] = null; // a refusal may be lifted next time
      return ok;
    } catch (_) {
      // A phone with no recognition service at all (no Google app, some
      // Huawei phones) THROWS here rather than answering false, and the call
      // said «ما قدرنا نوصلك» instead of «جوالك ما يقدر يسمعك».
      _ready[_engine] = null;
      return false;
    }
  }

  @override
  Future<List<String>> localeIds() => _engine.localeIds();

  @override
  Future<void> listen({
    required String? localeId,
    required void Function(String words, bool isFinal) onWords,
  }) => _engine.listen(localeId: localeId, onWords: onWords);

  @override
  Future<void> stop() => _engine.stop();
}

/// The locale to ask for: Kuwaiti Arabic if the phone has it, then Saudi
/// (Gulf, and the one Apple has), then any Arabic, else the phone's own.
/// `ar_KW` used to be sent whether or not the phone had it, and a phone
/// without it ended the call with no word said.
String? pickLocale(List<String> ids) {
  String norm(String s) => s.replaceAll('-', '_').toLowerCase();
  final byNorm = {for (final id in ids) norm(id): id};
  for (final want in ['ar_kw', 'ar_sa']) {
    if (byNorm[want] != null) return byNorm[want];
  }
  for (final id in ids) {
    if (norm(id).startsWith('ar')) return id;
  }
  return null;
}

/// What the platform calls «heard nothing». Android reports silence as an
/// error, not as an empty result, and it used to end the call as «انتهت
/// المكالمة» instead of saying nothing was heard.
const Set<String> _silence = {
  'error_speech_timeout',
  'error_no_match',
  'error_no_speech',
};

/// What the controller shows while she listens — the words as they arrive.
typedef HeardListener = void Function(String words);

class LocalSession implements AgentSession {
  LocalSession({
    Recognizer? recognizer,
    this.onHeard,
    this.onAnswered,
    this.answerDelay = const Duration(milliseconds: 700),
    this.maxListen = const Duration(seconds: 20),
  }) : _rec = recognizer ?? DeviceRecognizer();

  final Recognizer _rec;

  /// Every partial transcript, for the sheet.
  final HeardListener? onHeard;

  /// The final words, after the search has opened — main.dart turns the
  /// spoken answer on here, the way the web's call does.
  final void Function(String words)? onAnswered;

  /// How long «شوق ترد…» shows before the sheet gets out of the way.
  final Duration answerDelay;

  /// Listening at all: a question is a sentence. The plugin has its own
  /// 15s, which a phone that never reports anything does not honour.
  final Duration maxListen;

  void Function()? _connected;
  void Function(bool)? _speaking;
  void Function()? _disconnected;
  void Function(String)? _error;
  bool _done = false;
  Timer? _answer;
  Timer? _cap;

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
    final ok = await _rec.init(
      onError: (e) =>
          _finish(error: _silence.contains(e) ? kNoSpeech : 'recognizer'),
    );
    if (_done) return;
    if (!ok) {
      _done = true;
      _error?.call('unavailable');
      return;
    }
    final ids = await _rec.localeIds().catchError((_) => <String>[]);
    if (_done) return;
    _connected?.call();
    var heard = '';
    Future<void> answer() async {
      if (_done) return;
      _cap?.cancel();
      _speaking?.call(true);
      await tools['show_places']?.call({'query': heard});
      onAnswered?.call(heard);
      _answer = Timer(answerDelay, _finish);
    }

    _cap = Timer(maxListen, () {
      if (_done) return;
      _rec.stop();
      if (heard.isEmpty) {
        _finish(error: kNoSpeech);
      } else {
        answer();
      }
    });
    await _rec.listen(
      localeId: pickLocale(ids),
      onWords: (words, isFinal) async {
        if (_done) return;
        heard = words.trim();
        onHeard?.call(heard);
        if (!isFinal) return;
        if (heard.isEmpty) {
          _finish(error: kNoSpeech);
          return;
        }
        await answer();
      },
    );
  }

  void _finish({String? error}) {
    if (_done) return;
    _done = true;
    _answer?.cancel();
    _cap?.cancel();
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
    _cap?.cancel();
    await _rec.stop();
  }

  @override
  void dispose() {
    _done = true;
    _answer?.cancel();
    _cap?.cancel();
  }
}

/// The error a free call reports when it heard nothing — the controller says
/// «ما سمعناك» for it rather than ending the call silently.
const String kNoSpeech = 'no_speech';
