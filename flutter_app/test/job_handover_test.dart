// The job travels between the agents (ai/agent_job.dart, the web's
// agent-job.ts, 14–15 October): her answer on the search screen hands سالم
// the places she showed and the one pointed at; his chat says which place the
// visitor had picked, and «وينه؟» means it; his agent is told the job when its
// line opens; a job half an hour old belongs to another visit.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:wain/ai/agent_job.dart';
import 'package:wain/ai/call_controller.dart';
import 'package:wain/ai/config.dart';
import 'package:wain/ai/salem_transcript.dart';
import 'package:wain/ai/tools.dart' show chatRanked;
import 'package:wain/app/app_state.dart';
import 'package:wain/data/answer_order.dart' show AnswerClock;
import 'package:wain/data/catalogue.dart';
import 'package:wain/data/places.g.dart';
import 'package:wain/data/voice_lines.dart' show PersonaId;
import 'package:wain/map/wain_map.dart' show debugTileUrl;
import 'package:wain/screens/privacy_screen.dart';
import 'package:wain/screens/salem_screen.dart';
import 'package:wain/screens/search_screen.dart';
import 'package:wain/share/hangout_panel.dart';
import 'package:wain/voice/voice_service.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'support.dart';

/// A January evening, as the chat's own tests read it.
const AnswerClock _january8pm = (month: 0, hour: 20);

String? _nameOf(String slug) => getPlace(slug)?.nameAr;

/// A socket in memory, driven by the widget test's clock (typing_test.dart
/// has the same one, and says why).
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

/// A voice that says nothing: the search screen reads one for her answer.
class _NoPlayer implements ClipPlayer {
  @override
  Future<bool> playBytes(Uint8List mp3) async => true;
  @override
  Future<bool> playClips(List<Clip> clips) async => true;
  @override
  Future<void> stop() async {}
}

class _NoTts implements TtsBackend {
  @override
  Future<void> speakLines(List<String> lines) async {}
  @override
  Future<void> stop() async {}
}

late CallController _call;
final _sessions = <FakeSession>[];
final _went = <String>[];

/// One screen with somewhere for its links to go; the visitor has agreed to
/// the agent conversation, so a socket opens at once.
Widget _host(Widget screen) {
  final state = AppState.ephemeral()..setAiConsent(true);
  _sessions.clear();
  _call = testController(sessions: _sessions);
  _went.clear();
  final router = GoRouter(
    routes: [
      GoRoute(path: '/', builder: (_, _) => screen),
      GoRoute(
        path: '/salem',
        builder: (_, s) {
          _went.add(s.uri.toString());
          return const Text('his chat');
        },
      ),
      GoRoute(path: '/find', builder: (_, _) => const Text('find')),
      GoRoute(
        path: '/search',
        builder: (_, s) => Text('search for ${s.uri.queryParameters['q']}'),
      ),
      GoRoute(
        path: '/places/:slug',
        builder: (_, s) => Text('place ${s.pathParameters['slug']}'),
      ),
    ],
  );
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AppState>.value(value: state),
      ChangeNotifierProvider<CallController>.value(value: _call),
      ChangeNotifierProvider<VoiceService>.value(
        value: VoiceService(
          player: _NoPlayer(),
          tts: _NoTts(),
          persona: () => PersonaId.shouq,
          ttsUrl: '',
        ),
      ),
    ],
    child: MaterialApp.router(
      routerConfig: router,
      builder: (context, w) =>
          Directionality(textDirection: TextDirection.rtl, child: w!),
    ),
  );
}

Future<void> _pump(WidgetTester t, Widget screen) async {
  t.view.physicalSize = const Size(390, 3200) * 2;
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  await t.pumpWidget(_host(screen));
  await t.pump();
  await t.pump(const Duration(milliseconds: 400));
}

/// His free chat, with a question handed over.
Future<void> _chat(WidgetTester t, String q, String from) => _pump(
  t,
  SalemScreen(
    salemAgentId: '',
    initialQuery: q,
    handoffFrom: from,
    clock: () => _january8pm,
  ),
);

Future<void> _ask(WidgetTester t, String text) async {
  await t.enterText(find.byKey(const ValueKey('chat-input')), text);
  await t.testTextInput.receiveAction(TextInputAction.send);
  await t.pump();
  await t.pump(const Duration(milliseconds: 400));
}

/// The place «وينه؟» was answered with: the last «where» in the transcript.
String? _whereSlug() =>
    SalemTranscript.instance.lines.whereType<ChatWhere>().lastOrNull?.slug;

void main() {
  setUp(() {
    AgentJobs.instance.reset();
    SalemTranscript.instance.clear();
    debugTileUrl = '';
  });
  tearDown(() {
    AgentJobs.instance.reset();
    SalemTranscript.instance.clear();
    debugTileUrl = null;
  });

  group('a question handed to his chat brings its job', () {
    // The chat's own answer to «بحر», and its second place: not the one
    // «وينه؟» would mean with nothing picked (the first).
    final answer = chatRanked('بحر', searchIndex, kPlaces, _january8pm);
    final second = answer[1];

    testWidgets('the line says which place the visitor picked, and «وينه؟» '
        'means it', (t) async {
      writeJob(
        JobAgent.shouqAnswer,
        asked: 'بحر',
        shown: answer.take(8).toList(),
        ranked: answer,
        picked: second,
      );
      await _chat(t, 'بحر', 'shouq');
      expect(
        find.text('من جواب شوق: «بحر» — واخترت «${_nameOf(second)}»'),
        findsOneWidget,
      );
      await _ask(t, 'وينه؟');
      expect(_whereSlug(), second, reason: 'the place picked with her');
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('from the call-centre page, said as such', (t) async {
      writeJob(
        JobAgent.callCenter,
        asked: 'بحر',
        shown: [second],
        picked: second,
      );
      await _chat(t, 'بحر', 'call-center');
      expect(
        find.text('من مركز الاتصال: «بحر» — واخترت «${_nameOf(second)}»'),
        findsOneWidget,
      );
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('a job about another question carries no pick', (t) async {
      writeJob(
        JobAgent.shouqAnswer,
        asked: 'قهوة',
        shown: [second],
        picked: second,
      );
      await _chat(t, 'بحر', 'shouq');
      expect(find.text('من جواب شوق: «بحر»'), findsOneWidget);
      expect(find.textContaining('واخترت'), findsNothing);
      await _ask(t, 'وينه؟');
      expect(_whereSlug(), answer.first, reason: 'nothing picked: the first');
      await t.pumpWidget(const SizedBox());
    });

    // A finger landing on a card points at it (the rail's Listener), as the
    // map's pin does: the place the next agent hears was picked.
    testWidgets('a card pointed at in his answer is the job\'s pick', (
      t,
    ) async {
      await _chat(t, 'بحر', 'shouq');
      final g = await t.startGesture(
        t.getCenter(find.byKey(ValueKey('chat-card-$second'))),
      );
      await g.cancel();
      await t.pump();
      expect(readJob()!.picked, second);
      expect(readJob()!.asked, 'بحر', reason: 'the pick stays with its job');
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('a job half an hour old is another visit\'s', (t) async {
      final at = DateTime.utc(2026, 10, 15, 17);
      AgentJobs.instance.now = () => at;
      writeJob(
        JobAgent.shouqAnswer,
        asked: 'بحر',
        shown: answer.take(8).toList(),
        ranked: answer,
        picked: second,
      );
      AgentJobs.instance.now = () => at.add(const Duration(minutes: 31));
      await _chat(t, 'بحر', 'shouq');
      expect(find.text('من جواب شوق: «بحر»'), findsOneWidget);
      expect(find.textContaining('واخترت'), findsNothing);
      await _ask(t, 'وينه؟');
      expect(_whereSlug(), answer.first);
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('his answer becomes the job, and «الثاني» is picked inside '
        'it', (t) async {
      await _chat(t, 'بحر', 'shouq');
      final job = readJob()!;
      expect(job.by, JobAgent.salemChat);
      expect(job.asked, 'بحر');
      expect(job.shown, answer.take(8).toList());
      expect(answer.length, greaterThan(8));
      expect(job.ranked, answer, reason: 'all of it, for «غيره» next door');
      await _ask(t, 'الثاني');
      expect(readJob()!.picked, second);
      expect(readJob()!.asked, 'بحر', reason: 'the pick stays with its job');
      await t.pumpWidget(const SizedBox());
    });
  });

  group('his agent is told the job when its line opens', () {
    Future<_MemChannel> open(WidgetTester t) async {
      final ch = _MemChannel();
      await _pump(
        t,
        SalemScreen(connect: (_, _) => ch, salemAgentId: 'agent_test'),
      );
      ch.say({'type': 'conversation_initiation_metadata'});
      await t.pump();
      await t.pump(const Duration(milliseconds: 50));
      return ch;
    }

    testWidgets('once, as background, after the handshake', (t) async {
      writeJob(
        JobAgent.shouqCall,
        asked: 'قهوة هادية',
        shown: ['souq-al-mubarakiya', 'kuwait-towers'],
        picked: 'kuwait-towers',
      );
      final job = readJob()!;
      final ch = await open(t);
      final told = ch.sent.where((m) => m['type'] == 'contextual_update');
      expect(told, hasLength(1));
      expect(told.single['text'], jobContext(job, _nameOf));
      expect(told.single['text'], contains('مكالمته مع شوق'));
      expect(
        ch.sent.indexWhere((m) => m['type'] == 'contextual_update'),
        greaterThan(
          ch.sent.indexWhere(
            (m) => m['type'] == 'conversation_initiation_client_data',
          ),
        ),
        reason: 'after the handshake',
      );
      await t.pumpWidget(const SizedBox());
    });

    // The handed-over question waits for his greeting; the job goes in when
    // the line opens, so his agent has read it by the time it is asked.
    testWidgets('before the handed-over question', (t) async {
      writeJob(
        JobAgent.shouqAnswer,
        asked: 'بحر',
        shown: ['kuwait-towers'],
        picked: 'kuwait-towers',
      );
      final ch = _MemChannel();
      await _pump(
        t,
        SalemScreen(
          connect: (_, _) => ch,
          salemAgentId: 'agent_test',
          initialQuery: 'بحر',
          handoffFrom: 'shouq',
        ),
      );
      ch.say({'type': 'conversation_initiation_metadata'});
      await t.pump();
      await t.pump(const Duration(milliseconds: 50));
      ch.say({
        'type': 'agent_response',
        'agent_response_event': {'agent_response': 'هلا والله، أنا سالم'},
      });
      await t.pump();
      await t.pump(const Duration(milliseconds: 50));
      final told = ch.sent.indexWhere((m) => m['type'] == 'contextual_update');
      final asked = ch.sent.indexWhere((m) => m['type'] == 'user_message');
      expect(told, isNonNegative, reason: 'the job was told');
      expect(asked, greaterThan(told), reason: 'and then the question asked');
      expect(ch.sent[asked]['text'], 'بحر');
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('never his own job back', (t) async {
      writeJob(JobAgent.salemChat, asked: 'بحر', shown: ['kuwait-towers']);
      final ch = await open(t);
      expect(ch.sent.where((m) => m['type'] == 'contextual_update'), isEmpty);
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('his show_places becomes the job; his open_place picks in '
        'it', (t) async {
      final ch = await open(t);
      ch.say({
        'type': 'client_tool_call',
        'client_tool_call': {
          'tool_call_id': 'c1',
          'tool_name': 'show_places',
          'parameters': {'query': 'بحر'},
        },
      });
      await t.pump();
      await t.pump(const Duration(milliseconds: 50));
      final job = readJob()!;
      expect(job.by, JobAgent.salemChat);
      expect(job.asked, 'بحر');
      expect(job.shown, hasLength(8));
      expect(job.ranked.length, greaterThan(8), reason: 'all of it');
      expect(job.ranked.take(8), job.shown);
      ch.say({
        'type': 'client_tool_call',
        'client_tool_call': {
          'tool_call_id': 'c2',
          'tool_name': 'open_place',
          'parameters': {'slug': job.shown[1]},
        },
      });
      await t.pump();
      await t.pump(const Duration(milliseconds: 50));
      expect(readJob()!.picked, job.shown[1]);
      expect(readJob()!.asked, 'بحر');
      await t.pumpWidget(const SizedBox());
    });
  });

  group('«كمّل مع سالم» on her answer hands over the job', () {
    // The panel's «أي مكان؟» row is behind «غيّر» since 7 October.
    setUp(() => debugHangoutStartOpen = true);
    tearDown(() => debugHangoutStartOpen = false);
    Future<void> search(WidgetTester t, String q) =>
        _pump(t, Scaffold(body: SearchScreen(initialQuery: q)));

    testWidgets('as her written answer\'s: her places, and the one pointed '
        'at', (t) async {
      await search(t, 'قهوة');
      final panel = find.byKey(const ValueKey('search-hangout'));
      final choices = t.widget<ShareHangout>(panel).choices!;
      final other = choices[1];
      // Pointed at in the share panel — the same place the map and the list
      // point at.
      Scrollable.ensureVisible(
        t.element(find.byKey(ValueKey('place-${other.slug}'))),
        alignment: 0.5,
      );
      await t.pumpAndSettle();
      await t.tap(find.byKey(ValueKey('place-${other.slug}')));
      await t.pump();
      Scrollable.ensureVisible(
        t.element(find.byKey(const ValueKey('answer-salem'))),
        alignment: 0.5,
      );
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('answer-salem')));
      await t.pumpAndSettle(const Duration(milliseconds: 100));
      expect(_went.single, salemHandoff('قهوة', from: 'shouq'));
      final job = readJob()!;
      expect(job.by, JobAgent.shouqAnswer);
      expect(job.asked, 'قهوة');
      expect(job.shown.take(choices.length), [for (final p in choices) p.slug]);
      expect(job.picked, other.slug);
      await t.pumpWidget(const SizedBox());
    });

    // Her AGENT call, on purpose: the web counts her free call only (its
    // `asked` is written by the free call), so after her agent call the site
    // files this job as her written answer's and his chat says «من جواب شوق».
    // The app's controller knows the call asked it either way and says so —
    // the truer label, kept as a deliberate difference from the web.
    testWidgets('as her call\'s after her agent call too — the app\'s rule, '
        'where the web counts her free call only', (t) async {
      await search(t, 'بحر');
      // Her call searched «بحر» and is over: this answer is the call's.
      await _call.start();
      expect(_sessions.single.local, isFalse, reason: 'her agent call');
      _sessions.single.onConnected!();
      await _sessions.single.tools['show_places']!({'query': 'بحر'});
      await _call.hangUp();
      await t.pump();
      // What the call itself wrote is not what is being tested here.
      AgentJobs.instance.reset();
      Scrollable.ensureVisible(
        t.element(find.byKey(const ValueKey('answer-salem'))),
        alignment: 0.5,
      );
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('answer-salem')));
      await t.pumpAndSettle(const Duration(milliseconds: 100));
      expect(_went.single, salemHandoff('بحر', from: 'call'));
      final job = readJob()!;
      expect(job.by, JobAgent.shouqCall);
      expect(job.asked, 'بحر');
      expect(job.shown, hasLength(8));
      expect(job.ranked.length, greaterThan(8), reason: 'all of her answer');
      expect(job.ranked.take(8), job.shown);
      expect(job.picked, isNull, reason: 'nothing pointed at');
      await t.pumpWidget(const SizedBox());
    });

    // A call with HIM opens this screen too — his free call lands here in
    // the app, and either call's show_places does — and the card filed the
    // job as a call with her: his chat said «من مكالمتك مع شوق» and his agent
    // was told so, of a call that was with him. Her written answer's, as the
    // web's card says after any call that did not write its `asked`.
    testWidgets('after a call with him, as her written answer\'s — never as a '
        'call with her', (t) async {
      await search(t, 'بحر');
      await _call.start(persona: CallPersona.salem);
      _sessions.single.onConnected!();
      await _sessions.single.tools['show_places']!({'query': 'بحر'});
      await _call.hangUp();
      await t.pump();
      expect(readJob()!.by, JobAgent.salemCall, reason: 'what his call wrote');
      Scrollable.ensureVisible(
        t.element(find.byKey(const ValueKey('answer-salem'))),
        alignment: 0.5,
      );
      await t.pumpAndSettle();
      await t.tap(find.byKey(const ValueKey('answer-salem')));
      await t.pumpAndSettle(const Duration(milliseconds: 100));
      expect(_went.single, salemHandoff('بحر', from: 'shouq'));
      final job = readJob()!;
      expect(job.by, JobAgent.shouqAnswer);
      expect(job.asked, 'بحر');
      expect(jobContext(job, _nameOf), isNot(contains('مكالمته مع شوق')));
      await t.pumpWidget(const SizedBox());
    });
  });

  test('the privacy screen says what the job keeps, for how long, and who '
      'is told', () {
    expect(PrivacyScreen.aiFree, contains(PrivacyScreen.jobFree));
    expect(PrivacyScreen.aiAgent, contains(PrivacyScreen.jobAgent));
    for (final s in [PrivacyScreen.jobFree, PrivacyScreen.jobAgent]) {
      expect(s, contains('نص ساعة'));
      expect(s, contains('ذاكرة التطبيق'));
    }
    expect(PrivacyScreen.jobAgent, contains('ينقال لها هالشي في بدايتها'));
  });
}
