// Every route, phone-sized and small-phone-sized, must build and lay out
// without an exception (a RenderFlex overflow IS an exception in tests).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/data/places.g.dart';
import 'package:wain/main.dart';
import 'package:wain/map/wain_map.dart';

Future<void> pumpAt(
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

  final routes = {
    '/': 'وين الطلعة اليوم؟',
    '/find': 'اتصال',
    '/explore': 'استكشف الكويت',
    '/explore?category=coffee': 'استكشف الكويت',
    '/search': 'دوّر في وين',
    '/about': 'وين؟ شنو هذا',
    '/privacy': 'ما نتتبّعك — أبداً',
    '/add': 'سجّل مكانك في وين',
    '/places/kuwait-towers': 'أبراج الكويت',
    '/places/kuwait-towers?when=tonight-8': 'دعوة: الليلة الساعة ٨',
    '/places/nope': 'وين رايح؟',
    '/nowhere': 'وين رايح؟',
  };

  for (final size in const [Size(390, 844), Size(320, 568)]) {
    for (final e in routes.entries) {
      testWidgets('${e.key} at ${size.width.toInt()}px', (t) async {
        await pumpAt(t, e.key, size: size);
        expect(find.textContaining(e.value), findsWidgets);
        expect(t.takeException(), isNull);
      });
    }
  }

  testWidgets(
    '/salem builds and shows it is connecting (no network in tests)',
    (t) async {
      await pumpAt(t, '/salem');
      expect(find.text('شوق'), findsWidgets);
      expect(t.takeException(), isNull);
      await t.pumpWidget(const SizedBox());
    },
  );

  testWidgets('all 52 place pages lay out at 320px', (t) async {
    for (final p in kPlaces) {
      // A fresh app per page: the router is built once per app instance.
      await t.pumpWidget(const SizedBox());
      await pumpAt(t, '/places/${p.slug}', size: const Size(320, 568));
      expect(find.text(p.nameAr), findsWidgets, reason: p.slug);
      expect(t.takeException(), isNull, reason: p.slug);
    }
  });

  testWidgets(
    'search: typing ranks results, shows the map and the hangout panel for the active place',
    (t) async {
      await pumpAt(t, '/search');
      await t.enterText(find.byKey(const ValueKey('search-input')), 'قهوة');
      await t.pump(const Duration(milliseconds: 400));
      expect(find.byKey(const ValueKey('search-map')), findsOneWidget);
      expect(find.byKey(const ValueKey('search-hangout')), findsOneWidget);
      expect(find.textContaining('رسّلها للربع'), findsWidgets);
      expect(t.takeException(), isNull);
    },
  );

  testWidgets('search: nothing found offers a way on instead of a dead end', (
    t,
  ) async {
    await pumpAt(t, '/search');
    await t.enterText(find.byKey(const ValueKey('search-input')), 'صيدلية');
    await t.pump(const Duration(milliseconds: 400));
    expect(find.textContaining('ما لقينا شي عن «صيدلية»'), findsOneWidget);
    expect(find.text('تصفّح كل الأماكن'), findsOneWidget);
    expect(t.takeException(), isNull);
  });

  testWidgets('/search?q= arrives filled in (the route a call sends her to)', (
    t,
  ) async {
    await pumpAt(t, '/search?q=${Uri.encodeQueryComponent('بحر')}');
    expect(find.byKey(const ValueKey('search-map')), findsOneWidget);
    expect(t.takeException(), isNull);
  });

  testWidgets('explore: a category chip filters, «امسح الفلاتر» restores', (
    t,
  ) async {
    await pumpAt(t, '/explore');
    expect(find.textContaining('٥٢ نتيجة'), findsOneWidget);
    await t.tap(find.text('قهوة').first);
    await t.pump();
    expect(find.textContaining('٥٢ نتيجة'), findsNothing);
    await t.enterText(find.byType(TextField), 'zzzzzz');
    await t.pump();
    expect(find.text('ما لقينا شي'), findsOneWidget);
    await t.tap(find.text('امسح الفلاتر'));
    await t.pump();
    expect(find.textContaining('٥٢ نتيجة'), findsOneWidget);
  });

  testWidgets('bottom tabs move between the three main screens', (t) async {
    await pumpAt(t, '/');
    await t.tap(find.text('استكشف').last);
    await t.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.text('استكشف الكويت'), findsOneWidget);
    await t.tap(find.text('بحث').last);
    await t.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.text('دوّر في وين'), findsOneWidget);
  });
}
