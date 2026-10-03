// The 3 October UX pass, mirrored from the web: the empty /search offers ways
// on (call شوق, browse by category, the featured places) instead of a numbered
// line that read like a stepper; filter chips name only the kinds a query
// found; Home's featured rail has a heading; a place page has one way back.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/data/search.dart';
import 'package:wain/map/wain_map.dart';
import 'package:wain/widgets/place_card.dart';

import 'app_smoke_test.dart' show pumpAt;

void main() {
  setUp(() => debugTileUrl = '');
  tearDown(() => debugTileUrl = null);

  for (final size in const [Size(390, 844), Size(320, 568)]) {
    testWidgets('empty /search offers ways on at ${size.width.toInt()}px', (
      t,
    ) async {
      await pumpAt(t, '/search', size: size);
      expect(t.takeException(), isNull);
      expect(find.textContaining('دوّر بالكتابة'), findsNothing);
      expect(find.textContaining('عالخريطة'), findsNothing);
      expect(find.text('تبي تحكي بدال ما تكتب؟'), findsOneWidget);
      expect(find.byKey(const ValueKey('search-call-link')), findsOneWidget);
      expect(find.text('دوّر بالتصنيف'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('search-category-coffee')),
        findsOneWidget,
      );
      expect(find.text('أماكن ما تنقال عنها لا'), findsOneWidget);
      // Lazy grid: scroll to the end so every card is built and laid out.
      await t.scrollUntilVisible(
        find.byType(PlaceCard).last,
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await t.pump();
      expect(t.takeException(), isNull);
      expect(find.byType(PlaceCard), findsNWidgets(6));
    });
  }

  testWidgets('a category chip on the empty /search opens Explore on it', (
    t,
  ) async {
    await pumpAt(t, '/search');
    final chip = find.byKey(const ValueKey('search-category-coffee'));
    await t.ensureVisible(chip);
    await t.tap(chip);
    await t.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.textContaining('استكشف الكويت'), findsWidgets);
    expect(find.textContaining('٥٢ نتيجة'), findsNothing);
  });

  testWidgets('a query shows chips only for the kinds it found', (t) async {
    // Verified against the engine, so the absence below means something.
    final kinds = {for (final h in search('قهوة', searchIndex)) h.doc.kind};
    expect(kinds, containsAll(['place', 'category']));
    expect(kinds, isNot(contains('area')));
    expect(kinds, isNot(contains('page')));

    await pumpAt(t, '/search?q=قهوة');
    expect(find.byKey(const ValueKey('kind-all')), findsOneWidget);
    expect(find.byKey(const ValueKey('kind-place')), findsOneWidget);
    expect(find.byKey(const ValueKey('kind-category')), findsOneWidget);
    expect(find.byKey(const ValueKey('kind-area')), findsNothing);
    expect(find.byKey(const ValueKey('kind-page')), findsNothing);
    expect(find.text('مناطق'), findsNothing);
    expect(find.text('صفحات'), findsNothing);
  });

  testWidgets('a query with no results draws no chip row at all', (t) async {
    await pumpAt(t, '/search?q=zzzzzz');
    expect(find.byKey(const ValueKey('kind-all')), findsNothing);
    expect(find.text('الكل'), findsNothing);
  });

  testWidgets('home names its featured rail', (t) async {
    await pumpAt(t, '/');
    final heading = find.text('أماكن ما تنقال عنها لا', skipOffstage: false);
    await t.scrollUntilVisible(
      heading,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(heading, findsOneWidget);
    expect(find.text('شوف الكل'), findsOneWidget);
    expect(t.takeException(), isNull);
  });

  for (final size in const [Size(390, 844), Size(320, 568)]) {
    testWidgets('a place page has no «استكشف» breadcrumb at '
        '${size.width.toInt()}px', (t) async {
      await pumpAt(t, '/places/kuwait-towers', size: size);
      expect(t.takeException(), isNull);
      expect(find.text('أبراج الكويت'), findsWidgets);
      // The exact breadcrumb word; the tab bar's «استكشف» sits outside the
      // page, so only widgets under the place page's own list count.
      final page = find.byType(ListView).first;
      expect(
        find.descendant(of: page, matching: find.text('استكشف')),
        findsNothing,
      );
      expect(find.text(' / '), findsNothing);
    });
  }
}
