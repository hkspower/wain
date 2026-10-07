// One box system, as on the web (7 October, the owner's picks from the boxes
// canvas): a card has the outer corner, 20; an inner box sits on sand-100,
// not on sand-50 — which is #ffffff, the panel's own white, so the plan line
// showed only by its border; and a badge casts no shadow. The web's half is
// tests/boxes.test.mjs.
import 'dart:io';

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

  // The owner's second box pass (7 October, «improve all boxes size and
  // colors»), read off the source the way the site's audit:theme reads class
  // strings: one padding (16 — the app is a phone), one solid sand, one tint
  // per colour (sun50, palm at 8%), and the xs shadow. Pictures keep their
  // frame's shadow and pins theirs; neither is a box.
  test('boxes: one padding, one fill, one tint per colour, the xs shadow', () {
    final problems = <String>[];
    const pictures = {'art.dart', 'landmark_picture.dart', 'wain_map.dart'};
    for (final f in Directory('lib').listSync(recursive: true)) {
      if (f is! File || !f.path.endsWith('.dart')) continue;
      final name = f.uri.pathSegments.last;
      final src = f.readAsStringSync();
      String at(int i) => '${f.path}:${src.substring(0, i).split('\n').length}';
      for (final m in RegExp(
        r'sand100\.with(Values|Opacity|Alpha)\(',
      ).allMatches(src)) {
        problems.add('${at(m.start)} see-through sand');
      }
      for (final m in RegExp(r'BoxDecoration\(').allMatches(src)) {
        // The decoration's own text, up to its closing paren at depth 0.
        var depth = 0, i = m.end - 1;
        for (; i < src.length; i++) {
          if (src[i] == '(') depth++;
          if (src[i] == ')' && --depth == 0) break;
        }
        final deco = src.substring(m.start, i);
        final isBox =
            RegExp(r'WainRadius\.s(2|3)xl|const BorderRadius\.all|radius,')
                .hasMatch(deco) &&
            !deco.contains('BoxShape.circle');
        if (!isBox) continue;
        if (!pictures.contains(name) &&
            RegExp(r'boxShadow: WainShadows\.(sm|md|lg|xl)').hasMatch(deco)) {
          problems.add('${at(m.start)} shadow past xs');
        }
        if (RegExp(r'color:[^,]*sun100').hasMatch(deco)) {
          problems.add('${at(m.start)} sun100 box (sun50)');
        }
        for (final t in RegExp(
          r'(?<!border: Border\.all\(\s*)color:[^,]*palm(500|600)\.withValues\(alpha: ([\d.]+)\)',
        ).allMatches(deco)) {
          if (t.group(2) != '0.08')
            problems.add('${at(m.start)} palm at ${t.group(2)}');
        }
        // An outer box (the 20px corner) is padded 16. The padding sits just
        // before its decoration.
        if (deco.contains('WainRadius.s3xl')) {
          final before = src.substring(
            m.start > 160 ? m.start - 160 : 0,
            m.start,
          );
          final pad = RegExp(r'padding: const EdgeInsets\.all\((\d+)\),\s*$')
              .firstMatch(before.replaceAll(RegExp(r'decoration:\s*$'), ''));
          if (pad != null && int.parse(pad.group(1)!) > 16) {
            problems.add('${at(m.start)} padded ${pad.group(1)}');
          }
        }
      }
      for (final m in RegExp(
        r'Panel\(\s*padding: const EdgeInsets\.all\((\d+)\)',
      ).allMatches(src)) {
        if (int.parse(m.group(1)!) > 16)
          problems.add('${at(m.start)} Panel padded ${m.group(1)}');
      }
    }
    expect(problems, isEmpty);
  });
}
