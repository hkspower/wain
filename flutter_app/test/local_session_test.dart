// The free call (lib/ai/local_session.dart) through the real controller, with
// a fake recogniser standing in for the phone's speech service. The live app
// is the free build since 2 October: no agent, no ElevenLabs, no credits.
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/ai/call_controller.dart';
import 'package:wain/ai/config.dart';
import 'package:wain/ai/local_session.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/data/places.g.dart';

class FakeRecognizer implements Recognizer {
  FakeRecognizer({
    this.available = true,
    this.locales = const ['en_US', 'ar_KW', 'ar_SA'],
  });
  final bool available;
  final List<String> locales;
  void Function(String words, bool isFinal)? say;
  void Function(String error)? fail;
  String? locale;
  bool stopped = false;

  @override
  Future<bool> init({required void Function(String error) onError}) async {
    fail = onError;
    return available;
  }

  @override
  Future<List<String>> localeIds() async => locales;

  @override
  Future<void> listen({
    required String? localeId,
    required void Function(String words, bool isFinal) onWords,
  }) async {
    locale = localeId;
    say = onWords;
  }

  @override
  Future<void> stop() async => stopped = true;
}

/// The plugin as it really behaves: one per process, and `initialize` keeps
/// the FIRST handler it was given for ever (speech_to_text 7.5.0).
class PluginLikeEngine implements SpeechEngine {
  PluginLikeEngine({this.throws = false});
  final bool throws;
  void Function(String)? _first;
  void Function(String words, bool isFinal)? say;

  @override
  Future<bool> initialize({
    required void Function(String error) onError,
  }) async {
    if (throws) throw Exception('recognizerNotAvailable');
    _first ??= onError;
    return true;
  }

  void emitError(String e) => _first?.call(e);

  @override
  Future<List<String>> localeIds() async => ['ar_SA'];

  @override
  Future<void> listen({
    required String? localeId,
    required void Function(String words, bool isFinal) onWords,
  }) async => say = onWords;

  @override
  Future<void> stop() async {}
}

void main() {
  late List<String> went;
  late List<String> answered;

  CallController controllerWith(
    Recognizer rec, {
    Recognizer Function()? fresh,
    Duration maxListen = const Duration(seconds: 20),
  }) {
    late CallController c;
    c = CallController(
      local: true,
      sessionFactory: () => LocalSession(
        recognizer: fresh?.call() ?? rec,
        maxListen: maxListen,
        onHeard: (w) => c.hear(w),
        onAnswered: answered.add,
        answerDelay: const Duration(milliseconds: 10),
      ),
      places: kPlaces,
      indexOf: () => searchIndex,
      navigate: went.add,
    );
    return c;
  }

  setUp(() {
    went = [];
    answered = [];
  });

  test(
    'a free call needs no agent: it listens, searches, and gets out of the way',
    () async {
      expect(kAgentId, '', reason: 'the default build is the free one');
      final rec = FakeRecognizer();
      final c = controllerWith(rec);
      await c.start();
      expect(
        c.phase,
        CallPhase.live,
        reason: 'listening, not «failed — no agent»',
      );
      expect(rec.locale, 'ar_KW');

      rec.say!('قه', false);
      expect(c.heard, 'قه', reason: 'the words show as they arrive');
      rec.say!('قهوة', true);
      await Future<void>.delayed(Duration.zero);
      expect(c.phase, CallPhase.answering);
      expect(
        went.single,
        startsWith('/search?q='),
        reason: 'the answer is the search screen',
      );
      expect(Uri.parse(went.single).queryParameters['q'], 'قهوة');
      expect(answered, ['قهوة'], reason: 'the spoken answer is switched on');

      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(c.phase, CallPhase.idle);
      expect(
        c.sheetOpen,
        isFalse,
        reason: 'the sheet steps aside for the results',
      );
      c.dispose();
    },
  );

  test('heard nothing: «ما سمعناك», not a silent end', () async {
    final rec = FakeRecognizer();
    final c = controllerWith(rec);
    await c.start();
    rec.say!('', true);
    await Future<void>.delayed(Duration.zero);
    expect(c.phase, CallPhase.failed);
    expect(c.error, CallCopy.noSpeech);
    expect(went, isEmpty);
    c.dispose();
  });

  test('no speech service on the phone: said, with the way on', () async {
    final c = controllerWith(FakeRecognizer(available: false));
    await c.start();
    expect(c.phase, CallPhase.failed);
    expect(c.error, CallCopy.speechUnavailable);
    c.dispose();
  });

  // 3 October, from a phone: «she doesn't hear me or answer».
  group('what a real phone does', () {
    test(
      'a second call hears its own errors (the plugin keeps the first handler)',
      () async {
        final engine = PluginLikeEngine();
        final c = controllerWith(
          FakeRecognizer(),
          fresh: () => DeviceRecognizer(engine),
        );
        await c.start();
        engine.say!('قهوة', true);
        await Future<void>.delayed(const Duration(milliseconds: 30));
        expect(c.phase, CallPhase.idle, reason: 'the first call answered');

        await c.start();
        expect(c.phase, CallPhase.live);
        engine.emitError('error_no_match');
        await Future<void>.delayed(Duration.zero);
        expect(
          c.phase,
          CallPhase.failed,
          reason: 'the error reaches THIS call, not the first one',
        );
        expect(c.error, CallCopy.noSpeech);
        c.dispose();
      },
    );

    test(
      'silence on Android arrives as an error, and is said as silence',
      () async {
        final rec = FakeRecognizer();
        final c = controllerWith(rec);
        await c.start();
        expect(c.phase, CallPhase.live);
        rec.fail!('error_speech_timeout');
        await Future<void>.delayed(Duration.zero);
        expect(c.phase, CallPhase.failed);
        expect(c.error, CallCopy.noSpeech, reason: 'not «انتهت المكالمة»');
        c.dispose();
      },
    );

    test(
      'any other recogniser failure while live is said, not «ended»',
      () async {
        final rec = FakeRecognizer();
        final c = controllerWith(rec);
        await c.start();
        rec.fail!('error_language_unavailable');
        await Future<void>.delayed(Duration.zero);
        expect(c.phase, CallPhase.failed);
        expect(c.error, CallCopy.speechUnavailable);
        c.dispose();
      },
    );

    test('a phone with no recogniser at all (it throws) is told so', () async {
      final c = controllerWith(
        FakeRecognizer(),
        fresh: () => DeviceRecognizer(PluginLikeEngine(throws: true)),
      );
      await c.start();
      expect(c.phase, CallPhase.failed);
      expect(c.error, CallCopy.speechUnavailable, reason: 'not callFailed');
      c.dispose();
    });

    test('a call that hears nothing at all still ends, and says so', () async {
      final rec = FakeRecognizer();
      final c = controllerWith(
        rec,
        maxListen: const Duration(milliseconds: 40),
      );
      await c.start();
      await Future<void>.delayed(const Duration(milliseconds: 80));
      expect(rec.stopped, isTrue);
      expect(c.phase, CallPhase.failed);
      expect(c.error, CallCopy.noSpeech);
      c.dispose();
    });

    test('the locale is one the phone has', () {
      expect(pickLocale(['en_US', 'ar_KW']), 'ar_KW');
      expect(
        pickLocale(['ar-SA', 'en-US']),
        'ar-SA',
        reason: 'Apple names it with a hyphen',
      );
      expect(
        pickLocale(['ar_EG', 'fr_FR']),
        'ar_EG',
        reason: 'any Arabic beats none',
      );
      expect(pickLocale(['en_US']), isNull, reason: 'else the phone\'s own');
    });
  });

  test(
    'hanging up stops the recogniser and a late word changes nothing',
    () async {
      final rec = FakeRecognizer();
      final c = controllerWith(rec);
      await c.start();
      await c.hangUp();
      expect(rec.stopped, isTrue);
      rec.say!('قهوة', true);
      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(went, isEmpty);
      expect(c.phase, CallPhase.ended);
      c.dispose();
    },
  );
}
