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
/// Only an AGENT call needs the service (14 October). The free call is the
/// phone's own recogniser for twenty seconds at most, in front; it used to
/// start the service too, and with it two permission dialogs (notifications,
/// Bluetooth) over a call that is over before they are answered. It keeps the
/// screen awake and nothing else.
///
/// Behind an interface so the controller's tests can see exactly when it is
/// started and stopped without a phone.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

abstract class CallKeepAlive {
  /// [title] is the notification's: it names who the call is with.
  /// [background] asks for the Android service and its permissions too — an
  /// agent call. The free call passes false.
  Future<void> start({required String title, bool background = true});
  Future<void> stop();
}

/// The steps a start takes, injectable so the ordering below can be tested
/// without a phone. Each default is the real plugin or channel call.
typedef KeepAliveStep = Future<void> Function();
typedef KeepAliveService = Future<void> Function(Map<String, String> args);

class PlatformKeepAlive implements CallKeepAlive {
  static const _channel = MethodChannel('wain/call_keepalive');

  /// The notification's «إنهاء» button. Set once the controller exists.
  VoidCallback? onHangUp;

  PlatformKeepAlive({
    KeepAliveStep? wake,
    KeepAliveStep? sleep,
    KeepAliveStep? askPermissions,
    KeepAliveService? startService,
    KeepAliveStep? stopService,
    bool? android,
  }) : _wake = wake ?? _defaultWake,
       _sleep = sleep ?? _defaultSleep,
       _askPermissions = askPermissions ?? _defaultPermissions,
       _startService = startService ?? _defaultStart,
       _stopService = stopService ?? _defaultStop,
       _android =
           android ??
           (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'hangUp') onHangUp?.call();
    });
  }

  final KeepAliveStep _wake;
  final KeepAliveStep _sleep;
  final KeepAliveStep _askPermissions;
  final KeepAliveService _startService;
  final KeepAliveStep _stopService;
  final bool _android;

  /// Bumped by every stop, read by a start after each of its awaits: a start
  /// still asking for permissions when the call is hung up must not go on to
  /// start the service. It did — `start()` was never awaited, `stop()` ran
  /// first, and the notification came up over a call that was already over,
  /// an orphan the caller could only end from the shade (14 October).
  int _gen = 0;

  static Future<void> _defaultWake() => WakelockPlus.enable();
  static Future<void> _defaultSleep() => WakelockPlus.disable();
  static Future<void> _defaultPermissions() async {
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
  }

  static Future<void> _defaultStart(Map<String, String> args) =>
      _channel.invokeMethod('start', args);
  static Future<void> _defaultStop() => _channel.invokeMethod('stop');

  @override
  Future<void> start({required String title, bool background = true}) async {
    final gen = ++_gen;
    try {
      await _wake();
    } catch (_) {
      /* no plugin (tests, web): the call still works, the screen may lock */
    }
    if (!background || !_android) return;
    try {
      await _askPermissions();
    } catch (_) {}
    // Hung up while the dialogs were up: nothing more to start.
    if (gen != _gen) return;
    try {
      await _startService({
        'title': title,
        'text': 'اضغط عشان ترجع للمكالمة',
        'hangUp': 'إنهاء',
      });
    } catch (_) {
      /* the call goes on in front; only the background is lost */
      return;
    }
    // Hung up while the service was starting: it has to go again, because
    // the stop that ran meanwhile found nothing to stop.
    if (gen != _gen) {
      try {
        await _stopService();
      } catch (_) {}
    }
  }

  @override
  Future<void> stop() async {
    _gen++;
    try {
      await _sleep();
    } catch (_) {}
    if (!_android) return;
    try {
      await _stopService();
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
