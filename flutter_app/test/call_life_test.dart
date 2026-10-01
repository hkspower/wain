// A call that behaves like a phone call: it can be put away and brought back,
// back acts on the call rather than the page under it, and it is kept alive
// (screen awake, Android's foreground service) for exactly as long as it runs.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/ai/call_controller.dart';
import 'package:wain/ai/config.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/main.dart';

import 'support.dart';

void main() {
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
      FakeKeepAlive keep,
    ) async {
      final sessions = <FakeSession>[];
      t.view.physicalSize = const Size(390 * 2, 844 * 2);
      t.view.devicePixelRatio = 2;
      addTearDown(t.view.reset);
      await t.pumpWidget(
        WainApp(
          state: AppState.ephemeral(),
          sessionFactory: () {
            final s = FakeSession();
            sessions.add(s);
            return s;
          },
          checkMic: () async => MicResult.ok,
          keepAlive: keep,
          agentId: 'agent_test',
        ),
      );
      await t.pump(const Duration(milliseconds: 300));
      final c = read<CallController>(t, find.byType(Scaffold));
      await c.start();
      await t.pump();
      sessions.single.onConnected!();
      await t.pump(const Duration(milliseconds: 100));
      return sessions;
    }

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
