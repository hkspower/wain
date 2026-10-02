// /find follows the moment it is read in (data/find_moment.dart). The words
// themselves are replayed against the web in kit_parity_test; this proves the
// screen uses them, and redraws on the hour without being reopened.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:wain/ai/call_button.dart';
import 'package:wain/ai/call_controller.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/screens/find_screen.dart';

import 'support.dart';

Widget _host(DateTime Function() now) {
  final call = testController(sessions: []);
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AppState>.value(value: AppState.ephemeral()),
      ChangeNotifierProvider<CallController>.value(value: call),
    ],
    child: MaterialApp(
      home: Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(body: FindScreen(now: now)),
      ),
    ),
  );
}

String _greetings(WidgetTester t) => t
    .widgetList<Text>(find.byKey(const ValueKey('find-greeting')))
    .map((w) => w.data)
    .join(' | ');

void main() {
  testWidgets('a July noon offers somewhere cool, on both halves, no sea', (
    t,
  ) async {
    t.view.physicalSize = const Size(390 * 3, 844 * 3);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    // 09:00 UTC is noon in Kuwait.
    await t.pumpWidget(_host(() => DateTime.utc(2026, 7, 15, 9)));
    final g = _greetings(t);
    expect('مول مكيّف'.allMatches(g).length, 2, reason: g);
    expect(g.contains('بحر'), isFalse, reason: g);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('left open across noon, it changes without being reopened', (
    t,
  ) async {
    t.view.physicalSize = const Size(390 * 3, 844 * 3);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    // 11:59 in Kuwait on a January day; the screen's clock follows the
    // test's fake time from there.
    final start = DateTime.utc(2026, 1, 10, 8, 59);
    var advanced = Duration.zero;
    await t.pumpWidget(_host(() => start.add(advanced)));
    expect(_greetings(t), contains('صباح الخير!'));
    expect(_greetings(t), contains('مشي على البحر'));
    advanced = const Duration(minutes: 2);
    await t.pump(const Duration(minutes: 2));
    expect(_greetings(t), contains('هلا!'));
    expect(_greetings(t), contains('غدا'));
    await t.pumpWidget(const SizedBox());
  });

  // The web's /find phone (2 October, on request: «one call icon, big, at the
  // centre of شوق's page, with a big mobile and the call text»): her half is a
  // handset with one big round call button and «اتصال» under it.
  for (final size in const [Size(390, 844), Size(320, 568)]) {
    testWidgets(
      'at ${size.width.toInt()}: one big call, on a phone, at the centre',
      (t) async {
        t.view.physicalSize = size * 3;
        t.view.devicePixelRatio = 3;
        addTearDown(t.view.reset);
        await t.pumpWidget(_host(() => DateTime.utc(2026, 7, 15, 9)));
        final half = find.byKey(const ValueKey('find-call'));
        final phone = find.descendant(
          of: half,
          matching: find.byKey(const ValueKey('find-phone')),
        );
        expect(phone, findsOneWidget, reason: 'the handset is drawn');
        final button = find.descendant(
          of: phone,
          matching: find.byType(ShouqCallButton),
        );
        expect(button, findsOneWidget, reason: 'the one call, on the phone');
        expect(
          find.descendant(of: phone, matching: find.text('اتصال')),
          findsOneWidget,
          reason: 'the call says what it is',
        );
        final b = t.getRect(button);
        final h = t.getRect(half);
        expect(
          (b.center.dx - h.center.dx).abs(),
          lessThan(8),
          reason: 'centred: button ${b.center.dx}, half ${h.center.dx}',
        );
        expect(
          b.width,
          greaterThanOrEqualTo(size.width >= 390 ? 88 : 56),
          reason: 'big: ${b.width}',
        );
        expect(t.takeException(), isNull);
        await t.pumpWidget(const SizedBox());
      },
    );
  }
}
