// A long typed chat keeps her newest reply in view, on the site and here.
// Reported as «she did not answer», 1 October: on the site the page grew and
// the reply landed below the fold. This holds the app to the same promise —
// the transcript scrolls, the box stays put, and the last reply is on screen.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:wain/ai/call_controller.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/screens/salem_screen.dart';
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

Widget _host(Widget child) {
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
        data: MediaQuery.of(context),
        child: Directionality(textDirection: TextDirection.rtl, child: w!),
      ),
    ),
  );
}

void main() {
  for (final size in const [Size(390, 844), Size(320, 568)]) {
    testWidgets('${size.width.toInt()}: after fourteen replies the newest is '
        'fully in view, above the box', (t) async {
      t.view.physicalSize = size;
      t.view.devicePixelRatio = 1;
      addTearDown(t.view.reset);
      final ch = _MemChannel();
      await t.pumpWidget(_host(SalemScreen(connect: (_, _) => ch)));
      await t.pump();
      ch.say({'type': 'conversation_initiation_metadata'});
      await t.pump();
      for (var i = 1; i <= 14; i++) {
        ch.say({
          'type': 'agent_response',
          'agent_response_event': {
            'agent_response':
                'رد $i: مقاهي المباركية في مدينة الكويت، چاي وقهوة عربية في '
                'حوش السوق، وأحلى وقت لها عقب المغرب. تبي شي ثاني؟',
          },
        });
        await t.pump();
        await t.pump(const Duration(milliseconds: 60));
      }
      await t.pump(const Duration(seconds: 1));
      await t.pump(const Duration(seconds: 1));

      final last = find.textContaining('رد 14:');
      expect(last, findsOneWidget, reason: 'the newest reply is built');
      final box = t.getRect(find.byType(TextField));
      final reply = t.getRect(last);
      expect(box.bottom, lessThanOrEqualTo(size.height));
      expect(
        reply.bottom,
        lessThanOrEqualTo(box.top),
        reason: 'not under the box: $reply vs $box',
      );
      expect(reply.top, greaterThanOrEqualTo(0));
    });
  }
}
