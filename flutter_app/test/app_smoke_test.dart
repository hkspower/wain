// Every route, phone-sized and small-phone-sized, must build and lay out
// without an exception (a RenderFlex overflow IS an exception in tests).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:wain/app/deep_link.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/data/home_hero.g.dart';
import 'package:wain/data/places.g.dart';
import 'package:wain/main.dart';
import 'package:wain/map/wain_map.dart';
import 'package:wain/screens/home_screen.dart';

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
  _nativeNavigationTests();
  setUp(() => debugTileUrl = '');
  tearDown(() => debugTileUrl = null);

  final routes = {
    '/': 'إلى وين؟',
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

  // iPhone-only, and Android tablets are told «portrait» — but Android 16
  // ignores that on large screens, so a tablet may lay these out anyway.
  for (final size in const [Size(800, 1280), Size(1280, 800)]) {
    for (final r in [
      '/',
      '/explore',
      '/search?q=قهوة',
      '/places/kuwait-towers',
      '/find',
    ]) {
      testWidgets(
        '$r on a tablet ${size.width.toInt()}×${size.height.toInt()}',
        (t) async {
          await pumpAt(t, r, size: size);
          expect(t.takeException(), isNull);
        },
      );
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
    expect(find.text('ابحث'), findsOneWidget);
    expect(find.text('اضغط ودوّر حواليك'), findsNothing);
    expect(find.text('اكتب أو كلّم شوق'), findsNothing);
    // The tab bar's «بحث» is the way to search; the home no longer draws a
    // second one under the dial.
    expect(find.text('دوّر باسم المكان'), findsNothing);
    expect(find.text('بحث'), findsWidgets);
  });

  // The hero is the owner's picture (2 October) and its sun is the button.
  // Placing a control on a picture is a promise about pixels the layout never
  // sees; the web's audit:home-hero reads the master under each control, and
  // this holds the app to the same numbers: the button IS the disc, and the
  // label sits inside the part of it nothing stands in front of.
  for (final size in const [Size(390, 844), Size(320, 568), Size(800, 1280)]) {
    testWidgets(
      'home at ${size.width.toInt()}px: the picture is whole and its sun is the button',
      (t) async {
        await pumpAt(t, '/', size: size);
        final img = t.getRect(
          find.byWidgetPredicate(
            (w) =>
                w is Image &&
                w.image is AssetImage &&
                (w.image as AssetImage).assetName == kHomeHeroAsset,
          ),
        );
        expect(
          img.height / img.width,
          closeTo(kHomeHeroHeight / kHomeHeroWidth, 0.01),
          reason: 'never cropped or stretched',
        );
        expect(img.left, greaterThanOrEqualTo(-0.5));
        expect(img.right, lessThanOrEqualTo(size.width + 0.5));

        final sun = t.getRect(find.byKey(const ValueKey('home-sun')));
        expect(sun.width, closeTo(sun.height, 0.5));
        expect(sun.width, closeTo(2 * kHomeHeroSunR * img.width, 1));
        expect(sun.center.dx, closeTo(img.left + kHomeHeroSunX * img.width, 1));
        expect(sun.center.dy, closeTo(img.top + kHomeHeroSunY * img.height, 1));

        final zone = Rect.fromLTRB(
          img.left + kHomeHeroLabel.left * img.width,
          img.top + kHomeHeroLabel.top * img.height,
          img.left + kHomeHeroLabel.right * img.width,
          img.top + kHomeHeroLabel.bottom * img.height,
        ).inflate(0.5);
        for (final text in ['إلى وين؟', 'ابحث']) {
          final r = t.getRect(find.text(text));
          expect(
            zone.contains(r.topLeft) && zone.contains(r.bottomRight),
            isTrue,
            reason: '«$text» at $r is outside the clear part of the sun, $zone',
          );
        }
        expect(t.takeException(), isNull);
      },
    );
  }

  // On a phone the hero is the whole first screen (2 October, on request —
  // option B on the design canvas): the picture whole at full width, centred
  // in the space above the tab bar, sky above it and sea below.
  for (final size in const [Size(390, 844), Size(320, 640)]) {
    testWidgets(
      'home at ${size.width.toInt()}×${size.height.toInt()}: the hero fills the first screen',
      (t) async {
        await pumpAt(t, '/', size: size);
        final view = t.getRect(find.byType(ListView).first);
        final img = t.getRect(
          find.byWidgetPredicate(
            (w) =>
                w is Image &&
                w.image is AssetImage &&
                (w.image as AssetImage).assetName == kHomeHeroAsset,
          ),
        );
        final above = img.top - view.top, below = view.bottom - img.bottom;
        expect(above, greaterThan(1), reason: 'sky above the picture');
        expect(
          (above - below).abs(),
          lessThan(1),
          reason: 'centred: $above above, $below below',
        );
        expect(t.takeException(), isNull);
      },
    );
  }

  testWidgets('home: tapping the sun opens /find', (t) async {
    await pumpAt(t, '/');
    await t.tap(find.byKey(const ValueKey('home-sun')));
    for (var i = 0; i < 10; i++) {
      await t.pump(const Duration(milliseconds: 80));
    }
    expect(find.byKey(const ValueKey('find-call')), findsOneWidget);
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
    // Scrolled into the middle, not to the edge: `ensureVisible` stopped with
    // the row's centre past the viewport once /search's numbered line grew a
    // link (1 October), and the tap landed on the tab bar instead.
    Scrollable.ensureVisible(t.element(row.first), alignment: 0.5);
    await t.pump(const Duration(milliseconds: 300));
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
    await t.tap(find.text('ابحث'));
    await t.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.text('إلى وين؟'), findsNothing);
    await swipeBack(t);
    expect(find.text('إلى وين؟'), findsOneWidget);
  }, variant: TargetPlatformVariant.only(TargetPlatform.iOS));
}

/// The tab bar's own button — the page can carry the same word (Explore's
/// heading starts with «استكشف»).
Finder tab(String label) => find.descendant(
  of: find.byWidgetPredicate(
    (w) =>
        w is Semantics &&
        w.properties.label == label &&
        w.properties.selected != null,
  ),
  matching: find.text(label),
);

Future<void> settleSteps(WidgetTester t) async {
  // Fixed steps, not pumpAndSettle: the home's sky never stops moving.
  for (var i = 0; i < 8; i++) {
    await t.pump(const Duration(milliseconds: 80));
  }
}

void _nativeNavigationTests() {
  testWidgets('a tab keeps its state: the search survives a trip to Explore', (
    t,
  ) async {
    debugTileUrl = '';
    addTearDown(() => debugTileUrl = null);
    await pumpAt(t, '/search');
    await t.enterText(find.byKey(const ValueKey('search-input')), 'قهوة');
    await settleSteps(t);
    await t.tap(tab('استكشف'));
    await settleSteps(t);
    expect(find.textContaining('استكشف الكويت'), findsWidgets);
    await t.tap(tab('بحث'));
    await settleSteps(t);
    final field = t.widget<TextField>(
      find.byKey(const ValueKey('search-input')),
    );
    expect(field.controller?.text, 'قهوة');
  });

  testWidgets('Android back on Explore goes Home instead of closing the app', (
    t,
  ) async {
    await pumpAt(t, '/');
    await t.tap(tab('استكشف'));
    await settleSteps(t);
    expect(find.text('إلى وين؟'), findsNothing);
    await t.binding.handlePopRoute();
    await settleSteps(t);
    expect(find.text('إلى وين؟'), findsOneWidget);
  });

  testWidgets('a place opened from a link has Home behind it', (t) async {
    await pumpAt(t, '/');
    final router = GoRouter.of(t.element(find.byType(HomeScreen)));
    openLink(router, Uri.parse('https://www.wainkw.com/places/kuwait-towers/'));
    await settleSteps(t);
    expect(find.text('أبراج الكويت'), findsWidgets);
    await t.binding.handlePopRoute();
    await settleSteps(t);
    expect(find.text('إلى وين؟'), findsOneWidget);
  });

  testWidgets('tapping the tab you are on scrolls it back to the top', (
    t,
  ) async {
    await pumpAt(t, '/explore');
    await t.drag(find.byType(CustomScrollView), const Offset(0, -1500));
    await settleSteps(t);
    final scroll = t.state<ScrollableState>(
      find
          .descendant(
            of: find.byType(CustomScrollView),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    expect(scroll.position.pixels, greaterThan(500));
    await t.tap(tab('استكشف'));
    await settleSteps(t);
    expect(scroll.position.pixels, 0);
  });
}
