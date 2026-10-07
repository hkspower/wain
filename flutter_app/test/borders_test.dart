// One edge system, as on the web (7 October, the owner's border picks): a
// button or a field is outlined in line-control (3.30:1 on white), never in
// the cards' own line (1.42:1), which leaves a control with no edge anyone can
// find. The web's half is tests/borders.test.mjs and audit:theme's «edges».
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/share/hangout_panel.dart';
import 'package:wain/theme/tokens.g.dart';

final _wednesday = DateTime.utc(2026, 12, 16, 11, 5);

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('an unchosen time chip has the control edge', (t) async {
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
        home: Scaffold(
          body: SingleChildScrollView(
            child: ShareHangout(
              place: getPlace('the-avenues')!,
              clock: () => _wednesday,
            ),
          ),
        ),
      ),
    );
    await t.pump();
    await t.pump();
    await t.tap(find.byKey(const ValueKey('hangout-change')));
    await t.pumpAndSettle();
    final sides = t
        .widgetList<Material>(
          find.descendant(
            of: find.byType(ShareHangout),
            matching: find.byWidgetPredicate(
              (w) => w is Material && w.shape is StadiumBorder,
            ),
          ),
        )
        .map((m) => (m.shape! as StadiumBorder).side)
        .where((s) => s != BorderSide.none)
        .toList();
    expect(sides, isNotEmpty, reason: 'the chips are open');
    for (final s in sides) {
      expect(s.color, WainColors.lineControl);
    }
  });

  // Every OutlinedButton and every text field is a control by construction,
  // so the rule can be read straight off the source, the way audit:theme reads
  // the site's class strings.
  test('no button or field is outlined in the cards\' line', () {
    final offenders = <String>[];
    for (final f in Directory('lib').listSync(recursive: true)) {
      if (f is! File || !f.path.endsWith('.dart')) continue;
      final src = f.readAsStringSync();
      for (final m in RegExp(
        r'(OutlinedButton\.styleFrom|OutlineInputBorder|StadiumBorder)\([^;]*?BorderSide\(color: WainColors\.line\)',
        dotAll: true,
      ).allMatches(src)) {
        final line = src.substring(0, m.start).split('\n').length;
        offenders.add('${f.path}:$line');
      }
    }
    expect(offenders, isEmpty);
  });
}
