// iOS 16 and up, asked for on 1 October. No Xcode exists here, so the build
// itself is CI's to prove; what can be held here is that the project says 16
// in every place Xcode reads it, so the build cannot quietly target another.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('every build configuration targets iOS 16', () {
    final pbx = File('ios/Runner.xcodeproj/project.pbxproj').readAsStringSync();
    final targets = RegExp(r'IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+);')
        .allMatches(pbx)
        .map((m) => m.group(1))
        .toList();
    expect(targets, isNotEmpty);
    expect(targets.toSet(), {'16.0'}, reason: '$targets');
  });

  test('and the framework plist agrees', () {
    final plist = File('ios/Flutter/AppFrameworkInfo.plist').readAsStringSync();
    expect(
      RegExp(r'<key>MinimumOSVersion</key>\s*<string>16\.0</string>')
          .hasMatch(plist),
      isTrue,
    );
  });
}
