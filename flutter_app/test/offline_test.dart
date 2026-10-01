// No network: say so at once, and keep everything that never needed one.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/ai/call_controller.dart';
import 'package:wain/ai/config.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/app/offline_banner.dart';
import 'package:wain/app/online.dart';
import 'package:wain/main.dart';
import 'package:wain/map/wain_map.dart';

import 'support.dart';

Future<Online> at(
  WidgetTester t,
  String location, {
  bool offline = true,
}) async {
  final online = Online.fixed(offline: offline);
  final state = AppState.ephemeral()..setAiConsent(true);
  t.view.physicalSize = const Size(390 * 2, 844 * 2);
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  await t.pumpWidget(
    WainApp(state: state, initialLocation: location, online: online),
  );
  await t.pump(const Duration(milliseconds: 400));
  return online;
}

void main() {
  setUp(() => debugTileUrl = '');
  tearDown(() => debugTileUrl = null);

  test('a call with no network fails at once, without dialling', () async {
    final sessions = <FakeSession>[];
    final keep = FakeKeepAlive();
    final c = CallController(
      sessionFactory: () {
        final s = FakeSession();
        sessions.add(s);
        return s;
      },
      places: const [],
      indexOf: () => throw StateError('no index needed offline'),
      navigate: (_) {},
      agentId: 'agent_test',
      keepAlive: keep,
      isOffline: () => true,
    );
    await c.start();
    expect(c.phase, CallPhase.failed);
    expect(c.error, CallCopy.offline);
    expect(sessions, isEmpty);
    expect(keep.log, isEmpty);
    c.dispose();
  });

  testWidgets(
    'a quiet strip says so, on every screen, and goes when it is back',
    (t) async {
      final online = await at(t, '/explore');
      expect(find.text(kOfflineLine), findsOneWidget);
      expect(
        find.textContaining('استكشف الكويت'),
        findsWidgets,
        reason: 'the bundled places still work',
      );
      online.set(offline: false);
      await t.pump();
      expect(find.text(kOfflineLine), findsNothing);
    },
  );

  testWidgets('the typed chat says so instead of waiting out its timeout', (
    t,
  ) async {
    await at(t, '/salem');
    expect(find.text(ChatCopy.offline), findsWidgets);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('the map says it needs the internet', (t) async {
    await at(t, '/places/kuwait-towers');
    await t.ensureVisible(find.byType(WainMap));
    await t.pump();
    expect(find.byKey(const ValueKey('map-offline')), findsOneWidget);
  });

  testWidgets('online, none of it shows', (t) async {
    await at(t, '/places/kuwait-towers', offline: false);
    expect(find.text(kOfflineLine), findsNothing);
    expect(find.byKey(const ValueKey('map-offline')), findsNothing);
  });
}
