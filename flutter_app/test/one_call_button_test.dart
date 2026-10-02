// One way to call شوق, on request (1 October): /find's button. The search box
// and the search dead end each had their own ShouqCallButton — one offer drawn
// three times. Every route a visitor lands on is counted, not only the one
// that changed.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/ai/call_button.dart';
import 'package:wain/map/wain_map.dart';

import 'app_smoke_test.dart' show pumpAt;

void main() {
  setUp(() => debugTileUrl = '');
  tearDown(() => debugTileUrl = null);

  const routes = {
    '/find': 1,
    '/': 0,
    '/search': 0,
    '/search?q=قهوة': 0,
    '/search?q=صيدلية': 0, // the dead end
    '/explore': 0,
    '/places/kuwait-towers': 0,
    '/salem': 0,
  };
  for (final r in routes.entries) {
    testWidgets('${r.key}: ${r.value} call button', (t) async {
      await pumpAt(t, r.key);
      expect(find.byType(ShouqCallButton), findsNWidgets(r.value));
    });
  }

  testWidgets('/search names the call as a way to /find, not a second button', (
    t,
  ) async {
    await pumpAt(t, '/search');
    await t.tap(find.byKey(const ValueKey('search-call-link')));
    await t.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.byType(ShouqCallButton), findsOneWidget);
    expect(find.byKey(const ValueKey('find-call')), findsOneWidget);
  });
}
