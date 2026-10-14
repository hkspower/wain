import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:wain/ai/call_controller.dart';
import 'package:wain/ai/keep_alive.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/data/places.g.dart';
import 'package:wain/main.dart';

/// Fake agent session: drives the controller's events by hand.
class FakeSession implements AgentSession {
  void Function()? onConnected;
  void Function(bool)? onSpeaking;
  void Function()? onDisconnected;
  void Function(String)? onError;
  Map<String, ToolHandler> tools = {};
  String? startedAgent;

  /// Whether the controller asked the factory for the free call.
  bool? local;
  bool ended = false;
  bool disposed = false;
  Object? startError;
  Completer<void>? hold;

  @override
  void listen({
    required void Function() onConnected,
    required void Function(bool speaking) onSpeaking,
    required void Function() onDisconnected,
    required void Function(String message) onError,
  }) {
    this.onConnected = onConnected;
    this.onSpeaking = onSpeaking;
    this.onDisconnected = onDisconnected;
    this.onError = onError;
  }

  @override
  Future<void> start({
    required String agentId,
    required Map<String, ToolHandler> tools,
  }) async {
    startedAgent = agentId;
    this.tools = tools;
    if (startError != null) throw startError!;
    await hold?.future;
  }

  @override
  Future<void> end() async => ended = true;

  @override
  void dispose() => disposed = true;
}

/// A controller whose sessions are [FakeSession]s. Her agent is `agent_test`;
/// his is [salemAgentId], and null is the build's own — empty here, so his
/// calls are the free call unless a test names him an agent.
CallController testController({
  required List<FakeSession> sessions,
  void Function(String)? navigate,
  MicCheck? mic,
  Duration dial = const Duration(seconds: 20),
  void Function(FakeSession)? configure,
  CallKeepAlive? keepAlive,
  String? salemAgentId,
}) {
  return CallController(
    keepAlive: keepAlive,
    sessionFactory: ({required bool local}) {
      final s = FakeSession()..local = local;
      configure?.call(s);
      sessions.add(s);
      return s;
    },
    places: kPlaces,
    indexOf: () => searchIndex,
    navigate: navigate ?? (_) {},
    checkMic: mic,
    dialTimeout: dial,
    shouqAgentId: 'agent_test',
    salemAgentId: salemAgentId,
  );
}

/// Pump the whole app at a route, phone-sized.
Future<void> pumpApp(WidgetTester tester, String location) async {
  tester.view.physicalSize = const Size(390 * 2, 844 * 2);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    WainApp(state: AppState.ephemeral(), initialLocation: location),
  );
  await tester.pump(const Duration(milliseconds: 300));
}

T read<T>(WidgetTester tester, Finder f) =>
    Provider.of<T>(tester.element(f.first), listen: false);

/// Records when the call asked to be kept alive, and when it let go — and, for
/// each start, whose call the notification would name and whether the Android
/// service was asked for at all (the free call asks only for the screen).
class FakeKeepAlive implements CallKeepAlive {
  final List<String> log = [];
  final List<({String title, bool background})> starts = [];
  bool get running => log.isNotEmpty && log.last == 'start';

  @override
  Future<void> start({required String title, bool background = true}) async {
    log.add('start');
    starts.add((title: title, background: background));
  }

  @override
  Future<void> stop() async => log.add('stop');
}
