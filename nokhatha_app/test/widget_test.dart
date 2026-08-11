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

  testWidgets('a phone gets the bottom bar; a Windows window gets a rail',
      (tester) async {
    // Desktop and phone are different shapes, not one shape at two sizes: a
    // 1280px-wide bottom bar with four items adrift in the middle is a phone
    // layout that has been stretched, and it looks like one.
    tester.view.physicalSize = const Size(1280, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(const NokhathaApp());
    await tester.pumpAndSettle();
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);

    tester.view.physicalSize = const Size(390, 800);
    await tester.pumpWidget(const NokhathaApp());
    await tester.pumpAndSettle();
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.byType(NavigationRail), findsNothing);
  });
}
