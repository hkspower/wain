// A call that behaves like a phone call: it can be put away and brought back,
// back acts on the call rather than the page under it, and it is kept alive
// (screen awake, Android's foreground service) for exactly as long as it runs.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/ai/call_controller.dart';
import 'package:wain/ai/config.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/main.dart';
import 'package:wain/screens/salem_screen.dart';
import 'package:wain/theme/app_theme.dart';

import 'support.dart';

void main() {
  // Widget tests draw every glyph as a square unless the app's face is loaded,
  // and at that width his four-letter name overflowed the call bar by 6px that
  // no phone draws. The bar is measured in the face a phone shows.
  setUpAll(() async {
    final loader = FontLoader(kFontFamily);
    for (final w in const ['Regular', 'SemiBold', 'Bold']) {
      loader.addFont(rootBundle.load('assets/fonts/IBMPlexSansArabic-$w.ttf'));
    }
    await loader.load();
  });

  group('kept alive for exactly as long as the call runs', () {
    test(
      'started once the microphone is granted, stopped on hang-up',
      () async {
        final sessions = <FakeSession>[];
        final keep = FakeKeepAlive();
        final c = testController(sessions: sessions, keepAlive: keep);
        await c.start();
        expect(keep.log, ['start']);
        sessions.single.onConnected!();
        await c.hangUp();
        expect(keep.log, ['start', 'stop']);
        c.dispose();
        expect(keep.log, ['start', 'stop'], reason: 'not stopped twice');
      },
    );

    test('never started when the microphone is refused', () async {
      final keep = FakeKeepAlive();
      final c = testController(
        sessions: [],
        keepAlive: keep,
        mic: () async => MicResult.denied,
      );
      await c.start();
      expect(c.phase, CallPhase.failed);
      expect(keep.log, isEmpty);
      c.dispose();
    });

    test(
      'stopped when she hangs up, the line drops, or dialling fails',
      () async {
        for (final end in ['disconnect', 'error-ringing', 'dispose']) {
          final sessions = <FakeSession>[];
          final keep = FakeKeepAlive();
          final c = testController(sessions: sessions, keepAlive: keep);
          await c.start();
          switch (end) {
            case 'disconnect':
              sessions.single.onConnected!();
              sessions.single.onDisconnected!();
            case 'error-ringing':
              sessions.single.onError!('refused');
            case 'dispose':
              c.dispose();
          }
          expect(keep.running, isFalse, reason: end);
          if (end != 'dispose') c.dispose();
        }
      },
    );
  });

  group('the sheet can be put away', () {
    test('minimise keeps the call; restore brings the sheet back', () async {
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      sessions.single.onConnected!();
      c.minimise();
      expect(c.minimised, isTrue);
      expect(
        c.phase,
        CallPhase.live,
        reason: 'putting it away is not hanging up',
      );
      c.restore();
      expect(c.sheetOpen, isTrue);
      c.dispose();
    });

    test('a call that ends while put away opens its sheet to say so', () async {
      final sessions = <FakeSession>[];
      final c = testController(sessions: sessions);
      await c.start();
      sessions.single.onConnected!();
      c.minimise();
      sessions.single.onDisconnected!();
      expect(c.sheetOpen, isTrue);
      expect(c.phase, CallPhase.ended);
      c.dispose();
    });

    test('a microphone blocked for good says where to fix it', () async {
      final c = testController(
        sessions: [],
        mic: () async => MicResult.blocked,
      );
      await c.start();
      expect(c.error, CallCopy.micBlocked);
      c.dispose();
    });
  });

  group('in the app', () {
    Future<List<FakeSession>> placeCall(
      WidgetTester t,
      FakeKeepAlive keep, {
      CallPersona persona = CallPersona.shouq,
      bool connected = true,
    }) async {
      final sessions = <FakeSession>[];
      t.view.physicalSize = const Size(390 * 2, 844 * 2);
      t.view.devicePixelRatio = 2;
      addTearDown(t.view.reset);
      await t.pumpWidget(
        WainApp(
          state: AppState.ephemeral(),
          sessionFactory: ({required bool local}) {
            final s = FakeSession();
            sessions.add(s);
            return s;
          },
          checkMic: () async => MicResult.ok,
          keepAlive: keep,
          shouqAgentId: 'agent_test',
          salemAgentId: 'agent_salem_test',
        ),
      );
      await t.pump(const Duration(milliseconds: 300));
      final c = read<CallController>(t, find.byType(Scaffold));
      await c.start(persona: persona);
      await t.pump();
      if (connected) {
        sessions.single.onConnected!();
        await t.pump(const Duration(milliseconds: 100));
      }
      return sessions;
    }

    /// The sheet's own words, so the rest of the app (the Home dial, the bar)
    /// cannot satisfy a check about the sheet.
    Finder inSheet(Finder f) => find.descendant(
      of: find.byKey(const ValueKey('call-sheet')),
      matching: f,
    );

    String faceAsset(WidgetTester t) {
      final box = t.widget<Container>(find.byKey(const ValueKey('call-face')));
      final image = (box.decoration! as BoxDecoration).image!.image;
      return (image as AssetImage).assetName;
    }

    // 14 October: each persona's sheet says its own name, greeting and picture,
    // and the other's name appears nowhere on it.
    testWidgets(
      'his sheet is his: his name, his greeting and face, no word of hers',
      (t) async {
        await placeCall(
          t,
          FakeKeepAlive(),
          persona: CallPersona.salem,
          connected: false,
        );
        expect(inSheet(find.text('سالم')), findsOneWidget);
        expect(inSheet(find.text(kSalemGreeting)), findsOneWidget);
        expect(inSheet(find.text(CallCopy.greeting)), findsNothing);
        expect(inSheet(find.textContaining('شوق')), findsNothing);
        expect(faceAsset(t), 'assets/img/salem-face.jpg');
        expect(
          inSheet(find.text(salemCallCopy.micNote)),
          findsOneWidget,
          reason: 'the microphone note names him, in the masculine',
        );
        await t.pumpWidget(const SizedBox());
      },
    );

    testWidgets('her sheet is hers: her name and greeting, no word of his', (
      t,
    ) async {
      await placeCall(t, FakeKeepAlive(), connected: false);
      expect(inSheet(find.text('شوق')), findsOneWidget);
      expect(inSheet(find.text(CallCopy.greeting)), findsOneWidget);
      expect(inSheet(find.textContaining('سالم')), findsNothing);
      expect(faceAsset(t), 'assets/img/shouq-face.jpg');
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('while he speaks the status says so in his name', (t) async {
      final sessions = await placeCall(
        t,
        FakeKeepAlive(),
        persona: CallPersona.salem,
      );
      sessions.single.onSpeaking!(true);
      await t.pump(const Duration(milliseconds: 100));
      expect(inSheet(find.text(salemCallCopy.answering)), findsOneWidget);
      expect(inSheet(find.text(CallCopy.answering)), findsNothing);
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('the sheet has no voice switch, on her call or his', (t) async {
      for (final persona in CallPersona.values) {
        await placeCall(t, FakeKeepAlive(), persona: persona);
        expect(
          find.byKey(const ValueKey('call-switch-voice')),
          findsNothing,
          reason: persona.name,
        );
        expect(find.text('بصوت سالم'), findsNothing, reason: persona.name);
        expect(find.text('بصوت شوق'), findsNothing, reason: persona.name);
        expect(find.byKey(const ValueKey('call-hangup')), findsOneWidget);
        await t.pumpWidget(const SizedBox());
      }
    });

    testWidgets('minimised, his bar carries his name', (t) async {
      await placeCall(t, FakeKeepAlive(), persona: CallPersona.salem);
      await t.tap(find.byKey(const ValueKey('call-minimise')));
      await t.pump(const Duration(milliseconds: 100));
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('call-bar')),
          matching: find.textContaining('سالم ·'),
        ),
        findsOneWidget,
      );
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('«اتصل مرة ثانية» redials the same person', (t) async {
      final sessions = await placeCall(
        t,
        FakeKeepAlive(),
        persona: CallPersona.salem,
      );
      await t.tap(find.byKey(const ValueKey('call-hangup')));
      await t.pump(const Duration(milliseconds: 100));
      await t.tap(find.byKey(const ValueKey('call-again')));
      await t.pump(const Duration(milliseconds: 100));
      expect(sessions, hasLength(2));
      expect(
        sessions.last.startedAgent,
        'agent_salem_test',
        reason: 'not her agent by default',
      );
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('his finished call offers no hand-over to his own chat', (
      t,
    ) async {
      final sessions = await placeCall(
        t,
        FakeKeepAlive(),
        persona: CallPersona.salem,
      );
      await sessions.single.tools['show_places']!({'query': 'بحر'});
      await t.pump(const Duration(milliseconds: 300));
      await t.tap(find.byKey(const ValueKey('call-hangup')));
      await t.pump(const Duration(milliseconds: 100));
      expect(find.byKey(const ValueKey('call-again')), findsOneWidget);
      expect(
        find.byKey(const ValueKey('call-to-salem')),
        findsNothing,
        reason: 'the hand-over says «من مكالمتك مع شوق»',
      );
      await t.pumpWidget(const SizedBox());
    });

    testWidgets(
      'Android back puts a live call away instead of acting on the page',
      (t) async {
        await placeCall(t, FakeKeepAlive());
        expect(find.byKey(const ValueKey('call-sheet')), findsOneWidget);
        await t.binding.handlePopRoute();
        await t.pump(const Duration(milliseconds: 100));
        expect(find.byKey(const ValueKey('call-sheet')), findsNothing);
        expect(find.byKey(const ValueKey('call-bar')), findsOneWidget);
        expect(find.text('إلى وين؟'), findsOneWidget, reason: 'still on Home');

        await t.tap(find.byKey(const ValueKey('call-bar')));
        await t.pump(const Duration(milliseconds: 100));
        expect(find.byKey(const ValueKey('call-sheet')), findsOneWidget);
        await t.pumpWidget(const SizedBox());
      },
    );

    testWidgets(
      'the last screen hands her search to سالم, saying it came from the call',
      (t) async {
        // 7 October: switching from her call to his chat used to mean
        // starting over — the last screen offered another call and nothing
        // else, and سالم knew nothing of what she had found.
        final sessions = await placeCall(t, FakeKeepAlive());
        await sessions.single.tools['show_places']!({'query': 'بحر'});
        await t.pump(const Duration(milliseconds: 300));
        await t.tap(find.byKey(const ValueKey('call-hangup')));
        await t.pump(const Duration(milliseconds: 100));
        expect(find.byKey(const ValueKey('call-to-salem')), findsOneWidget);
        await t.tap(find.byKey(const ValueKey('call-to-salem')));
        for (var i = 0; i < 6; i++) {
          await t.pump(const Duration(milliseconds: 100));
        }
        expect(find.byKey(const ValueKey('call-sheet')), findsNothing);
        final salem = t.widget<SalemScreen>(find.byType(SalemScreen));
        expect(salem.initialQuery, 'بحر');
        expect(salem.handoffFrom, 'call');
        await t.pumpWidget(const SizedBox());
      },
    );

    testWidgets('a call that searched nothing offers no hand-over', (t) async {
      await placeCall(t, FakeKeepAlive());
      await t.tap(find.byKey(const ValueKey('call-hangup')));
      await t.pump(const Duration(milliseconds: 100));
      expect(find.byKey(const ValueKey('call-again')), findsOneWidget);
      expect(find.byKey(const ValueKey('call-to-salem')), findsNothing);
      await t.pumpWidget(const SizedBox());
    });

    testWidgets(
      'the sheet has its own put-away button, and back closes a finished call',
      (t) async {
        await placeCall(t, FakeKeepAlive());
        await t.tap(find.byKey(const ValueKey('call-minimise')));
        await t.pump(const Duration(milliseconds: 100));
        expect(find.byKey(const ValueKey('call-bar')), findsOneWidget);

        await t.tap(find.byKey(const ValueKey('call-bar')));
        await t.pump(const Duration(milliseconds: 100));
        await t.tap(find.byKey(const ValueKey('call-hangup')));
        await t.pump(const Duration(milliseconds: 100));
        expect(find.byKey(const ValueKey('call-again')), findsOneWidget);
        await t.binding.handlePopRoute();
        await t.pump(const Duration(milliseconds: 100));
        expect(find.byKey(const ValueKey('call-sheet')), findsNothing);
        expect(find.text('إلى وين؟'), findsOneWidget);
        await t.pumpWidget(const SizedBox());
      },
    );
  });
}
