/// The app at window sizes a desktop user can actually produce.
///
/// النوخذة is a window, not a page: someone will drag it to half a laptop
/// screen, snap it to a quarter of a 4K monitor, or open it on a 1366×768
/// office machine. Flutter reports a layout overflow as a test failure, so
/// building the real screens at each of those sizes is a genuine check that
/// the app holds together — and it runs on both CI platforms, which is the
/// only place the Windows 11 and macOS builds are ever exercised.
///
/// The sizes are chosen, not swept:
///   * 560×480  — the floor both runners enforce (WM_GETMINMAXINFO on Windows,
///     contentMinSize on macOS). If the app breaks here the floor is wrong;
///   * 720×600  — kRailBreakpoint, where the bottom bar becomes a rail;
///   * 1366×768 — the commonest laptop screen still in offices;
///   * 1920×1080 and 3840×2160 — a desk monitor, and a window filling it.
///
/// Storage is in memory on purpose: `testWidgets` runs inside a fake-async
/// zone where a real dart:io write never completes, so a widget test that
/// touches the disk does not fail — it hangs. auth_test.dart covers the disk.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nokhatha/core/vault.dart';
import 'package:nokhatha/main.dart';
import 'package:nokhatha/store.dart';

class MemoryVault implements VaultStore {
  Map<String, dynamic> data = {};

  @override
  Future<Map<String, dynamic>> read() async => Map.of(data);

  @override
  Future<void> write(Map<String, dynamic> d) async => data = Map.of(d);

  @override
  Future<String> location() async => '(memory)';
}

const _sizes = <String, Size>{
  'the enforced floor (560×480)': Size(560, 480),
  'the rail breakpoint (720×600)': Size(720, 600),
  'an office laptop (1366×768)': Size(1366, 768),
  'a desk monitor (1920×1080)': Size(1920, 1080),
  'filling a 4K screen (3840×2160)': Size(3840, 2160),
};

void main() {
  late Store store;

  setUp(() async {
    store = Store(vault: MemoryVault());
    await store.load();
  });

  for (final entry in _sizes.entries) {
    testWidgets('the sign-in gate holds at ${entry.key}', (tester) async {
      tester.view.physicalSize = entry.value;
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(NokhathaApp(store: store));
      await tester.pumpAndSettle();

      // an overflow would already have failed the pump; this is the other
      // half — the gate is actually usable at this size, not merely present
      expect(find.byType(TextField), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    testWidgets('every unit lays out at ${entry.key}', (tester) async {
      tester.view.physicalSize = entry.value;
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await store.register(
          name: 'محمد', email: 'a@b.c', password: 'correct-horse-2026');
      await tester.pumpWidget(NokhathaApp(store: store));
      await tester.pumpAndSettle();

      // Walk all four units at this size, not only the one that opens first.
      // Tapping by icon works for both shells: NavigationRailDestination is a
      // description, not a widget in the tree, so find.byType would miss the
      // rail entirely and quietly test one screen five times.
      const icons = [
        Icons.anchor,
        Icons.show_chart,
        Icons.description_outlined,
        Icons.delivery_dining,
      ];
      for (final icon in icons) {
        final target = find.byIcon(icon);
        expect(target, findsWidgets, reason: 'no way to reach $icon');
        await tester.tap(target.first, warnIfMissed: false);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull,
            reason: '$icon overflowed at ${entry.value}');
      }
    });
  }
}
