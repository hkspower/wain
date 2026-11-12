import 'package:flutter_test/flutter_test.dart';
import 'package:wain/ai/agent_health.dart';
import 'package:wain/ai/agent_job.dart';
import 'package:wain/ai/call_controller.dart';
import 'package:wain/ai/config.dart';
import 'package:wain/ai/tools.dart';
import 'package:wain/data/answer_order.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/data/places.g.dart';
import 'package:wain/data/search.dart';
import 'package:wain/data/text_kit.dart';

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

    test('a call goes out with her agent id and the client tools', () async {
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      expect(sessions.single.startedAgent, 'agent_test');
      expect(sessions.single.local, isFalse);
      expect(
        sessions.single.tools.keys,
        containsAll(['show_places', 'open_place']),
      );
      c.dispose();
    });

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

    // «تأكد إنك سمحت بالمايك» is the free call's advice. An agent call rings
    // only after the microphone was asked for and found allowed, so one that
    // rings out is told the line could not be reached — the web's sheet since
    // 14 October; this test expected the old sentence until 11 November.
    test('an agent call that rings out could not be reached: it does not '
        'blame a microphone that was just found allowed', () async {
      final sessions = <FakeSession>[];
      final c = testController(
        sessions: sessions,
        dial: const Duration(milliseconds: 40),
      );
      await c.start();
      expect(sessions.single.local, isFalse, reason: 'her agent call');
      await Future<void>.delayed(const Duration(milliseconds: 90));
      expect(c.phase, CallPhase.failed);
      expect(c.error, CallCopy.callFailed);
      expect(c.error, isNot(contains('المايك')));
      expect(sessions.single.ended, isTrue);
      c.dispose();
    });

    test('his agent call that rings out says so with his name', () async {
      final sessions = <FakeSession>[];
      final c = testController(
        sessions: sessions,
        salemAgentId: 'agent_salem_test',
        dial: const Duration(milliseconds: 40),
      );
      await c.start(persona: CallPersona.salem);
      await Future<void>.delayed(const Duration(milliseconds: 90));
      expect(c.phase, CallPhase.failed);
      expect(c.error, salemCallCopy.callFailed);
      c.dispose();
    });

    test('the free call that rings out keeps its own sentence', () async {
      final sessions = <FakeSession>[];
      final c = testController(
        sessions: sessions,
        dial: const Duration(milliseconds: 40),
      );
      await c.start(persona: CallPersona.salem); // no Salem agent: free
      expect(sessions.single.local, isTrue);
      await Future<void>.delayed(const Duration(milliseconds: 90));
      expect(c.phase, CallPhase.failed);
      expect(c.error, CallCopy.noAnswer);
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

    // 11 November: a line that closed before it ever opened was shown as
    // «انتهت المكالمة» over a clock at ٠٠:٠٠ — a call that never happened,
    // reported as one that ended. The same event as an error already failed.
    test('a line that closes before it ever opened is a failed call, not one '
        'that ended at ٠٠:٠٠', () async {
      final sessions = <FakeSession>[];
      final keep = FakeKeepAlive();
      final c = testController(sessions: sessions, keepAlive: keep);
      await c.start();
      expect(c.phase, CallPhase.ringing);
      sessions.single.onDisconnected!();
      expect(c.phase, CallPhase.failed);
      expect(c.error, CallCopy.callFailed);
      expect(c.sheetOpen, isTrue);
      expect(sessions.single.disposed, isTrue);
      expect(
        sessions.single.ended,
        isFalse,
        reason: 'the line is gone: nothing is left to end',
      );
      expect(keep.running, isFalse);
      // And it is over: a late «connected» from it changes nothing.
      sessions.single.onConnected!();
      expect(c.phase, CallPhase.failed);
      c.dispose();
    });

    test(
      'his line that closes before it opened says so with his name',
      () async {
        final sessions = <FakeSession>[];
        final c = testController(
          sessions: sessions,
          salemAgentId: 'agent_salem_test',
        );
        await c.start(persona: CallPersona.salem);
        sessions.single.onDisconnected!();
        expect(c.phase, CallPhase.failed);
        expect(c.error, salemCallCopy.callFailed);
        c.dispose();
      },
    );

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

    // The web's sheet has named them since 1 October («دوّرت لك «قهوة» — ٤
    // أماكن: …، …»): the two she is about to read out, so the sheet and her
    // voice say the same thing. The app's line stopped at the count.
    test('on an agent call the line names the first two places she is told '
        'of', () async {
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      sessions.single.onConnected!();
      final found = placeHits('قهوة', searchIndex, kPlaces);
      expect(found.length, greaterThan(2));
      final two = found.take(2).map((h) => h.doc.title).join('، ');
      final said = await sessions.single.tools['show_places']!({
        'query': 'قهوة',
      });
      expect(
        c.lastAction,
        'دوّرت لك «قهوة» — ${countAr(found.length, kPlacesCount)}: $two',
      );
      expect(said, contains('أولها: $two،'), reason: 'the same two she reads');

      // Nothing found: a count, and no names to follow it.
      await sessions.single.tools['show_places']!({'query': 'صيدلية'});
      expect(c.lastAction, 'دوّرت لك «صيدلية» — ${countAr(0, kPlacesCount)}');
      c.dispose();
    });

    test('the free call\'s line names nobody: there is no voice to match', () async {
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start(persona: CallPersona.salem); // no Salem agent: free
      expect(sessions.single.local, isTrue);
      sessions.single.onConnected!();
      await sessions.single.tools['show_places']!({'query': 'قهوة'});
      expect(
        c.lastAction,
        'دوّرت لك «قهوة» — '
        '${countAr(placeHits('قهوة', searchIndex, kPlaces).length, kPlacesCount)}',
      );
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

    // The web's sheet says «ما لقيت هالمكان» (1 October), so it never
    // contradicts what she tells the caller. The app's said nothing, and the
    // line before — «فتحت لك صفحة …» — stayed up over a page that had not
    // changed.
    test('an open_place that opened nothing says so on the sheet', () async {
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      sessions.single.onConnected!();
      final t = sessions.single.tools['open_place']!;
      await t({'slug': 'kuwait-towers'});
      expect(c.lastAction, 'فتحت لك صفحة «أبراج الكويت»');
      await t({'slug': 'no-such-place'});
      expect(c.lastAction, CallCopy.noPlace);
      await t({'slug': 'kuwait-towers'});
      await t({'slug': '../etc/passwd'});
      expect(c.lastAction, CallCopy.noPlace);
      expect(
        c.lastSlug,
        'kuwait-towers',
        reason: 'the place that IS on screen is still the one to share',
      );
      c.dispose();
    });
  });

  // 14 October: the voice swap is gone. Each persona is its own agent, so his
  // voice never reaches her agent and her name never reaches his.
  group('one agent per persona, never the other\'s', () {
    test('a Shouq call goes to her agent, a Salem call to his', () async {
      final sessions = <FakeSession>[];
      final c = testController(
        sessions: sessions,
        salemAgentId: 'agent_salem_test',
      );
      await c.start();
      expect(sessions.single.startedAgent, 'agent_test');
      expect(c.persona, CallPersona.shouq);
      await c.hangUp();

      await c.start(persona: CallPersona.salem);
      expect(sessions.last.startedAgent, 'agent_salem_test');
      expect(sessions.last.local, isFalse);
      expect(c.persona, CallPersona.salem);
      c.dispose();
    });

    test(
      'with no Salem agent, his call is the free call, never hers',
      () async {
        final sessions = <FakeSession>[];
        final c = testController(sessions: sessions);
        await c.start(persona: CallPersona.salem);
        expect(
          sessions.single.local,
          isTrue,
          reason: 'no agent for him: the free call',
        );
        expect(
          sessions.single.startedAgent,
          '',
          reason: "not her agent, which is 'agent_test' here",
        );
        expect(c.isFree(CallPersona.salem), isTrue);
        expect(
          c.isFree(CallPersona.shouq),
          isFalse,
          reason: 'her agent is still hers',
        );
        c.dispose();
      },
    );

    test('a Salem call that cannot connect says so with his name', () async {
      final sessions = <FakeSession>[];
      final c = testController(
        sessions: sessions,
        salemAgentId: 'agent_salem_test',
        configure: (s) => s.startError = StateError('refused'),
      );
      await c.start(persona: CallPersona.salem);
      expect(c.phase, CallPhase.failed);
      expect(c.error, salemCallCopy.callFailed);
      expect(c.error, isNot(contains('شوق')));
      c.dispose();
    });

    test(
      'the hand-over to his chat is offered after her call, never his',
      () async {
        final sessions = <FakeSession>[];
        final c = testController(
          sessions: sessions,
          salemAgentId: 'agent_salem_test',
        );
        await c.start();
        sessions.single.onConnected!();
        await sessions.single.tools['show_places']!({'query': 'بحر'});
        await c.hangUp();
        expect(c.canContinueWithSalem, isTrue);

        await c.start(persona: CallPersona.salem);
        sessions.last.onConnected!();
        await sessions.last.tools['show_places']!({'query': 'بحر'});
        await c.hangUp();
        expect(c.lastQuery, 'بحر');
        expect(
          c.canContinueWithSalem,
          isFalse,
          reason: 'the hand-over says «من مكالمتك مع شوق»',
        );
        c.dispose();
      },
    );
  });

  // 14 October, the call-centre scan: what a call does around its edges.
  group('around the edges of a call', () {
    tearDown(() {
      AgentHealth.instance.reset();
      AgentHealth.instance.now = DateTime.now;
    });

    test('a refusal for credits is said as itself, and the next call for a '
        'quarter hour is the free one', () async {
      var at = DateTime.utc(2026, 10, 14, 12);
      AgentHealth.instance
        ..reset()
        ..now = () => at;
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      sessions.single.onError!("[quota_exceeded] You've run out of credits");
      expect(c.phase, CallPhase.failed);
      expect(
        c.error,
        CallCopy.agentUnavailable,
        reason: 'not «ما قدرنا نوصلك», which blames the line',
      );
      expect(c.isFree(CallPersona.shouq), isTrue);

      await c.start();
      expect(sessions.last.local, isTrue, reason: 'our own search');
      expect(sessions.last.startedAgent, '');
      await c.hangUp();

      at = at.add(const Duration(minutes: 16));
      await c.start();
      expect(
        sessions.last.local,
        isFalse,
        reason: 'the agent is tried again after the quarter hour',
      );
      c.dispose();
    });

    // 11 November: the refusal was recognised only as an error's own words.
    // A start that threw with it was «ما قدرنا نوصلك», nothing was
    // remembered, and «اتصل مرة ثانية» rang the same agent again.
    test('a start that throws with the refusal for credits is said as '
        'itself too, and remembered', () async {
      AgentHealth.instance.reset();
      final sessions = <FakeSession>[];
      final c = testController(
        sessions: sessions,
        configure: (s) => s.startError = Exception(
          "[quota_exceeded] You've run out of credits",
        ),
      );
      await c.start();
      expect(c.phase, CallPhase.failed);
      expect(c.error, CallCopy.agentUnavailable);
      expect(AgentHealth.instance.available, isFalse);
      await c.start();
      expect(sessions.last.local, isTrue, reason: 'the redial is the free one');
      c.dispose();
    });

    test('his start refused for credits says so with his name', () async {
      AgentHealth.instance.reset();
      final sessions = <FakeSession>[];
      final c = testController(
        sessions: sessions,
        salemAgentId: 'agent_salem_test',
        configure: (s) => s.startError = Exception('insufficient_credits'),
      );
      await c.start(persona: CallPersona.salem);
      expect(c.error, salemCallCopy.agentUnavailable);
      expect(AgentHealth.instance.available, isFalse);
      c.dispose();
    });

    test(
      'a FREE call whose start throws those words is not the account',
      () async {
        AgentHealth.instance.reset();
        final sessions = <FakeSession>[];
        final c = testController(
          sessions: sessions,
          configure: (s) => s.startError = Exception('quota_exceeded'),
        );
        await c.start(persona: CallPersona.salem); // no agent: free
        expect(c.phase, CallPhase.failed);
        expect(c.error, isNot(salemCallCopy.agentUnavailable));
        expect(AgentHealth.instance.available, isTrue);
        c.dispose();
      },
    );

    test('a refusal for credits on the FREE call is not the account', () async {
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start(persona: CallPersona.salem); // no agent: free
      sessions.single.onError!('quota_exceeded');
      expect(c.error, CallCopy.speechUnavailable);
      expect(AgentHealth.instance.available, isTrue);
      c.dispose();
    });

    test('«إنهاء» arriving after the call ended changes nothing', () async {
      // The notification's button can reach the app after the call has
      // ended on its own; it used to reopen the sheet as «انتهت المكالمة»
      // over whatever the caller had moved on to.
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      sessions.single.onConnected!();
      sessions.single.onDisconnected!();
      expect(c.phase, CallPhase.ended);
      c.closeSheet();
      expect(c.sheetOpen, isFalse);
      await c.hangUp();
      expect(c.sheetOpen, isFalse, reason: 'no sheet reopened');
      expect(c.phase, CallPhase.idle);
      c.dispose();
    });

    test(
      'the place the call put on screen is kept for «رسّلها للربع»',
      () async {
        final nav = <String>[];
        final sessions = <FakeSession>[];
        final c = testController(sessions: sessions, navigate: nav.add);
        await c.start();
        sessions.single.onConnected!();
        expect(c.lastSlug, isNull);
        await sessions.single.tools['show_places']!({'query': 'قهوة'});
        expect(c.lastSlug, isNotNull, reason: 'the first of the search');
        await sessions.single.tools['open_place']!({'slug': 'kuwait-towers'});
        expect(c.lastSlug, 'kuwait-towers');
        nav.clear();
        c.shareLastPlace();
        expect(nav, isEmpty, reason: 'not while the call is up');
        await c.hangUp();
        c.shareLastPlace();
        expect(nav, ['/places/kuwait-towers?share=1']);
        expect(c.sheetOpen, isFalse);
        c.dispose();
      },
    );

    test('a new call forgets the last one\'s place', () async {
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      sessions.single.onConnected!();
      await sessions.single.tools['open_place']!({'slug': 'kuwait-towers'});
      await c.hangUp();
      await c.start();
      expect(c.lastSlug, isNull);
      c.dispose();
    });

    // 11 November: the offline check came before the reset, so a call that
    // failed at once for no network kept the call before it on its failure
    // screen — its «دوّرت لك…» line, «رسّلها للربع» for a place this call
    // never showed, and «كمّل مع سالم» for a question it never heard.
    test(
      'a call that fails for no network forgets the call before it',
      () async {
        var offline = false;
        final sessions = <FakeSession>[];
        final c = testController(sessions: sessions, isOffline: () => offline);
        await c.start();
        sessions.single.onConnected!();
        await sessions.single.tools['show_places']!({'query': 'بحر'});
        await c.hangUp();
        expect(c.lastQuery, 'بحر');
        expect(c.lastSlug, isNotNull);
        expect(c.lastAction, isNotNull);
        expect(c.canContinueWithSalem, isTrue);

        offline = true;
        await c.start();
        expect(c.phase, CallPhase.failed);
        expect(c.error, CallCopy.offline);
        expect(c.lastAction, isNull, reason: 'the last call\'s line');
        expect(c.lastSlug, isNull, reason: 'no «رسّلها للربع» for its place');
        expect(c.lastQuery, isNull);
        expect(c.canContinueWithSalem, isFalse);
        expect(sessions, hasLength(1), reason: 'still nothing dialled offline');
        c.dispose();
      },
    );

    test('the search box moving on forgets the call\'s question', () async {
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      sessions.single.onConnected!();
      await sessions.single.tools['show_places']!({'query': 'بحر'});
      await c.hangUp();
      expect(c.lastQuery, 'بحر');
      c.forgetLastQueryUnless(' بحر ');
      expect(c.lastQuery, 'بحر', reason: 'the same words, trimmed');
      c.forgetLastQueryUnless('بحر هادي');
      expect(c.lastQuery, isNull);
      expect(c.canContinueWithSalem, isFalse);
      c.dispose();
    });

    test(
      '«اكتب لسالم» lands on his chat, only once the call is over',
      () async {
        final nav = <String>[];
        final sessions = <FakeSession>[];
        final c = testController(sessions: sessions, navigate: nav.add);
        await c.start();
        c.typeToSalem();
        expect(nav, isEmpty);
        sessions.single.onError!('refused');
        expect(c.phase, CallPhase.failed);
        c.typeToSalem();
        expect(nav, ['/salem']);
        expect(c.sheetOpen, isFalse);
        c.dispose();
      },
    );
  });

  // The job travels between the agents (agent_job.dart, the web's
  // agent-job.ts, 14–15 October): what was asked, the places shown and the one
  // picked, so the next agent does not ask again.
  group('the job travels between the agents', () {
    setUp(AgentJobs.instance.reset);
    tearDown(AgentJobs.instance.reset);
    String? nameOf(String slug) => getPlace(slug)?.nameAr;

    test('an agent call is told the job from the agent before — once, and '
        'only after its line is open', () async {
      writeJob(
        JobAgent.shouqAnswer,
        asked: 'قهوة',
        shown: ['kuwait-towers', 'souq-al-mubarakiya'],
        picked: 'souq-al-mubarakiya',
      );
      final job = readJob()!;
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      expect(sessions.single.told, isEmpty, reason: 'ringing: nobody to tell');
      sessions.single.onConnected!();
      expect(sessions.single.told, [jobContext(job, nameOf)]);
      expect(sessions.single.told.single, contains('جواب شوق المكتوب'));
      expect(sessions.single.told.single, contains('«قهوة»'));
      sessions.single.onConnected!();
      expect(sessions.single.told, hasLength(1), reason: 'told once a call');
      c.dispose();
    });

    test(
      'never its own job back; the other persona\'s agent is told it',
      () async {
        writeJob(JobAgent.shouqCall, asked: 'بحر', shown: ['kuwait-towers']);
        final sessions = <FakeSession>[];
        final c = testController(
          sessions: sessions,
          salemAgentId: 'agent_salem_test',
        );
        await c.start();
        sessions.single.onConnected!();
        expect(sessions.single.told, isEmpty, reason: 'her own job, not news');
        await c.hangUp();
        await c.start(persona: CallPersona.salem);
        sessions.last.onConnected!();
        expect(sessions.last.told, hasLength(1));
        expect(sessions.last.told.single, contains('مكالمته مع شوق'));
        c.dispose();
      },
    );

    test('a job half an hour old is not told', () async {
      final at = DateTime.utc(2026, 10, 15, 18);
      AgentJobs.instance.now = () => at;
      writeJob(JobAgent.shouqAnswer, asked: 'قهوة', shown: ['kuwait-towers']);
      AgentJobs.instance.now = () => at.add(const Duration(minutes: 31));
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      sessions.single.onConnected!();
      expect(sessions.single.told, isEmpty);
      c.dispose();
    });

    test('show_places writes what was asked, the first eight and the whole '
        'answer; open_place picks inside it', () async {
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      sessions.single.onConnected!();
      await sessions.single.tools['show_places']!({'query': 'بحر'});
      final job = readJob()!;
      expect(job.by, JobAgent.shouqCall);
      expect(job.asked, 'بحر');
      expect(job.shown, hasLength(8), reason: 'the first eight of the answer');
      expect(job.ranked.length, greaterThan(8), reason: 'and all of it');
      expect(job.ranked.take(8), job.shown);
      final second = job.shown[1];
      await sessions.single.tools['open_place']!({'slug': second});
      final picked = readJob()!;
      expect(picked.picked, second);
      expect(picked.asked, 'بحر', reason: 'the pick stays with its job');
      c.dispose();
    });

    // A place past the web's answer is a job of its own, as on the web: the
    // app's show_places searched places alone and kept forty for «بحر
    // الكويت», so opening one the web never listed stayed inside the job
    // here and started its own there.
    test('open_place of a place outside the web\'s answer starts a job of its '
        'own', () async {
      const q = 'بحر الكويت';
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      sessions.single.onConnected!();
      await sessions.single.tools['show_places']!({'query': q});
      final job = readJob()!;
      final outside = [
        for (final h in answerOrder(
          q,
          search(q, searchIndex, limit: 40, kinds: const ['place']),
          searchIndex,
          kPlaces,
        ).hits)
          h.doc.id.substring('place:'.length),
      ].firstWhere((s) => !job.ranked.contains(s));
      await sessions.single.tools['open_place']!({'slug': outside});
      final picked = readJob()!;
      expect(picked.picked, outside);
      expect(picked.asked, nameOf(outside), reason: 'not «$q»: its own job');
      expect(picked.shown, [outside]);
      c.dispose();
    });

    // 11 November: the tools were handed to the session bare, so one that
    // arrived after the call was over still drove the app — it navigated,
    // rewrote the ended sheet and wrote the job; with the next call already
    // placed, under the next call's persona.
    test('a tool call from a hung-up call changes nothing', () async {
      final nav = <String>[];
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions, navigate: nav.add);
      await c.start();
      sessions.single.onConnected!();
      final show = sessions.single.tools['show_places']!;
      final open = sessions.single.tools['open_place']!;
      await c.hangUp();
      await show({'query': 'بحر'});
      await open({'slug': 'kuwait-towers'});
      expect(nav, isEmpty, reason: 'the caller has hung up: no page moves');
      expect(c.lastAction, isNull);
      expect(c.lastQuery, isNull);
      expect(c.lastSlug, isNull);
      expect(c.canContinueWithSalem, isFalse);
      expect(readJob(), isNull, reason: 'and no job is written');
      c.dispose();
    });

    test('her old call\'s tool cannot write into his next call', () async {
      final nav = <String>[];
      final sessions = <FakeSession>[];
      final c = testController(
        sessions: sessions,
        navigate: nav.add,
        salemAgentId: 'agent_salem_test',
      );
      await c.start();
      sessions.single.onConnected!();
      final hers = sessions.single.tools['show_places']!;
      await c.hangUp();
      await c.start(persona: CallPersona.salem);
      sessions.last.onConnected!();
      await hers({'query': 'بحر'});
      expect(nav, isEmpty);
      expect(c.lastAction, isNull, reason: 'his sheet says nothing of it');
      expect(readJob(), isNull, reason: 'not a job «by» his call');
      // His own tool, on his own call, still works.
      await sessions.last.tools['show_places']!({'query': 'قهوة'});
      expect(nav, hasLength(1));
      expect(readJob()!.by, JobAgent.salemCall);
      expect(readJob()!.asked, 'قهوة');
      c.dispose();
    });

    test('his call writes his job; the free call writes what was asked and '
        'tells nobody', () async {
      writeJob(JobAgent.shouqAnswer, asked: 'قهوة', shown: ['kuwait-towers']);
      final sessions = <FakeSession>[];
      // His agent unset: his call is the free one.
      final c = testController(sessions: sessions);
      await c.start(persona: CallPersona.salem);
      expect(sessions.single.local, isTrue);
      sessions.single.onConnected!();
      expect(sessions.single.told, isEmpty, reason: 'nobody on the line');
      await sessions.single.tools['show_places']!({'query': 'بحر'});
      final job = readJob()!;
      expect(job.by, JobAgent.salemCall);
      expect(job.asked, 'بحر');
      expect(
        job.shown,
        isEmpty,
        reason: 'the search screen shows the places, in its own order',
      );
      c.dispose();
    });
  });

  test('the agent ids: each persona names its own, and never the other', () {
    expect(kSalemAgentId, '', reason: 'the default build is free for him too');
    expect(
      agentIdFor(CallPersona.salem, shouq: 'agent_shouq', salem: 'agent_salem'),
      'agent_salem',
    );
    expect(
      agentIdFor(CallPersona.shouq, shouq: 'agent_shouq', salem: 'agent_salem'),
      'agent_shouq',
    );
    expect(
      agentIdFor(CallPersona.salem, shouq: 'agent_shouq', salem: ''),
      '',
      reason: 'an unset Salem agent never falls back to her id',
    );
    expect(
      agentIdFor(CallPersona.shouq, shouq: '', salem: 'agent_salem'),
      '',
      reason: 'and her unset agent never falls back to his',
    );
  });

  test('resolveAgentId: the free build unless an agent is named', () {
    // Since 2 October the live app is free (local_session.dart): unset,
    // empty and «none» all mean no agent. Only a sandbox build names one.
    expect(
      resolveAgentId(''),
      '',
      reason: 'an unset define arrives as the empty string — and is free',
    );
    expect(resolveAgentId('   '), '');
    expect(resolveAgentId('none'), '');
    expect(resolveAgentId('NONE'), '');
    expect(resolveAgentId(kSandboxAgentId), kSandboxAgentId);
  });
}
