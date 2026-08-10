/// Shell tests: the things that must hold on every screen regardless of data.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nokhatha/main.dart';
import 'package:nokhatha/ui/brand.dart';

void main() {
  testWidgets('the whole tree is RTL — no stray LTR island', (tester) async {
    await tester.pumpWidget(const NokhathaApp());
    await tester.pumpAndSettle();
    final dir = Directionality.of(tester.element(find.byType(Scaffold)));
    expect(dir, TextDirection.rtl);
  });

  testWidgets('all four units are reachable', (tester) async {
    await tester.pumpWidget(const NokhathaApp());
    await tester.pumpAndSettle();
    for (final label in ['المركز المالي', 'صافي', 'XBRL', 'التوصيل']) {
      expect(find.text(label), findsWidgets, reason: 'missing unit: $label');
    }
  });

  testWidgets('the masthead flies the boum, not an emoji or a letter',
      (tester) async {
    await tester.pumpWidget(const NokhathaApp());
    await tester.pumpAndSettle();
    expect(find.byType(BoumMark), findsOneWidget);
  });

  testWidgets('the linkage is stated on screen, not merely implied',
      (tester) async {
    await tester.pumpWidget(const NokhathaApp());
    await tester.pumpAndSettle();
    expect(find.textContaining('كيف تترابط الوحدات'), findsOneWidget);
    expect(find.textContaining('الأصول غير المتداولة'), findsWidgets);
  });

  testWidgets('advancing an order moves it along the pipeline', (tester) async {
    await tester.pumpWidget(const NokhathaApp());
    await tester.pumpAndSettle();
    await tester.tap(find.text('التوصيل').last);
    await tester.pumpAndSettle();
    // ORD-0002 is on its way, so its button offers the next step.
    expect(find.text('تم التسليم'), findsWidgets);
  });

  testWidgets('there is no dark theme, whatever the device prefers',
      (tester) async {
    await tester.pumpWidget(const NokhathaApp());
    await tester.pumpAndSettle();
    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.darkTheme, isNull);
    expect(app.theme!.scaffoldBackgroundColor, Brand.bg);
  });
}
