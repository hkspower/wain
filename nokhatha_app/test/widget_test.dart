/// Shell and flow tests.
///
/// Every test builds its own store over a temp directory: a suite that reads
/// or writes the real user's records is a suite that can destroy them.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nokhatha/core/vault.dart';
import 'package:nokhatha/main.dart';
import 'package:nokhatha/store.dart';
import 'package:nokhatha/ui/brand.dart';
import 'package:nokhatha/ui/shell_layout.dart';

/// In-memory storage. `testWidgets` runs inside a fake-async zone where a real
/// dart:io write never completes, so a widget test that touches the disk does
/// not fail — it hangs, which is worse. The disk behaviour is covered by
/// auth_test.dart, which runs as a plain test where real async works.
class MemoryVault implements VaultStore {
  Map<String, dynamic> data = {};

  @override
  Future<Map<String, dynamic>> read() async => Map.of(data);

  @override
  Future<void> write(Map<String, dynamic> d) async => data = Map.of(d);

  @override
  Future<String> location() async => '(memory)';
}

void main() {
  late MemoryVault vault;
  late Store store;

  setUp(() async {
    vault = MemoryVault();
    store = Store(vault: vault);
    await store.load();
  });

  Future<void> pump(WidgetTester tester) async {
    await tester.pumpWidget(NokhathaApp(store: store));
    await tester.pumpAndSettle();
  }

  Future<void> signIn(WidgetTester tester) async {
    await store.register(
        name: 'محمد', email: 'a@b.c', password: 'correct-horse-2026');
    await pump(tester);
  }

  testWidgets('a stranger sees the sign-in gate, not the records',
      (tester) async {
    await pump(tester);
    expect(find.text('تسجيل الدخول'), findsWidgets);
    expect(find.byType(AdaptiveShell), findsNothing);
  });

  testWidgets('the gate says where the records are kept, before you type them',
      (tester) async {
    await pump(tester);
    expect(find.textContaining('على هذا الجهاز وحده'), findsOneWidget);
    expect(find.textContaining('غير مشفَّرة'), findsOneWidget);
  });

  testWidgets('registering opens the system', (tester) async {
    await signIn(tester);
    expect(find.byType(AdaptiveShell), findsOneWidget);
  });

  testWidgets('the whole tree is RTL — no stray LTR island', (tester) async {
    await signIn(tester);
    expect(Directionality.of(tester.element(find.byType(Scaffold))),
        TextDirection.rtl);
  });

  testWidgets('all four units are reachable', (tester) async {
    await signIn(tester);
    for (final label in ['المركز المالي', 'صافي', 'XBRL', 'التوصيل']) {
      expect(find.text(label), findsWidgets, reason: 'missing unit: $label');
    }
  });

  testWidgets('the masthead flies the boum, not an emoji or a letter',
      (tester) async {
    await signIn(tester);
    expect(find.byType(BoumMark), findsWidgets);
  });

  testWidgets('the linkage is stated on screen, not merely implied',
      (tester) async {
    await signIn(tester);
    expect(find.textContaining('كيف تترابط الوحدات'), findsOneWidget);
  });

  testWidgets('there is no dark theme, whatever the device prefers',
      (tester) async {
    await signIn(tester);
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

    await signIn(tester);
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);

    tester.view.physicalSize = const Size(390, 800);
    await tester.pumpWidget(NokhathaApp(store: store));
    await tester.pumpAndSettle();
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.byType(NavigationRail), findsNothing);
  });

  testWidgets('a wrong password warns how many tries remain', (tester) async {
    await store.register(
        name: 'م', email: 'a@b.c', password: 'correct-horse-2026');
    await store.signOut();
    await pump(tester);

    await tester.enterText(find.byType(TextField).at(0), 'a@b.c');
    await tester.enterText(find.byType(TextField).at(1), 'wrong-password-1');
    await tester.tap(find.widgetWithText(FilledButton, 'تسجيل الدخول'));
    await tester.pumpAndSettle();

    expect(find.textContaining('كلمة المرور غير صحيحة'), findsOneWidget);
    expect(find.textContaining('بقيت'), findsOneWidget);
  });
}
