import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/main.dart';
import 'package:wain/map/wain_map.dart';

/// The maps' layout, mirrored from the site on 7 October: /search's map is a
/// bar under the result count until it is opened, and then nearly square; the
/// place page's map is 1.25:1; سالم's chat map 230 tall.
Future<void> at(
  WidgetTester t,
  String location, {
  Size size = const Size(390, 844),
}) async {
  t.view.physicalSize = size * 2;
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  await t.pumpWidget(
    WainApp(state: AppState.ephemeral(), initialLocation: location),
  );
  await t.pump(const Duration(milliseconds: 400));
}

void main() {
  setUp(() => debugTileUrl = '');
  tearDown(() => debugTileUrl = null);

  final q = '/search?q=${Uri.encodeQueryComponent('قهوة')}';

  for (final size in const [Size(390, 844), Size(320, 640)]) {
    testWidgets(
      '/search at ${size.width.toInt()}: a bar until asked, then a tall map, then a bar again',
      (t) async {
        await at(t, q, size: size);
        expect(
          find.byKey(const ValueKey('search-map')),
          findsNothing,
          reason: 'no map — and no tiles — until the bar is tapped',
        );
        final bar = find.byKey(const ValueKey('search-map-bar'));
        expect(bar, findsOneWidget);
        expect(t.getSize(bar).height, greaterThanOrEqualTo(48));
        // The bar comes before the first result row.
        final firstRow = find.byWidgetPredicate(
          (w) =>
              w.key is ValueKey &&
              '${(w.key as ValueKey).value}'.startsWith('result-'),
        );
        expect(t.getRect(bar).top, lessThan(t.getRect(firstRow.first).top));

        await t.tap(bar);
        await t.pump(const Duration(milliseconds: 300));
        final map = find.byKey(const ValueKey('search-map'));
        expect(map, findsOneWidget);
        expect(
          t.getSize(map).height,
          greaterThanOrEqualTo(300),
          reason: 'the old map was a 260px letterbox',
        );
        expect(t.takeException(), isNull);

        await t.tap(find.byKey(const ValueKey('search-map-hide')));
        await t.pump(const Duration(milliseconds: 300));
        expect(find.byKey(const ValueKey('search-map')), findsNothing);
        expect(bar, findsOneWidget);
        expect(t.takeException(), isNull);
      },
    );
  }

  testWidgets('the place page map is 1.25:1 at 390, not 240 tall', (t) async {
    await at(t, '/places/kuwait-towers');
    final map = find.byType(WainMap);
    final s = t.getSize(map);
    expect(s.height, greaterThan(270), reason: '$s');
    expect((s.width / s.height - 1.25).abs(), lessThan(0.02), reason: '$s');
    expect(t.takeException(), isNull);
  });
}
