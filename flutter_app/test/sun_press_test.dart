// The home hero's sun as one round button (3 October, on request): under the
// finger it sinks — the label presses in, the face darkens — with a haptic
// tap, and it springs back on release. Mirrors the web's HeroSun.tsx.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'app_smoke_test.dart' show pumpAt;

void main() {
  testWidgets('pressing the sun taps the phone and sinks it', (t) async {
    final haptics = <Object?>[];
    t.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'HapticFeedback.vibrate')
          haptics.add(call.arguments);
        return null;
      },
    );
    addTearDown(
      () => t.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );

    await pumpAt(t, '/');
    final sun = find.byKey(const ValueKey('home-sun'));
    expect(sun, findsOneWidget);
    double scale() => t
        .widget<AnimatedScale>(find.byKey(const ValueKey('home-sun-label')))
        .scale;
    BoxDecoration face() =>
        t
                .widget<AnimatedContainer>(
                  find.byKey(const ValueKey('home-sun-face')),
                )
                .decoration!
            as BoxDecoration;

    expect(scale(), 1, reason: 'at rest the label is not pressed');
    final restShadow = face().boxShadow!.length;
    expect(restShadow, greaterThan(0), reason: 'at rest the disc is lifted');

    final g = await t.startGesture(t.getCenter(sun));
    // Past kPressTimeout (100ms): inside a scroll view a tap-down is only
    // reported once the press has outlasted a possible drag.
    await t.pump(const Duration(milliseconds: 150));
    expect(
      haptics,
      contains('HapticFeedbackType.mediumImpact'),
      reason: 'the press is felt, not only seen',
    );
    expect(scale(), 0.95, reason: 'the label presses in');
    expect(face().boxShadow, isEmpty, reason: 'the lift goes: the disc sinks');

    await g.cancel();
    await t.pump(const Duration(milliseconds: 400));
    expect(scale(), 1, reason: 'and it springs back on release');
    expect(face().boxShadow!.length, restShadow);
  });

  testWidgets('a tap on the sun still leads to /find', (t) async {
    await pumpAt(t, '/');
    await t.tap(find.byKey(const ValueKey('home-sun')));
    await t.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.text('كلّم شوق'), findsWidgets);
  });
}
