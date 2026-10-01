// The one-time question before a conversation with شوق or سالم (ai/consent.dart).
//
// Her agent records calls and keeps calls and typed chats with no expiry, so
// nothing may reach ElevenLabs before the visitor has read that and agreed:
// not a call, and not the typed chat's socket — opening it already starts a
// recorded conversation. These pin the ORDER (question before microphone,
// question before socket) and that one answer is remembered for both.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:wain/ai/call_button.dart';
import 'package:wain/ai/call_controller.dart';
import 'package:wain/ai/config.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/screens/salem_screen.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'support.dart';

Widget _host(AppState state, CallController call, Widget child) {
  final router = GoRouter(
    routes: [
      GoRoute(
        path: '/',
        builder: (_, _) => Scaffold(body: Center(child: child)),
      ),
      GoRoute(
        path: '/privacy',
        builder: (_, _) => const Scaffold(body: Text('privacy-page')),
      ),
    ],
  );
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AppState>.value(value: state),
      ChangeNotifierProvider<CallController>.value(value: call),
    ],
    child: MaterialApp.router(
      routerConfig: router,
      builder: (_, w) =>
          Directionality(textDirection: TextDirection.rtl, child: w!),
    ),
  );
}

void main() {
  group('before a call', () {
    testWidgets('a first call asks first, and «مو الحين» places nothing', (
      t,
    ) async {
      final sessions = <FakeSession>[];
      final call = testController(sessions: sessions);
      final state = AppState.ephemeral();
      await t.pumpWidget(_host(state, call, const ShouqCallButton(size: 48)));

      await t.tap(find.byType(ShouqCallButton));
      await t.pumpAndSettle();
      expect(find.text(AiPrivacyCopy.consentBody), findsOneWidget);
      expect(sessions, isEmpty, reason: 'no session before the answer');

      await t.tap(find.byKey(const ValueKey('ai-consent-decline')));
      await t.pumpAndSettle();
      expect(sessions, isEmpty, reason: 'declined: nothing is placed');
      expect(call.active, isFalse);
      expect(state.aiConsent, isFalse);
      call.dispose();
    });

    testWidgets('agreeing places the call, and the answer is remembered', (
      t,
    ) async {
      final sessions = <FakeSession>[];
      final call = testController(sessions: sessions);
      final state = AppState.ephemeral();
      await t.pumpWidget(_host(state, call, const ShouqCallButton(size: 48)));

      await t.tap(find.byType(ShouqCallButton));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('ai-consent-agree')));
      await t.pumpAndSettle();
      expect(state.aiConsent, isTrue);
      expect(sessions, hasLength(1), reason: 'the call starts on the agree');
      expect(sessions.single.startedAgent, 'agent_test');
      await call.hangUp();
      await t.pump();

      await t.tap(find.byType(ShouqCallButton));
      await t.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('ai-consent-agree')),
        findsNothing,
        reason: 'asked once, not every call',
      );
      expect(sessions, hasLength(2));
      call.dispose();
    });

    testWidgets('«التفاصيل» closes the question and opens the privacy page', (
      t,
    ) async {
      final call = testController(sessions: []);
      final state = AppState.ephemeral();
      await t.pumpWidget(_host(state, call, const ShouqCallButton(size: 48)));
      await t.tap(find.byType(ShouqCallButton));
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('ai-consent-details')));
      await t.pumpAndSettle();
      expect(find.text('privacy-page'), findsOneWidget);
      expect(find.byKey(const ValueKey('ai-consent-agree')), findsNothing);
      expect(state.aiConsent, isFalse);
      call.dispose();
    });
  });

  group('before the typed chat', () {
    testWidgets('no socket opens until the visitor agrees', (t) async {
      var opened = 0;
      final state = AppState.ephemeral();
      final call = testController(sessions: []);
      await t.pumpWidget(
        _host(
          state,
          call,
          SalemScreen(
            connect: (uri, protocols) {
              opened++;
              throw StateError('no network in tests');
            },
          ),
        ),
      );
      await t.pump();
      expect(opened, 0, reason: 'the socket itself starts a recorded chat');
      expect(find.byKey(const ValueKey('chat-consent-body')), findsOneWidget);
      expect(find.byKey(const ValueKey('chat-input')), findsNothing);
      expect(find.text(AiPrivacyCopy.waiting), findsOneWidget);

      await t.tap(find.byKey(const ValueKey('chat-consent-agree')));
      await t.pump();
      expect(opened, 1);
      expect(state.aiConsent, isTrue);
      call.dispose();
    });

    testWidgets('agreed before: connects at once and says the chat is kept', (
      t,
    ) async {
      var opened = 0;
      final state = AppState.ephemeral()..setAiConsent(true);
      final call = testController(sessions: []);
      await t.pumpWidget(
        _host(
          state,
          call,
          SalemScreen(
            // A channel that never answers: the screen stays «connecting», so
            // the input row — and the notice over it — is what is drawn. Real
            // socket IO does not run inside a widget test's fake clock.
            connect: (uri, protocols) {
              opened++;
              return WebSocketChannel.connect(Uri.parse('ws://127.0.0.1:9'));
            },
          ),
        ),
      );
      await t.pump();
      expect(opened, 1);
      expect(find.byKey(const ValueKey('chat-consent-body')), findsNothing);
      expect(
        find.byKey(const ValueKey('chat-recording-notice')),
        findsOneWidget,
        reason: 'agreed once, reminded every time, over the box',
      );
      final notice = t.getRect(
        find.byKey(const ValueKey('chat-recording-notice')),
      );
      final box = t.getRect(find.byKey(const ValueKey('chat-input')));
      expect(
        notice.bottom <= box.top + 1,
        isTrue,
        reason: 'read before typing',
      );
      await t.pumpWidget(const SizedBox());
      call.dispose();
    });
  });
}
