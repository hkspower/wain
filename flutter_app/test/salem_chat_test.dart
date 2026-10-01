// The typed-chat client against a real WebSocket server on localhost that
// speaks the ElevenLabs conversation protocol. No network beyond loopback.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:wain/ai/config.dart';
import 'package:wain/ai/salem_chat.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

class FakeAgent {
  late HttpServer server;
  final received = <Map<String, dynamic>>[];
  WebSocket? socket;
  String? path;
  String? protocol;
  final connected = Completer<void>();

  Future<void> start() async {
    server = await HttpServer.bind('127.0.0.1', 0);
    server.listen((req) async {
      path = req.uri.toString();
      protocol = req.headers.value('sec-websocket-protocol');
      final ws = await WebSocketTransformer.upgrade(
        req,
        protocolSelector: (p) => p.first,
      );
      socket = ws;
      if (!connected.isCompleted) connected.complete();
      ws.listen((data) {
        received.add(jsonDecode(data as String) as Map<String, dynamic>);
      });
    });
  }

  void say(Map<String, dynamic> m) => socket!.add(jsonEncode(m));
  Future<void> stop() async => server.close(force: true);
  ChannelFactory get factory =>
      (uri, protocols) => WebSocketChannel.connect(
        Uri.parse('ws://127.0.0.1:${server.port}${uri.path}?${uri.query}'),
        protocols: protocols,
      );
}

Future<void> until(bool Function() ok, [int ms = 2000]) async {
  final end = DateTime.now().add(Duration(milliseconds: ms));
  while (!ok()) {
    if (DateTime.now().isAfter(end)) fail('timed out waiting');
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}

void main() {
  late FakeAgent agent;
  setUp(() async {
    agent = FakeAgent();
    await agent.start();
  });
  tearDown(() => agent.stop());

  test(
    'handshake: convai subprotocol, text_only, and the voice override for سالم',
    () async {
      final statuses = <ChatStatus>[];
      final h = startSalemChat(
        agentId: 'agent_x',
        connect: agent.factory,
        onStatus: statuses.add,
        onMessage: (_) {},
        onToolUnavailable: () {},
      );
      await agent.connected.future;
      await until(() => agent.received.isNotEmpty);
      final init = agent.received.first;
      expect(agent.protocol, 'convai');
      expect(agent.path, contains('agent_id=agent_x'));
      // A source outside the server's enum (`conversation_initiation_source`)
      // — «wain-salem-chat» until 1 October — and no typed conversation was
      // ever recorded. The Flutter SDK sends «flutter_sdk».
      expect(agent.path, contains('source=flutter_sdk'));
      expect(init['source_info'], {'source': 'flutter_sdk', 'version': '1'});
      expect(init['type'], 'conversation_initiation_client_data');
      expect(init['conversation_config_override'], {
        'conversation': {'text_only': true},
        'tts': {'voice_id': kSalemVoiceId},
      }, reason: 'the latest decision: the typed chat carries سالم voice');
      expect(statuses, [
        ChatStatus.connecting,
      ], reason: 'not "connected" until the agent says so');

      agent.say({'type': 'conversation_initiation_metadata'});
      await until(() => statuses.contains(ChatStatus.connected));
      h.close();
    },
  );

  test('agent responses arrive; user messages go out; ping is answered with its event id', () async {
    final messages = <ChatMessage>[];
    final statuses = <ChatStatus>[];
    final h = startSalemChat(
      agentId: 'a',
      connect: agent.factory,
      onStatus: statuses.add,
      onMessage: messages.add,
      onToolUnavailable: () {},
    );
    await agent.connected.future;
    agent.say({'type': 'conversation_initiation_metadata'});
    agent.say({
      'type': 'agent_response',
      'agent_response_event': {'agent_response': 'هلا!'},
    });
    await until(() => messages.isNotEmpty);
    expect(messages.single.role, 'agent');
    expect(messages.single.text, 'هلا!');

    h.send('قهوة');
    await until(() => agent.received.any((m) => m['type'] == 'user_message'));
    expect(
      agent.received.firstWhere((m) => m['type'] == 'user_message')['text'],
      'قهوة',
    );

    agent.say({
      'type': 'ping',
      'ping_event': {'event_id': 7},
    });
    await until(() => agent.received.any((m) => m['type'] == 'pong'));
    expect(
      agent.received.firstWhere((m) => m['type'] == 'pong')['event_id'],
      7,
    );
    h.close();
  });

  test('a registered tool is run and its result returned; a failing one answers is_error', () async {
    final h = startSalemChat(
      agentId: 'a',
      connect: agent.factory,
      onStatus: (_) {},
      onMessage: (_) {},
      onToolUnavailable: () {},
      clientTools: {
        'show_places': (p) => 'found ${p['query']}',
        'boom': (p) => throw StateError('nope'),
      },
    );
    await agent.connected.future;
    agent.say({
      'type': 'client_tool_call',
      'client_tool_call': {
        'tool_call_id': 'c1',
        'tool_name': 'show_places',
        'parameters': {'query': 'بحر'},
      },
    });
    agent.say({
      'type': 'client_tool_call',
      'client_tool_call': {
        'tool_call_id': 'c2',
        'tool_name': 'boom',
        'parameters': {},
      },
    });
    await until(
      () =>
          agent.received
              .where((m) => m['type'] == 'client_tool_result')
              .length ==
          2,
    );
    final results = {
      for (final m in agent.received.where(
        (m) => m['type'] == 'client_tool_result',
      ))
        m['tool_call_id']: m,
    };
    expect(results['c1']!['result'], 'found بحر');
    expect(results['c1']!['is_error'], false);
    expect(results['c2']!['is_error'], true);
    expect(results['c2']!['result'], contains('nope'));
    h.close();
  });

  test(
    'an unregistered tool is answered with an error rather than left to hang',
    () async {
      var unavailable = 0;
      final h = startSalemChat(
        agentId: 'a',
        connect: agent.factory,
        onStatus: (_) {},
        onMessage: (_) {},
        onToolUnavailable: () => unavailable++,
      );
      await agent.connected.future;
      agent.say({
        'type': 'client_tool_call',
        'client_tool_call': {
          'tool_call_id': 'z',
          'tool_name': 'mystery',
          'parameters': {},
        },
      });
      await until(
        () => agent.received.any((m) => m['type'] == 'client_tool_result'),
      );
      final r = agent.received.firstWhere(
        (m) => m['type'] == 'client_tool_result',
      );
      expect(r['tool_call_id'], 'z');
      expect(r['is_error'], true);
      expect(r['result'], 'not available in text chat');
      expect(unavailable, 1);
      h.close();
    },
  );

  test(
    'a normal close (1000) is "disconnected"; anything else is an error',
    () async {
      final statuses = <ChatStatus>[];
      startSalemChat(
        agentId: 'a',
        connect: agent.factory,
        onStatus: statuses.add,
        onMessage: (_) {},
        onToolUnavailable: () {},
      );
      await agent.connected.future;
      await agent.socket!.close(1000);
      await until(() => statuses.contains(ChatStatus.disconnected));

      final a2 = FakeAgent();
      await a2.start();
      final s2 = <ChatStatus>[];
      startSalemChat(
        agentId: 'a',
        connect: a2.factory,
        onStatus: s2.add,
        onMessage: (_) {},
        onToolUnavailable: () {},
      );
      await a2.connected.future;
      await a2.socket!.close(1011, 'server error');
      await until(() => s2.contains(ChatStatus.error));
      await a2.stop();
    },
  );

  test('never hears back: error after the connect timeout, and the socket is closed', () async {
    final statuses = <ChatStatus>[];
    final h = startSalemChat(
      agentId: 'a',
      connect: agent.factory,
      onStatus: statuses.add,
      onMessage: (_) {},
      onToolUnavailable: () {},
      connectTimeout: const Duration(milliseconds: 80),
    );
    await agent.connected.future;
    await until(() => statuses.contains(ChatStatus.error));
    h.close();
  });

  test('agent switched off ("none"): error at once, nothing opened', () {
    final statuses = <ChatStatus>[];
    final h = startSalemChat(
      agentId: '',
      connect: (_, _) => throw StateError('must not connect'),
      onStatus: statuses.add,
      onMessage: (_) {},
      onToolUnavailable: () {},
    );
    expect(statuses, [ChatStatus.error]);
    h.send('x');
    h.close();
  });

  test('a refused connection is an error, not a hang', () async {
    final statuses = <ChatStatus>[];
    final dead = await HttpServer.bind('127.0.0.1', 0);
    final port = dead.port;
    await dead.close(force: true);
    startSalemChat(
      agentId: 'a',
      connect: (uri, p) => WebSocketChannel.connect(
        Uri.parse('ws://127.0.0.1:$port/x'),
        protocols: p,
      ),
      onStatus: statuses.add,
      onMessage: (_) {},
      onToolUnavailable: () {},
    );
    await until(() => statuses.contains(ChatStatus.error));
  });
}
