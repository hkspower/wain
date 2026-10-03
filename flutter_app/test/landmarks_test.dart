// «معالم الكويت» under the home hero (LandmarksShow), the app's half of the
// web's tests/landmarks.test.mjs — direction A, «القصة», the owner's pick on
// the 3 October canvas: progress bars that are the clock and the way to jump,
// a pause pill that says what it will do, a swipe, reduced motion holding the
// first one with nothing ticking, and a tap opening the place on screen.
//
// The pictures are still drawn stand-ins, so the home leaves the show out; the
// gate's switch (landmark_gate.dart) is flipped where a test needs it there.
import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:wain/data/landmark_gate.dart';
import 'package:wain/data/landmarks.g.dart';
import 'package:wain/map/wain_map.dart';
import 'package:wain/screens/home_screen.dart';
import 'package:wain/widgets/illustrative_tag.dart';
import 'package:wain/widgets/landmark_picture.dart' show StandInFlag;
import 'package:wain/widgets/landmarks_show.dart';

import 'app_smoke_test.dart' show pumpAt;

Widget _host({bool calm = false}) {
  final router = GoRouter(
    routes: [
      GoRoute(
        path: '/',
        // Room below, so an up-or-down drag has a page to scroll.
        builder: (_, _) => Scaffold(
          body: ListView(
            children: const [LandmarksShow(), SizedBox(height: 1200)],
          ),
        ),
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

/// The switch that lets the home show stand-ins, on for one test.
void _showStandIns() {
  final was = debugShowStandIns;
  debugShowStandIns = true;
  addTearDown(() => debugShowStandIns = was);
}

const _slugs = [
  'kuwait-towers',
  'liberation-tower',
  'grand-mosque',
  'seif-palace',
  'souq-al-mubarakiya',
  'marina-beach',
];

// Written out, not built from the catalogue: this is what a screen reader says.
const _barLabels = [
  '١ من ٦، أبراج الكويت',
  '٢ من ٦، برج التحرير',
  '٣ من ٦، المسجد الكبير',
  '٤ من ٦، قصر السيف',
  '٥ من ٦، سوق المباركية',
  '٦ من ٦، شاطئ المارينا',
];

/// The slides mounted right now: one, once a crossfade has ended.
List<String> _slides(WidgetTester t) => [
  for (final e
      in find
          .byWidgetPredicate(
            (w) =>
                w.key is ValueKey<String> &&
                (w.key! as ValueKey<String>).value.startsWith(
                  'landmark-slide-',
                ),
          )
          .evaluate())
    (e.widget.key! as ValueKey<String>).value.substring(
      'landmark-slide-'.length,
    ),
];

void _expectOn(WidgetTester t, String slug) =>
    expect(_slides(t), [slug], reason: 'the slide on screen');

/// How full a landmark's bar is, 0 to 1, read off the screen.
double _fill(WidgetTester t, String slug) {
  final bar = find.byKey(ValueKey('landmark-bar-$slug'));
  final track = t.getRect(
    find.descendant(
      of: bar,
      matching: find.byKey(const ValueKey('landmark-bar-track')),
    ),
  );
  final fill = t.getRect(
    find.descendant(
      of: bar,
      matching: find.byKey(const ValueKey('landmark-bar-fill')),
    ),
  );
  return fill.width / track.width;
}

bool _selected(WidgetTester t, int i) =>
    t
        .getSemantics(find.bySemanticsLabel(_barLabels[i]))
        .getSemanticsData()
        .flagsCollection
        .isSelected ==
    Tristate.isTrue;

final _box = find.byKey(const ValueKey('landmarks-box'));

/// After a tap or a swipe: the frame that builds the next slide, then its
/// 700ms crossfade.
Future<void> _crossfade(WidgetTester t) async {
  await t.pump();
  await t.pump(const Duration(milliseconds: 800));
}

void main() {
  setUp(() => debugTileUrl = '');
  tearDown(() => debugTileUrl = null);

  test('six landmarks, in the order the owner picked', () {
    expect(kLandmarks.map((l) => l.slug).toList(), _slugs);
  });

  test('the home shows it only when every picture may be shown', () {
    expect(kShowLandmarks, kLandmarks.every((l) => !l.standIn));
    final was = debugShowStandIns;
    addTearDown(() => debugShowStandIns = was);
    debugShowStandIns = true;
    expect(kShowLandmarks, isTrue);
  });

  for (final size in const [Size(390, 844), Size(320, 568), Size(800, 1280)]) {
    final w = size.width.toInt();

    // Drawn stand-ins are not shipped as the «realistic» pictures the owner
    // asked for: the home leaves the show out until all six are real.
    testWidgets('home at ${w}px: no show while a picture is a stand-in', (
      t,
    ) async {
      await pumpAt(t, '/', size: size);
      if (kLandmarks.any((l) => l.standIn)) {
        expect(find.byType(LandmarksShow), findsNothing);
        expect(find.text('معالم الكويت'), findsNothing);
      } else {
        expect(find.byType(LandmarksShow), findsOneWidget);
      }
    });

    testWidgets('home at ${w}px, stand-ins switched on: edge to edge, fits', (
      t,
    ) async {
      _showStandIns();
      await pumpAt(t, '/', size: size);
      await t.scrollUntilVisible(
        _box,
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await t.pump();
      expect(find.byType(LandmarksShow), findsOneWidget);
      final box = t.getRect(_box);
      expect(box.left, closeTo(0, 0.5), reason: 'edge to edge');
      expect(box.width, closeTo(size.width, 0.5), reason: 'edge to edge');
      expect(
        box.height,
        closeTo(size.width < 600 ? box.width * 5 / 6 : box.width / 2, 0.5),
        reason: '6:5 on a phone, 2:1 from 600 wide',
      );
      final pill = t.getRect(find.bySemanticsLabel('وقّف العرض'));
      expect(pill.height, greaterThanOrEqualTo(48));
      for (final label in _barLabels) {
        final bar = t.getRect(find.bySemanticsLabel(label));
        expect(bar.height, greaterThanOrEqualTo(48), reason: label);
        expect(bar.width, greaterThanOrEqualTo(48), reason: label);
        expect(bar.top, closeTo(box.top, 0.5), reason: 'across the top');
      }
      expect(t.takeException(), isNull);
    });
  }

  testWidgets('six bars in order, the first on screen, its name at the foot', (
    t,
  ) async {
    await _pump(t);
    final box = t.getRect(_box);
    final rects = [
      for (final l in _barLabels) t.getRect(find.bySemanticsLabel(l)),
    ];
    for (var i = 1; i < rects.length; i++) {
      expect(
        rects[i].center.dx,
        lessThan(rects[i - 1].center.dx),
        reason: 'right to left, the way the row reads',
      );
    }
    _expectOn(t, 'kuwait-towers');
    expect(_selected(t, 0), isTrue);
    for (var i = 1; i < 6; i++) {
      expect(_selected(t, i), isFalse, reason: _barLabels[i]);
    }
    expect(find.text('أبراج الكويت'), findsOneWidget);
    expect(find.text('مدينة الكويت'), findsOneWidget);
    expect(find.text('شوف المكان'), findsOneWidget);
    // «صورة توضيحية», top-start, just under the bars.
    final tag = t.getRect(find.byType(IllustrativeTag));
    expect(tag.right, closeTo(box.right - 10, 0.5));
    expect(tag.top, greaterThanOrEqualTo(box.top + 48));
    expect(tag.top, lessThan(box.top + 60));
    // A drawn stand-in says so, as on the web: «رسم مؤقت» against the end
    // edge, a third of the way down — under the bars and the tag, above the
    // caption.
    final flag = t.getRect(find.byType(StandInFlag));
    expect(flag.left, closeTo(box.left, 0.5), reason: 'the end edge, the left');
    expect(flag.top, greaterThan(tag.bottom), reason: 'under the tag');
    expect(
      flag.bottom,
      lessThan(t.getRect(find.text('أبراج الكويت')).top),
      reason: 'above the caption',
    );
    // And it stays put while the picture drifts: inside the drift, it was
    // carried half out of the box.
    await t.pump(const Duration(seconds: 5));
    expect(
      t.getRect(find.byType(StandInFlag)).left,
      closeTo(box.left, 0.5),
      reason: 'five seconds into the drift',
    );
  });

  testWidgets('the bar is the clock: it fills from the right over six '
      'seconds, then the show moves on', (t) async {
    await _pump(t);
    expect(_fill(t, 'kuwait-towers'), closeTo(0, 0.02));
    await t.pump(const Duration(seconds: 3));
    expect(_fill(t, 'kuwait-towers'), closeTo(0.5, 0.02));
    final bar = find.byKey(const ValueKey('landmark-bar-kuwait-towers'));
    final track = t.getRect(
      find.descendant(
        of: bar,
        matching: find.byKey(const ValueKey('landmark-bar-track')),
      ),
    );
    final fill = t.getRect(
      find.descendant(
        of: bar,
        matching: find.byKey(const ValueKey('landmark-bar-fill')),
      ),
    );
    expect(fill.right, closeTo(track.right, 0.5), reason: 'from the right');
    expect(_fill(t, 'liberation-tower'), 0);
    _expectOn(t, 'kuwait-towers');

    await t.pump(const Duration(seconds: 3));
    expect(_fill(t, 'kuwait-towers'), closeTo(1, 0.001));
    // A controller completes on the first frame past its end: that frame
    // moves the show on and starts the crossfade.
    await t.pump(const Duration(milliseconds: 16));
    await t.pump(const Duration(milliseconds: 800));
    _expectOn(t, 'liberation-tower');
    expect(_selected(t, 1), isTrue);
    expect(_selected(t, 0), isFalse);
    expect(_fill(t, 'kuwait-towers'), 1, reason: 'the one that has been');
    expect(_fill(t, 'liberation-tower'), closeTo(0.8 / 6, 0.02));
    expect(_fill(t, 'grand-mosque'), 0);
  });

  testWidgets('tapping the third bar jumps to the third', (t) async {
    await _pump(t);
    await t.tap(find.bySemanticsLabel(_barLabels[2]));
    await _crossfade(t);
    _expectOn(t, 'grand-mosque');
    expect(_selected(t, 2), isTrue);
    expect(_selected(t, 0), isFalse);
    expect(_fill(t, 'kuwait-towers'), 1);
    expect(_fill(t, 'liberation-tower'), 1);
    expect(_fill(t, 'seif-palace'), 0);
    expect(find.text('المسجد الكبير'), findsOneWidget);
    expect(find.textContaining('place:'), findsNothing, reason: 'no push');
  });

  testWidgets('«وقّف» stops the clock and says «كمّل»; «كمّل» finishes the '
      'same six seconds', (t) async {
    await _pump(t);
    expect(find.text('وقّف'), findsOneWidget);
    await t.pump(const Duration(seconds: 2));
    await t.tap(find.bySemanticsLabel('وقّف العرض'));
    await t.pump();
    expect(find.bySemanticsLabel('كمّل العرض'), findsOneWidget);
    expect(find.bySemanticsLabel('وقّف العرض'), findsNothing);
    expect(find.text('كمّل'), findsOneWidget);
    expect(find.text('وقّف'), findsNothing);
    final held = _fill(t, 'kuwait-towers');
    expect(held, closeTo(1 / 3, 0.02));

    await t.pump(const Duration(seconds: 13));
    _expectOn(t, 'kuwait-towers');
    expect(_fill(t, 'kuwait-towers'), held, reason: 'the bar holds its place');
    expect(t.hasRunningAnimations, isFalse, reason: 'nothing ticks');

    await t.tap(find.bySemanticsLabel('كمّل العرض'));
    await t.pump();
    expect(find.text('وقّف'), findsOneWidget);
    await t.pump(const Duration(seconds: 3));
    _expectOn(t, 'kuwait-towers');
    await t.pump(const Duration(milliseconds: 1500));
    await t.pump(const Duration(milliseconds: 800));
    _expectOn(t, 'liberation-tower');
  });

  testWidgets('a sideways swipe moves it: right is the next, left the one '
      'before', (t) async {
    await _pump(t);
    await t.drag(_box, const Offset(150, 0));
    await _crossfade(t);
    _expectOn(t, 'liberation-tower');
    await t.drag(_box, const Offset(-150, 0));
    await _crossfade(t);
    _expectOn(t, 'kuwait-towers');
    await t.drag(_box, const Offset(-150, 0));
    await _crossfade(t);
    _expectOn(t, 'marina-beach');
    expect(find.textContaining('place:'), findsNothing, reason: 'no push');
  });

  // The web's threshold: 40 of finger travel, counted from where it landed.
  testWidgets('a swipe of 50 is enough, and 30 is not', (t) async {
    await _pump(t);
    await t.drag(_box, const Offset(30, 0));
    await _crossfade(t);
    _expectOn(t, 'kuwait-towers');
    await t.drag(_box, const Offset(50, 0));
    await _crossfade(t);
    _expectOn(t, 'liberation-tower');
  });

  testWidgets('an up-or-down drag is still the page\'s', (t) async {
    await _pump(t);
    final page = t.state<ScrollableState>(find.byType(Scrollable).first);
    expect(page.position.pixels, 0);
    await t.drag(_box, const Offset(0, -200));
    await t.pump(const Duration(milliseconds: 800));
    expect(page.position.pixels, greaterThan(100));
    _expectOn(t, 'kuwait-towers');
    expect(find.textContaining('place:'), findsNothing, reason: 'no push');
  });

  testWidgets('reduced motion: the first stays with its bar full, nothing '
      'ticks, and the bars and a swipe still work', (t) async {
    await _pump(t, calm: true);
    expect(t.hasRunningAnimations, isFalse);
    await t.pump(const Duration(seconds: 13));
    _expectOn(t, 'kuwait-towers');
    expect(_fill(t, 'kuwait-towers'), 1, reason: 'full, to say which one');
    expect(_fill(t, 'liberation-tower'), 0);
    expect(t.hasRunningAnimations, isFalse);

    await t.tap(find.bySemanticsLabel(_barLabels[3]));
    await t.pump();
    _expectOn(t, 'seif-palace');
    expect(_fill(t, 'seif-palace'), 1);
    expect(_fill(t, 'grand-mosque'), 1);
    expect(_fill(t, 'souq-al-mubarakiya'), 0);
    expect(t.hasRunningAnimations, isFalse);

    await t.drag(_box, const Offset(150, 0));
    await t.pump();
    _expectOn(t, 'souq-al-mubarakiya');
    expect(t.hasRunningAnimations, isFalse);
    await t.pump(const Duration(seconds: 13));
    _expectOn(t, 'souq-al-mubarakiya');
  });

  testWidgets('a tap on the slide opens its place', (t) async {
    await _pump(t);
    await t.tap(find.bySemanticsLabel(_barLabels[1]));
    await _crossfade(t);
    await t.tap(find.byKey(const ValueKey('landmark-slide-liberation-tower')));
    for (var i = 0; i < 10; i++) {
      await t.pump(const Duration(milliseconds: 100));
    }
    expect(find.text('place:liberation-tower'), findsOneWidget);
  });

  for (final size in const [Size(320, 568), Size(390, 844), Size(800, 1280)]) {
    testWidgets('no overflow at ${size.width.toInt()}px, through all six', (
      t,
    ) async {
      await _pump(t, size: size);
      for (var i = 0; i < 6; i++) {
        await t.tap(find.bySemanticsLabel(_barLabels[i]));
        await _crossfade(t);
        expect(t.takeException(), isNull, reason: _slugs[i]);
      }
    });
  }

  testWidgets('no overflow at 320px with the text 1.3× larger', (t) async {
    t.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
    await _pump(t, size: const Size(320, 568));
    expect(
      MediaQuery.textScalerOf(t.element(_box)).scale(1),
      closeTo(1.3, 0.001),
    );
    for (var i = 0; i < 6; i++) {
      await t.tap(find.bySemanticsLabel(_barLabels[i]));
      await _crossfade(t);
      expect(t.takeException(), isNull, reason: _slugs[i]);
    }
  });
}
