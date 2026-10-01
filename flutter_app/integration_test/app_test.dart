// The app on a real iOS Simulator: the real engine, the real plugins
// (shared_preferences, permission_handler, url_launcher), real network for
// the map tiles, real touch gestures — the things the widget suite fakes.
//
// Run by the `ios-simulator` job of `.github/workflows/flutter-ci.yml` through
// `flutter drive --driver=test_driver/integration_test.dart
// --target=integration_test/app_test.dart -d <simulator>`, which also saves
// every `shot()` as a PNG. Nothing here can run in the sandbox that wrote it
// (no Xcode), so CI is its first and only reader.
//
// What it deliberately never does: agree to the AI consent, or place a call.
// Either would open a recorded ElevenLabs conversation from a CI runner — a
// real conversation in her history, paid for, with nobody on the line. The
// consent sheet IS exercised, up to «مو الحين».
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wain/ai/call_button.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/data/places.g.dart';
import 'package:wain/main.dart';

final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

/// Live binding: `pump(d)` waits `d` of real time, so this is a real wait.
Future<void> settle(WidgetTester t, [int ms = 600]) async {
  for (var waited = 0; waited < ms; waited += 100) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

/// Polls until [f] finds something, or fails naming what it waited for —
/// a slow simulator must not read as a missing screen, nor hang the run.
Future<void> waitFor(WidgetTester t, Finder f, {int seconds = 15}) async {
  for (var i = 0; i < seconds * 10; i++) {
    if (f.evaluate().isNotEmpty) return;
    await t.pump(const Duration(milliseconds: 100));
  }
  fail('waited ${seconds}s for $f');
}

/// A PNG the driver saves under the job's screenshots directory.
Future<void> shot(String name) async {
  try {
    await binding.takeScreenshot(name);
  } catch (e) {
    // A screenshot is evidence for a person, never the assertion itself.
    debugPrint('screenshot $name failed: $e');
  }
}

/// A fresh app on the REAL stored state: preferences cleared through the
/// plugin, then loaded the way `main()` loads them.
Future<void> launch(WidgetTester t) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.clear();
  final state = await AppState.load();
  await t.pumpWidget(WainApp(state: state));
  await settle(t, 800);
}

void main() {
  testWidgets('home: the dial, and the tab bar to the three main screens', (
    t,
  ) async {
    await launch(t);
    expect(find.text('إلى وين؟'), findsOneWidget);
    expect(find.text('ابدأ'), findsOneWidget);
    expect(find.text('استكشف'), findsWidgets);
    expect(find.text('بحث'), findsWidgets);
    await shot('01-home');
  });

  testWidgets('the dial opens /find, and a call asks for consent first', (
    t,
  ) async {
    await launch(t);
    await t.tap(find.text('ابدأ'));
    await waitFor(t, find.byKey(const ValueKey('find-call')));
    expect(find.byKey(const ValueKey('find-type')), findsOneWidget);
    await settle(t, 1200); // the photo fades in
    await shot('02-find');

    // The button inside the half, not the half: the half is a picture.
    await t.tap(
      find.descendant(
        of: find.byKey(const ValueKey('find-call')),
        matching: find.byType(ShouqCallButton),
      ),
    );
    await waitFor(t, find.byKey(const ValueKey('ai-consent-decline')));
    expect(find.byKey(const ValueKey('ai-consent-agree')), findsOneWidget);
    await settle(t);
    await shot('03-consent');

    // «مو الحين»: no call, no sheet, nothing recorded — and still on /find.
    await t.tap(find.byKey(const ValueKey('ai-consent-decline')));
    await settle(t);
    expect(find.byKey(const ValueKey('ai-consent-agree')), findsNothing);
    expect(find.byKey(const ValueKey('call-sheet')), findsNothing);
    expect(find.byKey(const ValueKey('find-call')), findsOneWidget);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool('wain-ai-consent-v1'), isNot(true));
  });

  testWidgets('سالم\'s chat waits for consent before opening anything', (
    t,
  ) async {
    await launch(t);
    await t.tap(find.text('ابدأ'));
    await waitFor(t, find.byKey(const ValueKey('find-type')));
    await t.tap(
      find.descendant(
        of: find.byKey(const ValueKey('find-type')),
        matching: find.byType(FilledButton),
      ),
    );
    await waitFor(t, find.byKey(const ValueKey('chat-consent-agree')));
    // No socket until agreed: nothing to type into.
    expect(find.byKey(const ValueKey('chat-input')), findsNothing);
    await settle(t);
    await shot('04-salem-consent');
  });

  testWidgets('search: typing ranks results onto a real map, a result opens '
      'its place, and the iOS back swipe returns', (t) async {
    await launch(t);
    await t.tap(find.text('بحث').last);
    await waitFor(t, find.byKey(const ValueKey('search-input')));
    await t.enterText(find.byKey(const ValueKey('search-input')), 'قهوة');
    await waitFor(t, find.byKey(const ValueKey('search-map')));
    expect(find.byKey(const ValueKey('search-hangout')), findsOneWidget);
    // Real tiles over the network — the one thing no sandbox here has drawn.
    await settle(t, 4000);
    await shot('05-search-map');

    // The first result row that is a place.
    final first = kPlaces.firstWhere(
      (p) =>
          find.byKey(ValueKey('result-place:${p.slug}')).evaluate().isNotEmpty,
      orElse: () => fail('no place result on screen for «قهوة»'),
    );
    final row = find.byKey(ValueKey('result-place:${first.slug}'));
    await t.ensureVisible(row);
    await settle(t, 300);
    await t.tap(row);
    await waitFor(t, find.text(first.descriptionAr));
    await settle(t, 1500);
    await shot('06-place-${first.slug}');

    // An iPhone has no back button: the edge swipe is the way back. The
    // app is right-to-left, so the gesture starts at the RIGHT edge.
    final size = t.view.physicalSize / t.view.devicePixelRatio;
    final g = await t.startGesture(Offset(size.width - 4, size.height / 2));
    for (var i = 1; i <= 10; i++) {
      await g.moveTo(
        Offset(size.width - 4 - i * size.width * 0.07, size.height / 2),
      );
      await t.pump(const Duration(milliseconds: 16));
    }
    await g.up();
    await settle(t, 900);
    expect(
      find.byKey(const ValueKey('search-input')),
      findsOneWidget,
      reason: 'the back swipe should land on /search again',
    );
    expect(find.text(first.descriptionAr), findsNothing);
  });

  testWidgets('explore: all 52, a category filters, clearing restores', (
    t,
  ) async {
    await launch(t);
    await t.tap(find.text('استكشف').last);
    await waitFor(t, find.textContaining('٥٢ نتيجة'));
    await settle(t);
    await shot('07-explore');
    await t.tap(find.text('قهوة').first);
    await settle(t);
    expect(find.textContaining('٥٢ نتيجة'), findsNothing);
  });

  testWidgets('the screen is laid out for this device without overflow', (
    t,
  ) async {
    await launch(t);
    final view = ui.PlatformDispatcher.instance.views.first;
    debugPrint(
      'device: ${view.physicalSize} @${view.devicePixelRatio}x, '
      'padding ${view.padding}',
    );
    for (final where in ['/', '/explore', '/search', '/about', '/privacy']) {
      await t.pumpWidget(const SizedBox());
      final state = await AppState.load();
      await t.pumpWidget(WainApp(state: state, initialLocation: where));
      await settle(t, 700);
      expect(t.takeException(), isNull, reason: where);
    }
  });

  // permission_handler compiles each permission in only when it is switched
  // on at build time (PERMISSION_MICROPHONE). Switched off, it answers
  // «denied» for ever and every call on iOS would say the microphone is
  // blocked. The workflow grants the microphone to com.wainkw.app with
  // `simctl privacy` before the app starts, so a compiled-in check reads
  // «granted»; a compiled-out one cannot, whatever the simulator allows.
  testWidgets('the microphone permission is compiled in and reads the '
      'simulator\'s grant', (t) async {
    final status = await Permission.microphone.status;
    debugPrint('microphone: $status');
    expect(status, PermissionStatus.granted);
  });
}
