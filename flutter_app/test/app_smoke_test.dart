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
  _backSwipeTests();
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
    '/places/kuwait-towers?when=tonight-8': 'الليلة الساعة ٨',
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
      expect(find.text('سالم'), findsWidgets);
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

  testWidgets('home: the dial says two things, and search is offered once', (
    t,
  ) async {
    await pumpAt(t, '/');
    // «make sun main hero with less text»: the question and one action.
    expect(find.text('إلى وين؟'), findsOneWidget);
    expect(find.text('ابدأ'), findsOneWidget);
    expect(find.text('اضغط ودوّر حواليك'), findsNothing);
    expect(find.text('اكتب أو كلّم شوق'), findsNothing);
    // The tab bar's «بحث» is the way to search; the home no longer draws a
    // second one under the dial.
    expect(find.text('دوّر باسم المكان'), findsNothing);
    expect(find.text('بحث'), findsWidgets);
  });
}

// An iPhone has no back button: a pushed screen must answer the edge swipe.
// Every route used to be go_router's NoTransitionPage, which has no gesture,
// so a place opened from search could be left only by its breadcrumb — found
// on the simulator suite (integration_test/app_test.dart). Right-to-left app,
// so the swipe starts at the RIGHT edge.
Future<void> swipeBack(WidgetTester t) async {
  final w = t.view.physicalSize.width / t.view.devicePixelRatio;
  final g = await t.startGesture(Offset(w - 4, 400));
  for (var i = 1; i <= 10; i++) {
    await g.moveTo(Offset(w - 4 - i * w * 0.07, 400));
    await t.pump(const Duration(milliseconds: 16));
  }
  await g.up();
  // Fixed steps, not pumpAndSettle: the home's sky never stops moving.
  for (var i = 0; i < 10; i++) {
    await t.pump(const Duration(milliseconds: 80));
  }
}

void _backSwipeTests() {
  testWidgets('iOS: the edge swipe goes back from a place to search', (
    t,
  ) async {
    debugTileUrl = '';
    addTearDown(() => debugTileUrl = null);
    await pumpAt(t, '/search');
    await t.enterText(find.byKey(const ValueKey('search-input')), 'قهوة');
    await t.pump(const Duration(milliseconds: 400));
    final row = find.byWidgetPredicate(
      (w) =>
          w.key is ValueKey<String> &&
          (w.key! as ValueKey<String>).value.startsWith('result-place:'),
    );
    expect(row, findsWidgets);
    await t.ensureVisible(row.first);
    await t.tap(row.first);
    await t.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.byKey(const ValueKey('search-input')), findsNothing);
    await swipeBack(t);
    expect(find.byKey(const ValueKey('search-input')), findsOneWidget);
  }, variant: TargetPlatformVariant.only(TargetPlatform.iOS));

  testWidgets('iOS: and from /find to home', (t) async {
    debugTileUrl = '';
    addTearDown(() => debugTileUrl = null);
    await pumpAt(t, '/');
    await t.tap(find.text('ابدأ'));
    await t.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.text('إلى وين؟'), findsNothing);
    await swipeBack(t);
    expect(find.text('إلى وين؟'), findsOneWidget);
  }, variant: TargetPlatformVariant.only(TargetPlatform.iOS));
}
