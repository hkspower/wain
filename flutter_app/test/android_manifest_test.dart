// What Android needs for a call to go on behind another app or a locked
// screen. No Android SDK exists here, so the build is CI's to prove; what can
// be held here is that the manifest and the service agree.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final manifest = File('android/app/src/main/AndroidManifest.xml')
      .readAsStringSync();
  bool permits(String p) => manifest.contains(
    '<uses-permission android:name="android.permission.$p"',
  );

  test('the call service is declared with the microphone type', () {
    final service = RegExp(
      r'<service\s+[^>]*android:name="\.CallService"[^>]*/>',
      dotAll: true,
    ).firstMatch(manifest)?.group(0);
    expect(service, isNotNull);
    expect(service, contains('android:foregroundServiceType="microphone"'));
    expect(service, contains('android:exported="false"'));
  });

  test('with the permissions Android 14 checks before starting it', () {
    for (final p in [
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_MICROPHONE',
      'RECORD_AUDIO',
      'POST_NOTIFICATIONS',
      'WAKE_LOCK',
    ]) {
      expect(permits(p), isTrue, reason: p);
    }
  });

  test('and the service starts itself with that same type', () {
    final kt = File(
      'android/app/src/main/kotlin/com/wainkw/wain/CallService.kt',
    ).readAsStringSync();
    expect(kt, contains('FOREGROUND_SERVICE_TYPE_MICROPHONE'));
    expect(kt, contains('START_NOT_STICKY'));
  });

  test('a shared /places/ link is claimed for verification, on both hosts', () {
    final filter = RegExp(
      r'<intent-filter android:autoVerify="true">(.*?)</intent-filter>',
      dotAll: true,
    ).firstMatch(manifest)?.group(1);
    expect(filter, isNotNull);
    for (final host in ['www.wainkw.com', 'wainkw.com']) {
      expect(
        filter,
        contains('android:host="$host" android:pathPrefix="/places/"'),
        reason: host,
      );
    }
  });

  test('only app_links routes a link (no second delivery from Flutter)', () {
    expect(
      manifest,
      contains(
        '<meta-data android:name="flutter_deeplinking_enabled" android:value="false" />',
      ),
    );
  });

  test('store-ready application flags', () {
    final app = RegExp(
      r'<application(.*?)>',
      dotAll: true,
    ).firstMatch(manifest)!.group(1)!;
    expect(app, contains('android:supportsRtl="true"'));
    expect(app, contains('android:allowBackup="false"'));
    expect(app, contains('android:enableOnBackInvokedCallback="true"'));
  });

  test('release builds keep WebRTC and LiveKit from R8', () {
    final gradle = File('android/app/build.gradle.kts').readAsStringSync();
    expect(gradle, contains('"proguard-rules.pro"'));
    final rules = File('android/app/proguard-rules.pro').readAsStringSync();
    expect(rules, contains('-keep class org.webrtc.** { *; }'));
    expect(rules, contains('-keep class io.livekit.** { *; }'));
  });

  test('every release build carries the run number as its versionCode', () {
    final wf = File('../.github/workflows/android-flutter.yml')
        .readAsStringSync();
    final releases = RegExp(r'flutter build (apk|appbundle) --release[^\n]*')
        .allMatches(wf)
        .length;
    expect(releases, greaterThanOrEqualTo(3));
    expect(
      RegExp(r'--build-number=\$\{\{ github\.run_number \}\}')
          .allMatches(wf)
          .length,
      releases,
    );
  });

  test('the free call can find the phone\'s speech recogniser', () {
    // Android 11+ hides other apps' services unless the manifest names them;
    // without this the free call (local_session.dart) finds no recogniser on
    // a phone that has one, and every call fails as «unavailable».
    expect(manifest, contains('android.speech.RecognitionService'));
    expect(permits('RECORD_AUDIO'), isTrue);
  });

  test('still no location and no camera', () {
    expect(permits('ACCESS_FINE_LOCATION'), isFalse);
    expect(permits('ACCESS_COARSE_LOCATION'), isFalse);
    expect(permits('CAMERA'), isFalse);
  });
}
