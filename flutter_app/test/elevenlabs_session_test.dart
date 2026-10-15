// ai/elevenlabs_session.dart without a LiveKit room. The job a caller brings
// from the agent before (agent_job.dart) is told as a contextual update, and
// elevenlabs_agents 0.6.1 throws on one sent before its client calls itself
// connected — which can be after the server's metadata, the controller's
// «connected». So the text waits for the status. And an update that fails to
// go out is reported as two errors, which the controller used to read as the
// call failing: a background note hung up a call that was otherwise fine.
import 'dart:async';

import 'package:elevenlabs_agents/elevenlabs_agents.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/ai/agent_job.dart';
import 'package:wain/ai/call_controller.dart';
import 'package:wain/ai/elevenlabs_session.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/data/places.g.dart';

/// The SDK's client as far as the session sees it: a status, and a
/// `sendContextualUpdate` that throws unless connected, as 0.6.1's does.
class _Line implements AgentLine {
  _Line(this.callbacks, this.tools);
  final ConversationCallbacks callbacks;
  final Map<String, ClientTool> tools;

  @override
  ConversationStatus status = ConversationStatus.disconnected;
  final sent = <String>[];

  void setStatus(ConversationStatus s) {
    status = s;
    callbacks.onStatusChange?.call(status: s);
  }

  /// The server's conversation metadata: what the controller hears as
  /// «connected».
  void metadata() => callbacks.onConnect?.call(conversationId: 'conv_test');

  /// A send that failed on the data channel, reported the two ways 0.6.1
  /// reports it: the data stream's error and the update's own, in either
  /// order, a microtask apart.
  void failUpdate({required bool channelFirst}) {
    final e = Exception('publishData failed');
    void channel() => callbacks.onError?.call(
      'Data stream error',
      Exception('Failed to send message: $e'),
    );
    void update() =>
        callbacks.onError?.call('Failed to send contextual update', e);
    if (channelFirst) {
      channel();
      scheduleMicrotask(update);
    } else {
      update();
      scheduleMicrotask(channel);
    }
  }

  @override
  Future<void> startSession({required String agentId}) async =>
      setStatus(ConversationStatus.connecting);

  @override
  void sendContextualUpdate(String text) {
    if (status != ConversationStatus.connected) {
      throw StateError('Not connected to agent');
    }
    sent.add(text);
  }

  @override
  Future<void> endSession() async => setStatus(ConversationStatus.disconnected);

  @override
  void dispose() {}
}

/// Every timer due now has run.
Future<void> _turn() => Future<void>.delayed(Duration.zero);

void main() {
  late _Line line;
  late List<String> errors;

  Future<ElevenLabsSession> started({void Function()? onConnected}) async {
    final s = ElevenLabsSession(line: (c, t) => line = _Line(c, t));
    s.listen(
      onConnected: onConnected ?? () {},
      onSpeaking: (_) {},
      onDisconnected: () {},
      onError: errors.add,
    );
    await s.start(agentId: 'agent_test', tools: const {});
    return s;
  }

  setUp(() => errors = []);

  test('told before the client calls itself connected: held, and sent once '
      'when it does', () async {
    late ElevenLabsSession s;
    s = await started(onConnected: () => s.tell('سياق للتسليم'));
    line.metadata();
    expect(line.sent, isEmpty, reason: 'connecting: 0.6.1 would have thrown');
    line.setStatus(ConversationStatus.connected);
    expect(line.sent, ['سياق للتسليم']);
    line.callbacks.onStatusChange?.call(status: ConversationStatus.connected);
    expect(line.sent, hasLength(1), reason: 'told once');
    expect(errors, isEmpty);
    s.dispose();
  });

  test('told once connected: sent at once', () async {
    final s = await started();
    line.setStatus(ConversationStatus.connected);
    s.tell('سياق للتسليم');
    expect(line.sent, ['سياق للتسليم']);
    s.dispose();
  });

  test('a session put away before its line connected tells nobody', () async {
    final s = await started();
    s.tell('سياق للتسليم');
    s.dispose();
    line.setStatus(ConversationStatus.connected);
    expect(line.sent, isEmpty);
  });

  for (final channelFirst in [true, false]) {
    test('an update that did not go out is not an error of the call '
        '(${channelFirst ? 'the data channel' : 'the update'} reported '
        'first)', () async {
      final s = await started();
      line.setStatus(ConversationStatus.connected);
      s.tell('سياق للتسليم');
      line.failUpdate(channelFirst: channelFirst);
      await _turn();
      await _turn();
      expect(errors, isEmpty);
      s.dispose();
    });
  }

  test('any other error still reaches the controller — a data channel that '
      'failed some other send one turn late', () async {
    final s = await started();
    line.setStatus(ConversationStatus.connected);
    line.callbacks.onError?.call('Failed to start session', null);
    expect(errors, ['Failed to start session'], reason: 'at once');
    line.callbacks.onError?.call(
      'Data stream error',
      Exception('Failed to send message: gone'),
    );
    await _turn();
    expect(errors, ['Failed to start session', 'Data stream error']);
    s.dispose();
  });

  // Through the controller, which ends a live agent call on any error it
  // hears: the job's note failing to go out must leave the call live.
  test('a live call stays live when the job it was told fails to go '
      'out', () async {
    addTearDown(AgentJobs.instance.reset);
    writeJob(JobAgent.shouqAnswer, asked: 'قهوة', shown: ['kuwait-towers']);
    final c = CallController(
      sessionFactory: ({required bool local}) =>
          ElevenLabsSession(line: (cb, t) => line = _Line(cb, t)),
      places: kPlaces,
      indexOf: () => searchIndex,
      navigate: (_) {},
      shouqAgentId: 'agent_test',
    );
    await c.start();
    line.setStatus(ConversationStatus.connected);
    line.metadata();
    expect(c.phase, CallPhase.live);
    expect(line.sent, hasLength(1), reason: 'the job was told');
    line.failUpdate(channelFirst: true);
    await _turn();
    await _turn();
    expect(c.phase, CallPhase.live);
    await c.hangUp();
    c.dispose();
  });
}
