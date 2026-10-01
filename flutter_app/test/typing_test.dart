// The typed chat says she is writing (widgets/typing_dots.dart). The app had
// no indicator at all: for the seconds before her greeting and after every
// message, the transcript simply sat there.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:wain/ai/call_controller.dart';
import 'package:wain/ai/config.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/screens/salem_screen.dart';
import 'package:wain/widgets/typing_dots.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'support.dart';

/// A socket in memory: real socket IO does not run inside a widget test's
/// fake clock, and this one has to be driven by it (the 45s bound).
class _MemChannel implements WebSocketChannel {
  final incoming = StreamController<dynamic>();
  final sent = <Map<String, dynamic>>[];
  late final _Sink _sink = _Sink(sent);

  void say(Map<String, dynamic> m) => incoming.add(jsonEncode(m));

  @override
  Stream<dynamic> get stream => incoming.stream;
  @override
  WebSocketSink get sink => _sink;
  @override
  Future<void> get ready => Future.value();
  @override
  int? get closeCode => null;
  @override
  String? get closeReason => null;
  @override
  String? get protocol => 'convai';
  @override
  dynamic noSuchMethod(Invocation i) => super.noSuchMethod(i);
}

class _Sink implements WebSocketSink {
  final List<Map<String, dynamic>> sent;
  _Sink(this.sent);
  @override
  void add(dynamic data) =>
      sent.add(jsonDecode(data as String) as Map<String, dynamic>);
  @override
  Future<void> close([int? closeCode, String? closeReason]) async {}
  @override
  dynamic noSuchMethod(Invocation i) => super.noSuchMethod(i);
}

Widget _host(Widget child, {bool calm = false}) {
  final state = AppState.ephemeral()..setAiConsent(true);
  final call = testController(sessions: []);
  final router = GoRouter(
    routes: [GoRoute(path: '/', builder: (_, _) => child)],
  );
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AppState>.value(value: state),
      ChangeNotifierProvider<CallController>.value(value: call),
    ],
    child: MaterialApp.router(
      routerConfig: router,
      builder: (context, w) => MediaQuery(
        data: MediaQuery.of(context).copyWith(disableAnimations: calm),
        child: Directionality(textDirection: TextDirection.rtl, child: w!),
      ),
    ),
  );
}

List<double> _dotYs(WidgetTester t) => [
  for (var i = 0; i < 3; i++)
    t
        .widget<Transform>(find.byKey(ValueKey('typing-dot-$i')))
        .transform
        .getTranslation()
        .y,
];

final _typing = find.byKey(const ValueKey('chat-typing'));

/// A message from the fake socket reaches the screen a frame after it is
/// sent: the stream delivers it, then the setState it causes is drawn.
Future<void> _delivered(WidgetTester t) async {
  await t.pump();
  await t.pump(const Duration(milliseconds: 50));
}

void main() {
  group('the dots', () {
    testWidgets('rise in a wave: never all at the same height, and moving', (
      t,
    ) async {
      await t.pumpWidget(
        _host(const Center(child: TypingDots(label: ChatCopy.typing))),
      );
      await t.pump(const Duration(milliseconds: 100));
      final a = _dotYs(t);
      await t.pump(const Duration(milliseconds: 300));
      final b = _dotYs(t);
      expect(a.toSet().length, greaterThan(1), reason: 'a wave, not a pulse');
      expect(a, isNot(equals(b)), reason: 'they move');
      expect(a.every((y) => y <= 0 && y >= -3), isTrue, reason: 'up 3px');
      expect(find.bySemanticsLabel(ChatCopy.typing), findsOneWidget);
    });

    testWidgets('keep still for a visitor who asked for less motion', (
      t,
    ) async {
      await t.pumpWidget(
        _host(
          const Center(child: TypingDots(label: ChatCopy.typing)),
          calm: true,
        ),
      );
      await t.pump(const Duration(milliseconds: 400));
      expect(_dotYs(t), [0, 0, 0]);
      // Nothing left ticking: a repeating controller would never settle.
      await t.pumpAndSettle();
    });
  });

  group('in the chat', () {
    testWidgets('from the line opening to her greeting, then from a message '
        'to her answer, through a tool call', (t) async {
      final ch = _MemChannel();
      await t.pumpWidget(_host(SalemScreen(connect: (_, _) => ch)));
      await t.pump();
      expect(_typing, findsNothing, reason: 'not before the line is open');

      ch.say({'type': 'conversation_initiation_metadata'});
      await _delivered(t);
      expect(_typing, findsOneWidget, reason: 'she speaks first');

      ch.say({
        'type': 'agent_response',
        'agent_response_event': {'agent_response': 'هلا والله!'},
      });
      await _delivered(t);
      await t.pump(const Duration(milliseconds: 400));
      expect(_typing, findsNothing);
      expect(find.text('هلا والله!'), findsOneWidget);

      await t.enterText(find.byKey(const ValueKey('chat-input')), 'قهوة');
      await t.testTextInput.receiveAction(TextInputAction.done);
      await t.pump();
      expect(_typing, findsOneWidget, reason: 'waiting for her answer');

      ch.say({
        'type': 'client_tool_call',
        'client_tool_call': {
          'tool_call_id': 'c1',
          'tool_name': 'show_places',
          'parameters': {'query': 'قهوة'},
        },
      });
      await _delivered(t);
      await t.pump(const Duration(milliseconds: 400));
      expect(_typing, findsOneWidget, reason: 'she answers after the tool');

      ch.say({
        'type': 'agent_response',
        'agent_response_event': {'agent_response': 'لقيت لك أماكن'},
      });
      await _delivered(t);
      await t.pump(const Duration(milliseconds: 400));
      expect(_typing, findsNothing);
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('a reply that never comes is said, not just dropped', (
      t,
    ) async {
      final ch = _MemChannel();
      await t.pumpWidget(_host(SalemScreen(connect: (_, _) => ch)));
      await t.pump();
      ch.say({'type': 'conversation_initiation_metadata'});
      await _delivered(t);
      expect(_typing, findsOneWidget);
      await t.pump(const Duration(seconds: 46));
      await t.pump(const Duration(milliseconds: 400));
      expect(_typing, findsNothing);
      expect(find.text(ChatCopy.noReply), findsOneWidget);
      await t.pumpWidget(const SizedBox());
    });
  });
}
