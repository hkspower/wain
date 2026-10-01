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

  test('still no location and no camera', () {
    expect(permits('ACCESS_FINE_LOCATION'), isFalse);
    expect(permits('ACCESS_COARSE_LOCATION'), isFalse);
    expect(permits('CAMERA'), isFalse);
  });
}
