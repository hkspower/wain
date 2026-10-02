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
  FakeRecognizer({this.available = true});
  final bool available;
  void Function(String words, bool isFinal)? say;
  String? locale;
  bool stopped = false;

  @override
  Future<bool> init({required void Function(String error) onError}) async =>
      available;

  @override
  Future<void> listen({
    required String localeId,
    required void Function(String words, bool isFinal) onWords,
  }) async {
    locale = localeId;
    say = onWords;
  }

  @override
  Future<void> stop() async => stopped = true;
}

void main() {
  late List<String> went;
  late List<String> answered;

  CallController controllerWith(FakeRecognizer rec) {
    late CallController c;
    c = CallController(
      local: true,
      sessionFactory: () => LocalSession(
        recognizer: rec,
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
