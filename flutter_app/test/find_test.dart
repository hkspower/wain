// /find follows the moment it is read in (data/find_moment.dart). The words
// themselves are replayed against the web in kit_parity_test; this proves the
// screen uses them, and redraws on the hour without being reopened.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
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
}
