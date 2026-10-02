// «معالم الكويت» under the home hero (LandmarksShow), the app's half of the
// web's tests/landmarks.test.mjs: one landmark at a time, moving on by itself,
// a stop button that stops it, reduced motion holding the first one, and a tap
// opening the place on screen.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:wain/data/landmarks.g.dart';
import 'package:wain/map/wain_map.dart';
import 'package:wain/widgets/landmarks_show.dart';

import 'app_smoke_test.dart' show pumpAt;

Widget _host({bool calm = false}) {
  final router = GoRouter(
    routes: [
      GoRoute(
        path: '/',
        builder: (_, _) =>
            const Scaffold(body: SingleChildScrollView(child: LandmarksShow())),
      ),
      GoRoute(
        path: '/places/:slug',
        builder: (_, s) => Text('place:${s.pathParameters['slug']}'),
      ),
    ],
  );
  return MaterialApp.router(
    routerConfig: router,
    builder: (context, w) => MediaQuery(
      data: MediaQuery.of(context).copyWith(disableAnimations: calm),
      child: Directionality(textDirection: TextDirection.rtl, child: w!),
    ),
  );
}

Future<void> _pump(
  WidgetTester t, {
  bool calm = false,
  Size size = const Size(390, 844),
}) async {
  t.view.physicalSize = size * 2;
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  await t.pumpWidget(_host(calm: calm));
  await t.pump();
}

// Which slide is up. Each is keyed by its slug, and the switcher keeps only the
// one on screen once a crossfade has ended.
const _names = {
  'أبراج الكويت': 'kuwait-towers',
  'برج التحرير': 'liberation-tower',
};
bool _showing(String name) =>
    find.byKey(ValueKey(_names[name]!)).evaluate().isNotEmpty;

void main() {
  setUp(() => debugTileUrl = '');
  tearDown(() => debugTileUrl = null);

  test('six landmarks, in the order the owner picked', () {
    expect(kLandmarks.map((l) => l.slug).toList(), [
      'kuwait-towers',
      'liberation-tower',
      'grand-mosque',
      'seif-palace',
      'souq-al-mubarakiya',
      'marina-beach',
    ]);
  });

  testWidgets('it moves on by itself, one at a time', (t) async {
    await _pump(t);
    expect(find.text('معالم الكويت'), findsOneWidget);
    expect(_showing('أبراج الكويت'), isTrue);
    expect(_showing('برج التحرير'), isFalse);
    await t.pump(const Duration(seconds: 6));
    await t.pump(const Duration(seconds: 1));
    expect(_showing('برج التحرير'), isTrue);
    expect(
      _showing('أبراج الكويت'),
      isFalse,
      reason: 'the crossfade ends with one slide',
    );
  });

  testWidgets('the stop button stops it, and starts it again', (t) async {
    await _pump(t);
    final stop = find.bySemanticsLabel('وقّف الحركة');
    expect(stop, findsOneWidget);
    expect(t.getSize(stop).shortestSide, greaterThanOrEqualTo(48));
    await t.tap(stop);
    await t.pump();
    expect(find.bySemanticsLabel('شغّل الحركة'), findsOneWidget);
    await t.pump(const Duration(seconds: 13));
    expect(
      _showing('أبراج الكويت'),
      isTrue,
      reason: 'still on the first after two turns',
    );
    await t.tap(find.bySemanticsLabel('شغّل الحركة'));
    await t.pump(const Duration(seconds: 6));
    await t.pump(const Duration(seconds: 1));
    expect(_showing('برج التحرير'), isTrue);
  });

  testWidgets('reduced motion: the first stays and nothing moves', (t) async {
    await _pump(t, calm: true);
    await t.pump(const Duration(seconds: 13));
    expect(_showing('أبراج الكويت'), isTrue);
    expect(t.hasRunningAnimations, isFalse);
  });

  testWidgets('a tap opens the place on screen', (t) async {
    await _pump(t);
    await t.pump(const Duration(seconds: 6));
    await t.pump(const Duration(seconds: 1));
    await t.tap(find.byKey(const ValueKey('liberation-tower')));
    await t.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.text('place:liberation-tower'), findsOneWidget);
  });

  for (final size in const [Size(390, 844), Size(320, 568), Size(800, 1280)]) {
    testWidgets('home at ${size.width.toInt()}px: the show is under the hero', (
      t,
    ) async {
      await pumpAt(t, '/', size: size);
      await t.scrollUntilVisible(
        find.text('معالم الكويت'),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await t.pump();
      expect(find.byType(LandmarksShow), findsOneWidget);
      expect(_showing('أبراج الكويت'), isTrue);
    });
  }
}
