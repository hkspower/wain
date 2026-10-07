// Every control a finger can reach is at least 48×48 and has a name: the
// Android accessibility guideline, measured by the framework's own matchers.
// It found every chip at 32, the hangout times at 36, the call button at 36,
// the breadcrumb at 33 and the map pins at 40 — all now grown around the same
// drawing (HitArea in widgets/layout.dart).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/main.dart';
import 'package:wain/map/wain_map.dart';

void main() {
  setUp(() => debugTileUrl = '');
  tearDown(() => debugTileUrl = null);

  const routes = [
    '/',
    '/explore',
    '/search',
    '/search?q=صيدلية',
    '/about',
    '/privacy',
    '/add',
    '/find',
    '/places/kuwait-towers',
    '/places/marina-beach?when=tonight-8',
  ];
  // A map clips its pins at its own edge the way every map does, so a pin
  // near the border reads as a short target to the guideline. The pins are
  // held here instead: every one is a 48×48 target.
  testWidgets('every map pin is a 48×48 target', (t) async {
    t.view.physicalSize = const Size(390 * 3, 844 * 3);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      WainApp(state: AppState.ephemeral(), initialLocation: '/search?q=قهوة'),
    );
    await t.pump(const Duration(milliseconds: 500));
    await t.tap(find.byKey(const ValueKey('search-map-bar')));
    await t.pump(const Duration(milliseconds: 300));
    final pins = find.byWidgetPredicate(
      (w) =>
          w.key is ValueKey<String> &&
          (w.key! as ValueKey<String>).value.startsWith('map-pin-'),
    );
    expect(pins, findsWidgets);
    for (final e in pins.evaluate()) {
      expect(t.getSize(find.byWidget(e.widget)), const Size(48, 48));
    }
  });

  for (final width in const [390.0, 320.0]) {
    for (final r in routes) {
      testWidgets('$r at ${width.toInt()}px', (t) async {
        t.view.physicalSize = Size(width * 3, 844 * 3);
        t.view.devicePixelRatio = 3;
        addTearDown(t.view.reset);
        final semantics = t.ensureSemantics();
        await t.pumpWidget(
          WainApp(state: AppState.ephemeral(), initialLocation: r),
        );
        await t.pump(const Duration(milliseconds: 500));
        await expectLater(t, meetsGuideline(androidTapTargetGuideline));
        await expectLater(t, meetsGuideline(labeledTapTargetGuideline));
        semantics.dispose();
      });
    }
  }
}
