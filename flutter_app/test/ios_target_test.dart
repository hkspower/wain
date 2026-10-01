// iOS 16 and up, asked for on 1 October. No Xcode exists here, so the build
// itself is CI's to prove; what can be held here is that the project says 16
// in every place Xcode reads it, so the build cannot quietly target another.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  _uploadReadiness();
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

// What App Store Connect checks at upload, before any reviewer looks. Each one
// is a build that uploads and then turns «Invalid Binary» by email.
void _uploadReadiness() {
  final plist = File('ios/Runner/Info.plist').readAsStringSync();
  String? value(String key) =>
      RegExp('<key>$key</key>\\s*<string>([^<]*)</string>')
          .firstMatch(plist)
          ?.group(1);

  test('the microphone has a purpose string (شوق\'s call)', () {
    expect(value('NSMicrophoneUsageDescription'), isNotEmpty);
  });

  // flutter_webrtc, under livekit under elevenlabs_agents, calls
  // AVCaptureDevice for video in its own sources; a binary that references
  // the camera without NSCameraUsageDescription is refused (ITMS-90683),
  // whether or not the app ever opens it. The string says it never does.
  test('the camera has one too, and it says the app never opens it', () {
    expect(value('NSCameraUsageDescription'), contains('ما يفتح الكاميرا'));
  });

  test('export compliance is answered, so builds do not wait on it', () {
    expect(
      RegExp(r'<key>ITSAppUsesNonExemptEncryption</key>\s*<false/>')
          .hasMatch(plist),
      isTrue,
    );
  });

  test('the store icon has no alpha channel (refused at upload)', () {
    final png = File(
      'ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png',
    ).readAsBytesSync();
    // IHDR colour type at byte 25: 2 = RGB, 6 = RGBA.
    expect(png[25], 2);
  });

  test('the bundle id is the one the App Store record is made for', () {
    final pbx = File('ios/Runner.xcodeproj/project.pbxproj').readAsStringSync();
    final ids = RegExp(r'PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);')
        .allMatches(pbx)
        .map((m) => m.group(1))
        .where((id) => !id!.endsWith('.RunnerTests'))
        .toSet();
    expect(ids, {'com.wainkw.app'});
  });
}
