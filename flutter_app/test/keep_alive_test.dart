// What keeps a call alive (lib/ai/keep_alive.dart), driven step by step with
// the plugin and the Android channel replaced by functions that can be held
// open — so the two orderings a phone produces can be reproduced here: a
// hang-up while the permission dialogs are up, and one while the service is
// starting. Both left an «إنهاء» notification over a call that was already
// over until 14 October.
import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:wain/ai/keep_alive.dart';

void main() {
  // The real class registers a method-call handler at construction.
  TestWidgetsFlutterBinding.ensureInitialized();

  PlatformKeepAlive make({
    required List<String> log,
    Completer<void>? permissions,
    Completer<void>? service,
    bool android = true,
  }) => PlatformKeepAlive(
    android: android,
    wake: () async => log.add('wake'),
    sleep: () async => log.add('sleep'),
    askPermissions: () async {
      log.add('ask');
      await permissions?.future;
    },
    startService: (args) async {
      log.add('service:${args['title']}');
      await service?.future;
    },
    stopService: () async => log.add('stop-service'),
  );

  /// Lets a `start()` that was not awaited run until it blocks on a step.
  Future<void> settle() => Future<void>.delayed(Duration.zero);

  test('an agent call: the screen, the permissions, then the service, named '
      'for whoever the call is with', () async {
    final log = <String>[];
    final k = make(log: log);
    await k.start(title: 'مكالمة مع سالم');
    expect(log, ['wake', 'ask', 'service:مكالمة مع سالم']);
    await k.stop();
    expect(log.sublist(3), ['sleep', 'stop-service']);
  });

  test('the free call keeps the screen awake and asks for nothing', () async {
    // It used to start the service too: two permission dialogs over a call
    // that is over in twenty seconds, for a microphone that is open in front.
    final log = <String>[];
    final k = make(log: log);
    await k.start(title: 'مكالمة مع شوق', background: false);
    expect(log, ['wake']);
    expect(log, isNot(contains('ask')));
    expect(log.where((l) => l.startsWith('service:')), isEmpty);
    await k.stop();
    expect(log, contains('sleep'));
  });

  test('off Android, an agent call is the screen alone', () async {
    final log = <String>[];
    final k = make(log: log, android: false);
    await k.start(title: 'x');
    expect(log, ['wake']);
    await k.stop();
    expect(log, ['wake', 'sleep']);
  });

  test('hung up while the permission dialogs are up: no service is started', () async {
    final log = <String>[];
    final permissions = Completer<void>();
    final k = make(log: log, permissions: permissions);
    final started = k.start(title: 'x');
    await settle();
    expect(log, ['wake', 'ask'], reason: 'blocked on the dialogs');
    await k.stop();
    permissions.complete();
    await started;
    expect(
      log.where((l) => l.startsWith('service:')),
      isEmpty,
      reason: 'the notification would be an orphan: nothing is on the line',
    );
  });

  test('hung up while the service is starting: it is stopped again', () async {
    final log = <String>[];
    final service = Completer<void>();
    final k = make(log: log, service: service);
    final started = k.start(title: 'x');
    await settle();
    expect(log, contains('service:x'), reason: 'blocked inside the start');
    await k.stop();
    expect(
      log.where((l) => l == 'stop-service'),
      hasLength(1),
      reason: 'the stop found nothing running',
    );
    service.complete();
    await started;
    expect(
      log.where((l) => l == 'stop-service'),
      hasLength(2),
      reason: 'the start noticed the hang-up and stopped what it had started',
    );
  });

  test('a start that was not interrupted stops its service exactly once', () async {
    final log = <String>[];
    final k = make(log: log);
    await k.start(title: 'x');
    await k.stop();
    expect(log.where((l) => l == 'stop-service'), hasLength(1));
  });
}
