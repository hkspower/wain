import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:wain/ai/call_controller.dart';
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
  String? voice;
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
    String? voiceId,
    required Map<String, ToolHandler> tools,
  }) async {
    startedAgent = agentId;
    voice = voiceId;
    this.tools = tools;
    if (startError != null) throw startError!;
    await hold?.future;
  }

  @override
  Future<void> end() async => ended = true;

  @override
  void dispose() => disposed = true;
}

CallController testController({
  required List<FakeSession> sessions,
  void Function(String)? navigate,
  MicCheck? mic,
  Duration dial = const Duration(seconds: 20),
  void Function(FakeSession)? configure,
}) {
  return CallController(
    sessionFactory: () {
      final s = FakeSession();
      configure?.call(s);
      sessions.add(s);
      return s;
    },
    places: kPlaces,
    indexOf: () => searchIndex,
    navigate: navigate ?? (_) {},
    checkMic: mic,
    dialTimeout: dial,
    agentId: 'agent_test',
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
