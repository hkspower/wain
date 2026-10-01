/// What keeps a call alive when the visitor stops looking at it: the phone
/// locks, another app comes forward, the screen times out.
///
/// - The screen stays awake while a call is up (`wakelock_plus`). A hands-free
///   call that auto-locks after thirty seconds is a call that leaves the app.
/// - iOS keeps the audio running in the background because `Info.plist`
///   declares `UIBackgroundModes` → `audio` (LiveKit's own requirement); there
///   is nothing to start from here.
/// - Android cuts the microphone of an app that is not in front unless a
///   foreground service of type `microphone` is running, with a notification
///   saying so. That service is `CallService.kt`, started over the
///   `wain/call_keepalive` channel. A small native service rather than a
///   plugin: the obvious plugin registers an iOS background-fetch task at every
///   launch, which this app has no use for and would have to declare.
///
/// Behind an interface so the controller's tests can see exactly when it is
/// started and stopped without a phone.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

abstract class CallKeepAlive {
  Future<void> start();
  Future<void> stop();
}

class PlatformKeepAlive implements CallKeepAlive {
  static const _channel = MethodChannel('wain/call_keepalive');

  /// The notification's «إنهاء» button. Set once the controller exists.
  VoidCallback? onHangUp;

  PlatformKeepAlive() {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'hangUp') onHangUp?.call();
    });
  }

  bool get _android =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  @override
  Future<void> start() async {
    try {
      await WakelockPlus.enable();
    } catch (_) {
      /* no plugin (tests, web): the call still works, the screen may lock */
    }
    if (!_android) return;
    // Android 13+: without this the service still runs, but its notification
    // — the visitor's only way back to the call from outside — is hidden.
    // Asked, never required: a refusal must not stop the call.
    try {
      await Permission.notification.request();
    } catch (_) {}
    // Android 12+: a Bluetooth headset is routed only with this granted, and
    // LiveKit does not ask. Asked here, never required.
    try {
      await Permission.bluetoothConnect.request();
    } catch (_) {}
    try {
      await _channel.invokeMethod('start', {
        'title': 'مكالمة مع شوق',
        'text': 'اضغط عشان ترجع للمكالمة',
        'hangUp': 'إنهاء',
      });
    } catch (_) {
      /* the call goes on in front; only the background is lost */
    }
  }

  @override
  Future<void> stop() async {
    try {
      await WakelockPlus.disable();
    } catch (_) {}
    if (!_android) return;
    try {
      await _channel.invokeMethod('stop');
    } catch (_) {}
  }

  /// For the device suite only: whether the Android service is running.
  static Future<bool> isRunning() async {
    try {
      return await _channel.invokeMethod<bool>('isRunning') ?? false;
    } catch (_) {
      return false;
    }
  }
}
