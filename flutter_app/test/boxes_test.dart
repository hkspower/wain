// One box system, as on the web (7 October, the owner's picks from the boxes
// canvas): a card has the outer corner, 20; an inner box sits on sand-100,
// not on sand-50 — which is #ffffff, the panel's own white, so the plan line
// showed only by its border; and a badge casts no shadow. The web's half is
// tests/boxes.test.mjs.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/share/hangout_panel.dart';
import 'package:wain/theme/tokens.g.dart';
import 'package:wain/widgets/place_card.dart';

final _wednesday = DateTime.utc(2026, 12, 16, 11, 5);

Future<void> _pump(WidgetTester t, Widget w) async {
  t.view.physicalSize = const Size(780, 1600);
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  await t.pumpWidget(
    MaterialApp(
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (c, child) =>
          Directionality(textDirection: TextDirection.rtl, child: child!),
      home: Scaffold(body: SingleChildScrollView(child: w)),
    ),
  );
  await t.pump();
  await t.pump();
}

BoxDecoration _deco(WidgetTester t, Finder f) {
  final w = t.widget(f);
  if (w is Container) return w.decoration! as BoxDecoration;
  if (w is Ink) return w.decoration! as BoxDecoration;
  throw StateError('no decoration on ${w.runtimeType}');
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
    'a place card has the outer corner, and its rating casts no shadow',
    (t) async {
      final place = getPlace('the-avenues')!;
      expect(
        place.rating,
        isNotNull,
        reason: 'the fixture needs a rated place',
      );
      await _pump(t, SizedBox(width: 200, child: PlaceCard(place: place)));
      final card = _deco(
        t,
        find
            .descendant(of: find.byType(PlaceCard), matching: find.byType(Ink))
            .first,
      );
      expect(card.borderRadius, BorderRadius.circular(WainRadius.s3xl));
      final chip = find.descendant(
        of: find.byWidgetPredicate(
          (w) =>
              w is Semantics &&
              (w.properties.label ?? '').startsWith('التقييم'),
        ),
        matching: find.byType(Container),
      );
      expect(chip, findsWidgets);
      expect(_deco(t, chip.first).boxShadow, anyOf(isNull, isEmpty));
    },
  );

  testWidgets(
    'the plan line is an inner box: sand-100, no border, inside a white panel',
    (t) async {
      await _pump(
        t,
        ShareHangout(place: getPlace('the-avenues')!, clock: () => _wednesday),
      );
      final line = _deco(t, find.byKey(const ValueKey('hangout-plan-line')));
      expect(line.color, WainColors.sand100);
      expect(line.color, isNot(Colors.white));
      expect(line.border, isNull);
      expect(line.borderRadius, BorderRadius.circular(WainRadius.s2xl));
    },
  );
}
