import 'package:flutter_test/flutter_test.dart';
import 'package:wain/ai/call_controller.dart';
import 'package:wain/ai/config.dart';

import 'support.dart';

void main() {
  group('phases are honest', () {
    test('ringing until the session really opens, then live; speaking only when she speaks', () async {
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      expect(c.phase, CallPhase.ringing, reason: 'dialled, not connected');
      expect(c.sheetOpen, isTrue);

      sessions.single.onConnected!();
      expect(c.phase, CallPhase.live);
      sessions.single.onSpeaking!(true);
      expect(c.phase, CallPhase.answering);
      sessions.single.onSpeaking!(false);
      expect(c.phase, CallPhase.live);
      c.dispose();
    });

    test('speaking events before connect are ignored (no mouth on a ringing phone)', () async {
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      sessions.single.onSpeaking!(true);
      expect(c.phase, CallPhase.ringing);
      c.dispose();
    });

    test(
      'the agent id and no voice override go out on a normal call',
      () async {
        final sessions = <FakeSession>[];
        final c = testController(sessions: sessions);
        await c.start();
        expect(sessions.single.startedAgent, 'agent_test');
        expect(sessions.single.voice, isNull);
        expect(
          sessions.single.tools.keys,
          containsAll(['show_places', 'open_place']),
        );
        c.dispose();
      },
    );

    test(
      'hanging up ends and disposes the session and stops the clock',
      () async {
        final sessions = <FakeSession>[];
        final c = testController(sessions: sessions);
        await c.start();
        sessions.single.onConnected!();
        await c.hangUp();
        expect(c.phase, CallPhase.ended);
        expect(sessions.single.ended, isTrue);
        expect(sessions.single.disposed, isTrue);
        c.dispose();
      },
    );

    test(
      'a late event from a hung-up session cannot resurrect the call',
      () async {
        final sessions = <FakeSession>[];
        final c = testController(sessions: sessions);
        await c.start();
        final dead = sessions.single;
        await c.hangUp();
        dead.onConnected!();
        dead.onSpeaking!(true);
        expect(c.phase, CallPhase.ended);
        c.dispose();
      },
    );

    test(
      'a dropped connection ends the call rather than leaving it "live"',
      () async {
        final sessions = <FakeSession>[];
        final c = testController(sessions: sessions);
        await c.start();
        sessions.single.onConnected!();
        sessions.single.onDisconnected!();
        expect(c.phase, CallPhase.ended);
        c.dispose();
      },
    );
  });

  group('failure is a sentence, not silence', () {
    test('a blocked microphone never dials', () async {
      final sessions = <FakeSession>[];
      final c = testController(
        sessions: sessions,
        mic: () async => MicResult.denied,
      );
      await c.start();
      expect(c.phase, CallPhase.failed);
      expect(c.error, CallCopy.micDenied);
      expect(
        sessions,
        isEmpty,
        reason: 'no session is created behind a denied mic',
      );
      c.dispose();
    });

    for (final (mic, text) in [
      (MicResult.missing, CallCopy.noMic),
      (MicResult.busy, CallCopy.micBusy),
    ]) {
      test('mic $mic', () async {
        final c = testController(sessions: [], mic: () async => mic);
        await c.start();
        expect(c.error, text);
        c.dispose();
      });
    }

    test('an unanswered dial times out with its own sentence', () async {
      final sessions = <FakeSession>[];
      final c = testController(
        sessions: sessions,
        dial: const Duration(milliseconds: 40),
      );
      await c.start();
      await Future<void>.delayed(const Duration(milliseconds: 90));
      expect(c.phase, CallPhase.failed);
      expect(c.error, CallCopy.noAnswer);
      expect(sessions.single.ended, isTrue);
      c.dispose();
    });

    test('a start that throws is a failed call', () async {
      final sessions = <FakeSession>[];
      final c = testController(
        sessions: sessions,
        configure: (s) => s.startError = StateError('refused'),
      );
      await c.start();
      expect(c.phase, CallPhase.failed);
      expect(c.error, CallCopy.callFailed);
      expect(sessions.single.disposed, isTrue);
      c.dispose();
    });

    test('an error while still ringing is a failed dial', () async {
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      sessions.single.onError!('socket refused');
      expect(c.phase, CallPhase.failed);
      expect(c.error, CallCopy.callFailed);
      c.dispose();
    });

    test(
      'an error after connecting ends the call, it does not blame the dial',
      () async {
        final sessions = <FakeSession>[];
        final c = testController(sessions: sessions);
        await c.start();
        sessions.single.onConnected!();
        sessions.single.onError!('x');
        expect(c.phase, CallPhase.ended);
        c.dispose();
      },
    );

    test('a second tap while a call is active does nothing', () async {
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      await c.start();
      expect(sessions, hasLength(1));
      c.dispose();
    });
  });

  group('she drives the app', () {
    test('show_places navigates, reports what she did, and tells her what was found', () async {
      final nav = <String>[];
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions, navigate: nav.add);
      await c.start();
      sessions.single.onConnected!();
      final said = await sessions.single.tools['show_places']!({
        'query': 'قهوة',
      });
      expect(nav, ['/search?q=${Uri.encodeQueryComponent('قهوة')}']);
      expect(c.lastAction, startsWith('دوّرت لك «قهوة» — '));
      expect(said, contains('لـ «قهوة» الحين على الخريطة قدام الزائر'));
      expect(said, endsWith('لا تسكتين.'));
      c.dispose();
    });

    test('an empty query changes nothing and says so', () async {
      final nav = <String>[];
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions, navigate: nav.add);
      await c.start();
      final said = await sessions.single.tools['show_places']!({
        'query': '   ',
      });
      expect(said, 'ما وصلت كلمات بحث — ما تغيّر شي على الشاشة.');
      expect(nav, isEmpty);
      expect(c.lastAction, isNull);
      c.dispose();
    });

    test('zero hits: the exact instruction to retry wider', () async {
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      final said = await sessions.single.tools['show_places']!({
        'query': 'صيدلية',
      });
      expect(
        said,
        startsWith(
          'ما لقيت ولا مكان يطابق «صيدلية» — الشاشة الحين تقول «ما لقينا شي». ',
        ),
      );
      expect(said, contains('ونادي show_places مرة ثانية بكلمة أوسع'));
      c.dispose();
    });

    test(
      'open_place opens a known slug and rejects the rest without navigating',
      () async {
        final nav = <String>[];
        final sessions = <FakeSession>[];
        final c = testController(sessions: sessions, navigate: nav.add);
        await c.start();
        final t = sessions.single.tools['open_place']!;
        expect(
          await t({'slug': 'kuwait-towers'}),
          startsWith(
            'صفحة «أبراج الكويت» (kuwait-towers) الحين مفتوحة قدام الزائر',
          ),
        );
        expect(nav, ['/places/kuwait-towers']);
        expect(c.lastAction, 'فتحت لك صفحة «أبراج الكويت»');

        nav.clear();
        expect(
          await t({'slug': '../etc/passwd'}),
          'ما لقيت مكان بهذا المعرّف — ما تغيّر شي على الشاشة.',
        );
        expect(
          await t({'slug': 'no-such-place'}),
          contains('ما فيه مكان بالمعرّف (no-such-place)'),
        );
        expect(nav, isEmpty);
        c.dispose();
      },
    );
  });

  group('the voice swap', () {
    test(
      'reconnects with the override, and a fresh call resets to her own voice',
      () async {
        final sessions = <FakeSession>[];
        final c = testController(sessions: sessions);
        await c.start();
        sessions.last.onConnected!();
        await c.switchVoice();
        expect(sessions, hasLength(2));
        expect(sessions.last.voice, kSalemVoiceId);
        expect(c.salemVoice, isTrue);
        sessions.last.onConnected!();
        await c.hangUp();
        c.closeSheet();
        await c.start();
        expect(
          sessions.last.voice,
          isNull,
          reason: 'every fresh call starts on her voice',
        );
        expect(c.salemVoice, isFalse);
        c.dispose();
      },
    );

    test('cannot swap while still ringing', () async {
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      await c.switchVoice();
      expect(sessions, hasLength(1));
      c.dispose();
    });
  });

  test('resolveAgentId: unset/empty/none (the ?? vs || bug)', () {
    expect(
      resolveAgentId(''),
      kDefaultAgentId,
      reason: 'an unset define arrives as the empty string',
    );
    expect(resolveAgentId('   '), kDefaultAgentId);
    expect(resolveAgentId('none'), '');
    expect(resolveAgentId('NONE'), '');
    expect(resolveAgentId('agent_x'), 'agent_x');
  });
}
