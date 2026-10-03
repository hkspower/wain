// The round back button on every pushed screen (BackFab), the app's half of
// the website's tests/back-button.test.mjs, 3 October: on every screen but
// the three tabs, one button, a full-size target, and it goes back when
// there is somewhere of ours to go back to — or somewhere sensible when the
// screen was the first thing opened (a shared link).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:wain/map/wain_map.dart';
import 'package:wain/screens/home_screen.dart';

import 'app_smoke_test.dart' show pumpAt;

final _fab = find.byKey(const ValueKey('back-fab'));

void main() {
  setUp(() => debugTileUrl = '');
  tearDown(() => debugTileUrl = null);

  const pushed = [
    '/about',
    '/privacy',
    '/add',
    '/places/kuwait-towers',
    '/find',
    '/salem',
  ];
  for (final size in const [Size(390, 844), Size(320, 568), Size(800, 1280)]) {
    for (final r in pushed) {
      testWidgets('${size.width.toInt()}px $r: one back button, full size', (
        t,
      ) async {
        await pumpAt(t, r, size: size);
        expect(_fab, findsOneWidget);
        final box = t.getSize(_fab);
        expect(box.shortestSide, greaterThanOrEqualTo(48));
        // The start side is the right in Arabic.
        expect(t.getCenter(_fab).dx, greaterThan(size.width / 2));
      });
    }
  }

  for (final r in const ['/', '/explore', '/search']) {
    testWidgets('$r is a tab: no back button', (t) async {
      await pumpAt(t, r);
      expect(_fab, findsNothing);
    });
  }

  testWidgets('opened from home, it goes back home', (t) async {
    await pumpAt(t, '/');
    GoRouter.of(t.element(find.byType(HomeScreen))).push('/about');
    await t.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.text('وين؟ شنو هذا'), findsOneWidget);
    await t.tap(_fab);
    // Not pumpAndSettle: home's sun and its slideshow never settle.
    await t.pump(const Duration(milliseconds: 500));
    await t.pump(const Duration(milliseconds: 500));
    expect(find.byType(HomeScreen), findsOneWidget);
    expect(find.text('وين؟ شنو هذا'), findsNothing);
  });

  testWidgets('a place opened from a link leaves the place', (t) async {
    await pumpAt(t, '/places/kuwait-towers');
    // A cold link lands on home with the place on top (deep_link.dart), so
    // back is home here; the /explore fallback is for a place with nothing
    // under it at all, which the router never produces today.
    await t.tap(_fab);
    await t.pump(const Duration(milliseconds: 500));
    await t.pump(const Duration(milliseconds: 500));
    expect(_fab, findsNothing, reason: 'it left the place');
  });

  testWidgets('/salem opened first goes to /find', (t) async {
    await pumpAt(t, '/salem');
    await t.tap(_fab);
    await t.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.text('اتصال'), findsWidgets);
  });
}
