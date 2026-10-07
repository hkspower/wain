// «سالم، شوق، الطلعة والخريطة كلها وحدة» — the web's SalemChat.tsx (3
// October), mirrored. The free chat remembers its last answer; each answer is
// cards, a map of its own, a way to the full search and the share panel, all
// pointing at one place; the replies that would change it sit under the
// newest answer only; «وين بالضبط؟» is a map and the way there; the
// conversation survives leaving the screen; a question handed over is asked
// once as the visitor's own; and his replies can be read aloud in his voice.
import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:wain/ai/call_controller.dart';
import 'package:wain/ai/config.dart';
import 'package:wain/ai/salem_transcript.dart';
import 'package:wain/ai/tools.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/data/answer_order.dart' show AnswerClock;
import 'package:wain/data/catalogue.dart';
import 'package:wain/data/models.dart';
import 'package:wain/data/places.g.dart';
import 'package:wain/data/voice_lines.dart';
import 'package:wain/map/wain_map.dart';
import 'package:wain/screens/salem_screen.dart';
import 'package:wain/share/hangout.dart' show kChoiceMax;
import 'package:wain/share/hangout_panel.dart';
import 'package:wain/voice/voice_service.dart';
import 'package:wain/widgets/place_card.dart';

import 'support.dart';

/// Records what was said, and in whose voice.
class _RecVoice extends VoiceService {
  _RecVoice()
    : super(
        player: _NoPlayer(),
        tts: _NoTts(),
        persona: () => PersonaId.shouq,
        ttsUrl: '',
      );
  final said = <(List<String>, PersonaId?)>[];
  int stops = 0;

  @override
  Future<void> speak(List<SpeechPart> parts, {PersonaId? persona}) async =>
      said.add(([for (final p in parts) p.text], persona));

  @override
  Future<void> stop() async => stops++;
}

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

/// A January evening: no summer rule, so the chips are the web's own for it.
const AnswerClock _january8pm = (month: 0, hour: 20);
const AnswerClock _augustNoon = (month: 7, hour: 13);

late AppState _state;
late _RecVoice _voice;
late CallController _call;

Widget _host({String? q, String? from, AnswerClock clock = _january8pm}) {
  _state = AppState.ephemeral();
  _voice = _RecVoice();
  // The free call — what the app ships — so a tap places it with no consent
  // sheet in between.
  final call = _call = testController(sessions: [], local: true);
  final router = GoRouter(
    routes: [
      GoRoute(
        path: '/',
        builder: (_, _) => SalemScreen(
          agentId: '',
          initialQuery: q,
          handoffFrom: from,
          clock: () => clock,
        ),
      ),
      GoRoute(path: '/find', builder: (_, _) => const Text('the find screen')),
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
      ChangeNotifierProvider<AppState>.value(value: _state),
      ChangeNotifierProvider<CallController>.value(value: call),
      ChangeNotifierProvider<VoiceService>.value(value: _voice),
    ],
    child: MaterialApp.router(
      routerConfig: router,
      builder: (context, w) =>
          Directionality(textDirection: TextDirection.rtl, child: w!),
    ),
  );
}

Future<void> _pump(
  WidgetTester t, {
  String? q,
  String? from,
  AnswerClock clock = _january8pm,
  Size size = const Size(390, 3200),
}) async {
  t.view.physicalSize = size * 2;
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  await t.pumpWidget(_host(q: q, from: from, clock: clock));
  await t.pump();
  await t.pump(const Duration(milliseconds: 400));
}

Future<void> _ask(WidgetTester t, String text) async {
  await t.enterText(find.byKey(const ValueKey('chat-input')), text);
  await t.testTextInput.receiveAction(TextInputAction.send);
  await t.pump();
  await t.pump(const Duration(milliseconds: 400));
}

/// The newest of a kind of block: the transcript is a reversed list, so row 0
/// — built first — is the newest.
Finder _newest(String key) => find.byKey(ValueKey(key)).first;

/// The places an answer holds: the share panel's choices, which are the
/// rail's cards and the map's pins (the rail is lazy, so its off-screen cards
/// are not built to be read); and the first card, which is.
List<String> _railSlugs(WidgetTester t, Finder block) {
  // The cards are the answer; the map carries every one of them, and the
  // share panel offers the first five as choices (kChoiceMax, 3 October — a
  // longer row of times-by-place does not fit a phone), in the same order.
  // The rail is a lazy list, so only the first few cards exist as widgets;
  // the block's own `places` is the whole ordered answer. A private class,
  // reached by its name and a dynamic getter rather than exported for a test.
  final blockWidget = t.widget(
    find.ancestor(
      of: block,
      matching: find.byWidgetPredicate(
        (w) => w.runtimeType.toString() == '_PlacesResult',
      ),
    ),
  );
  final slugs = <String>[
    for (final p in ((blockWidget as dynamic).places as List).cast<Place>())
      p.slug,
  ];
  expect(slugs, isNotEmpty, reason: 'an answer has cards');
  final first = t
      .widgetList<PlaceCard>(
        find.descendant(of: block, matching: find.byType(PlaceCard)),
      )
      .first;
  expect(first.place.slug, slugs.first, reason: 'the rail leads with it');
  final choices = t
      .widget<ShareHangout>(
        find.descendant(of: block, matching: find.byType(ShareHangout)),
      )
      .choices;
  expect(
    [for (final p in choices ?? const <Place>[]) p.slug],
    slugs.take(kChoiceMax).toList(),
    reason:
        'the panel offers the first ${slugs.length > kChoiceMax ? kChoiceMax : slugs.length}',
  );
  final pins = {
    for (final m in t.widgetList<MapPin>(
      find.descendant(of: block, matching: find.byType(MapPin)),
    ))
      m.place.slug,
  };
  expect(pins, slugs.toSet(), reason: 'the map carries the same places');
  return slugs;
}

/// A pin's own tap, as a finger on its dot gives it — pins of the old town
/// overlap at this zoom, so a tap by position can land on a neighbour.
void _tapPin(WidgetTester t, Finder block, String slug) => t
    .widget<MapPin>(
      find.descendant(
        of: block,
        matching: find.byWidgetPredicate(
          (w) => w is MapPin && w.place.slug == slug,
        ),
      ),
    )
    .onTap();

bool _selected(WidgetTester t, Finder f) =>
    t.getSemantics(f).flagsCollection.isSelected == Tristate.isTrue;

void main() {
  // The chips are behind «غيّر» since 7 October; this file drives them.
  setUp(() => debugHangoutStartOpen = true);
  tearDown(() => debugHangoutStartOpen = false);

  setUp(() {
    debugTileUrl = '';
    SalemTranscript.instance.clear();
  });
  tearDown(() => debugTileUrl = null);

  testWidgets('an answer is the cards, a map of its own, the way to the full '
      'search, the share panel and the chips that would change it', (t) async {
    await _pump(t);
    await _ask(t, 'مطعم');
    final ranked = chatRanked('مطعم', searchIndex, kPlaces, _january8pm);
    final block = _newest('chat-places');
    expect(_railSlugs(t, block), ranked.take(8).toList());
    expect(
      find.descendant(
        of: block,
        matching: find.byKey(const ValueKey('chat-map')),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(of: block, matching: find.text(ChatCopy.seeAll)),
      findsOneWidget,
    );
    expect(
      find.descendant(of: block, matching: find.byType(ShareHangout)),
      findsOneWidget,
    );
    // The web's own chips for «مطعم» on a January evening (the fixture).
    for (final c in const ['أرخص', 'للعيال', 'غيره', 'وين بالضبط؟']) {
      expect(find.byKey(ValueKey('chat-chip-$c')), findsOneWidget, reason: c);
    }
    expect(find.text(ChatCopy.followLabel), findsOneWidget);
    // And in August by day, «داخلي» is one of them.
    await t.pumpWidget(const SizedBox());
    SalemTranscript.instance.clear();
    await _pump(t, clock: _augustNoon);
    await _ask(t, 'مطعم');
    expect(find.byKey(const ValueKey('chat-chip-داخلي')), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('a chip is asked as the visitor\'s own words; «غيره» shows the '
      'next places, never the same ones; the chips move to the newest answer', (
    t,
  ) async {
    await _pump(t);
    await _ask(t, 'مطعم');
    final ranked = chatRanked('مطعم', searchIndex, kPlaces, _january8pm);
    await t.tap(find.byKey(const ValueKey('chat-chip-غيره')));
    await t.pump();
    await t.pump(const Duration(milliseconds: 400));
    expect(find.text('غيره'), findsWidgets, reason: 'his bubble');
    expect(find.textContaining(ChatCopy.moreIntro), findsOneWidget);
    expect(
      _railSlugs(t, _newest('chat-places')),
      ranked.skip(8).take(8).toList(),
    );
    expect(find.byKey(const ValueKey('chat-places')), findsNWidgets(2));
    expect(
      find.byKey(const ValueKey('chat-followups')),
      findsOneWidget,
      reason: 'under the newest answer only',
    );
    // Once every place has been shown, «غيره» says so.
    if (ranked.length <= 16) {
      await _ask(t, 'غيره');
      expect(find.text(ChatCopy.moreNone), findsOneWidget);
    }
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('«أرخص» narrows the last question rather than starting again', (
    t,
  ) async {
    await _pump(t);
    await _ask(t, 'مطعم');
    await _ask(t, 'أرخص');
    expect(
      _railSlugs(t, _newest('chat-places')),
      chatRanked(
        'مطعم أرخص',
        searchIndex,
        kPlaces,
        _january8pm,
      ).take(8).toList(),
    );
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('«الثاني» picks the second card: its card and the share panel', (
    t,
  ) async {
    await _pump(t);
    await _ask(t, 'مطعم');
    final second = getPlace(
      chatRanked('مطعم', searchIndex, kPlaces, _january8pm)[1],
    )!;
    await _ask(t, 'الثاني');
    final picked = _newest('chat-picked');
    expect(
      t
          .widget<PlaceCard>(
            find.descendant(of: picked, matching: find.byType(PlaceCard)),
          )
          .place
          .slug,
      second.slug,
    );
    expect(
      find.descendant(of: picked, matching: find.byType(ShareHangout)),
      findsOneWidget,
    );
    expect(find.textContaining(placeTryLine(second)), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('the pin, the card and the panel point at one place — and '
      '«وين بالضبط؟» answers for it, with a map and the way there', (t) async {
    await _pump(t);
    await _ask(t, 'مطعم');
    final ranked = chatRanked('مطعم', searchIndex, kPlaces, _january8pm);
    final block = _newest('chat-places');
    final third = getPlace(ranked[2])!;
    // A pin.
    _tapPin(t, block, third.slug);
    await t.pump();
    expect(
      _selected(
        t,
        find.descendant(
          of: block,
          matching: find.byKey(ValueKey('place-${third.slug}')),
        ),
      ),
      isTrue,
      reason: 'the share panel follows the pin',
    );
    // The panel, back to the map.
    final fourth = getPlace(ranked[3])!;
    await t.tap(
      find.descendant(
        of: block,
        matching: find.byKey(ValueKey('place-${fourth.slug}')),
      ),
    );
    await t.pump();
    expect(
      t
          .widget<MapPin>(
            find.descendant(
              of: block,
              matching: find.byWidgetPredicate(
                (w) => w is MapPin && w.place.slug == fourth.slug,
              ),
            ),
          )
          .selected,
      isTrue,
      reason: 'the pin follows the panel',
    );
    await _ask(t, 'وين بالضبط؟');
    expect(
      find.text('${fourth.nameAr} — ${fourth.areaAr}. ${ChatCopy.where}'),
      findsOneWidget,
    );
    final where = _newest('chat-where');
    expect(
      find.descendant(of: where, matching: find.byType(WainMap)),
      findsOneWidget,
    );
    expect(
      find.descendant(of: where, matching: find.text(ChatCopy.directions)),
      findsOneWidget,
    );
    await t.tap(
      find.descendant(of: where, matching: find.text(ChatCopy.openPlace)),
    );
    await t.pumpAndSettle();
    expect(find.text('place ${fourth.slug}'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('the conversation survives leaving the screen, and still '
      'remembers what it was about', (t) async {
    await _pump(t);
    await _ask(t, 'مطعم');
    final answer = find.byKey(const ValueKey('chat-places'));
    expect(answer, findsOneWidget);
    // Gone: the screen is disposed, as a tab switch or a pop disposes it.
    await t.pumpWidget(const SizedBox());
    await _pump(t);
    expect(find.text('مطعم'), findsWidgets, reason: 'his question, restored');
    expect(answer, findsOneWidget, reason: 'and its answer');
    await _ask(t, 'غيره');
    expect(
      _railSlugs(t, _newest('chat-places')),
      chatRanked(
        'مطعم',
        searchIndex,
        kPlaces,
        _january8pm,
      ).skip(8).take(8).toList(),
      reason: '«غيره» reads the restored memory',
    );
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('a handed-over question is asked once, as his own message', (
    t,
  ) async {
    await _pump(t, q: 'بحر');
    final user = find.byWidgetPredicate((w) => w is Text && w.data == 'بحر');
    expect(user, findsOneWidget);
    expect(find.byKey(const ValueKey('chat-places')), findsOneWidget);
    await t.pump(const Duration(seconds: 1));
    await t.tap(find.byKey(const ValueKey('chat-chip-غيره')));
    await t.pump(const Duration(milliseconds: 400));
    // Counted in the transcript: the bubble itself may be scrolled away.
    expect(
      SalemTranscript.instance.lines.whereType<ChatText>().where(
        (l) => l.role == 'user' && l.text == 'بحر',
      ),
      hasLength(1),
      reason: 'not asked a second time',
    );
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('«اقرا لي الردود»: off until pressed, remembered, and his '
      'replies are read in his voice', (t) async {
    await _pump(t);
    await _ask(t, 'مطعم');
    expect(_voice.said, isEmpty, reason: 'off by default');
    await t.tap(find.byKey(const ValueKey('chat-read-aloud')));
    await t.pump();
    expect(_state.salemReadAloud, isTrue);
    await _ask(t, 'الثاني');
    expect(_voice.said, hasLength(1));
    expect(_voice.said.single.$2, PersonaId.salem);
    await t.tap(find.byKey(const ValueKey('chat-read-aloud')));
    await t.pump();
    expect(_state.salemReadAloud, isFalse);
    expect(_voice.stops, greaterThan(0), reason: 'turning it off stops him');
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('«كلّم شوق» places her call from his header, with no detour '
      'to /find; «شوف الكل بالبحث» opens the same question as a search', (
    t,
  ) async {
    await _pump(t);
    expect(_call.active, isFalse);
    await t.tap(find.byKey(const ValueKey('chat-call-shouq')));
    await t.pump();
    expect(_call.active, isTrue, reason: 'one tap places the call');
    expect(find.text('the find screen'), findsNothing);
    _call.hangUp();
    await t.pump();
    await t.pumpWidget(const SizedBox());
    await _pump(t);
    await _ask(t, 'مطعم');
    await t.tap(find.byKey(const ValueKey('chat-see-all')).first);
    await t.pumpAndSettle();
    expect(find.text('search for مطعم'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  group('a question handed over from شوق (7 October)', () {
    final want = chatRanked('رخيص', searchIndex, kPlaces, _january8pm)[0];

    testWidgets('the test can tell the two readings apart', (t) async {
      // «رخيص» narrows a remembered answer, so read against an older chat
      // about coffee it became «قهوة رخيص» — which leads with another place.
      expect(
        chatRanked('قهوة رخيص', searchIndex, kPlaces, _january8pm)[0],
        isNot(want),
      );
    });

    testWidgets('is asked fresh after an older chat, and says where it came '
        'from', (t) async {
      SalemTranscript.instance.clear();
      await _pump(t);
      await _ask(t, 'قهوة');
      await t.pumpWidget(const SizedBox());
      await _pump(t, q: 'رخيص', from: 'shouq');
      expect(find.text('من جواب شوق: «رخيص»'), findsOneWidget);
      expect(_railSlugs(t, _newest('chat-places')).first, want);
      // The list is lazy, so the older bubble is read from the transcript.
      expect(
        SalemTranscript.instance.lines.whereType<ChatText>().where(
          (l) => l.role == 'user' && l.text == 'قهوة',
        ),
        hasLength(1),
        reason: 'the older chat stays',
      );
      await t.pumpWidget(const SizedBox());
      SalemTranscript.instance.clear();
    });

    testWidgets('from her call says so', (t) async {
      SalemTranscript.instance.clear();
      await _pump(t, q: 'رخيص', from: 'call');
      expect(find.text('من مكالمتك مع شوق: «رخيص»'), findsOneWidget);
      expect(_railSlugs(t, _newest('chat-places')).first, want);
      await t.pumpWidget(const SizedBox());
      SalemTranscript.instance.clear();
    });

    testWidgets('a question with no source draws no line', (t) async {
      SalemTranscript.instance.clear();
      await _pump(t, q: 'رخيص');
      expect(find.textContaining('من جواب شوق'), findsNothing);
      expect(find.textContaining('من مكالمتك'), findsNothing);
      await t.pumpWidget(const SizedBox());
      SalemTranscript.instance.clear();
    });
  });

  for (final size in const [Size(390, 844), Size(320, 568), Size(800, 1280)]) {
    testWidgets('${size.width.toInt()}: an answer, a pick and a «where» lay '
        'out without overflow, and a tall answer is shown from its sentence', (
      t,
    ) async {
      await _pump(t, size: size);
      await _ask(t, 'مطعم');
      await t.pumpAndSettle();
      // The sentence that starts the reply is on screen, not above it.
      final sentence = find.textContaining(
        placeTryLine(
          getPlace(chatRanked('مطعم', searchIndex, kPlaces, _january8pm)[0])!,
        ),
      );
      expect(sentence, findsOneWidget);
      final list = t.getRect(find.byType(ListView).first);
      expect(
        t.getRect(sentence).top,
        greaterThanOrEqualTo(list.top),
        reason: 'the reply starts on screen',
      );
      await _ask(t, 'الثاني');
      await t.pumpAndSettle();
      await _ask(t, 'وين بالضبط؟');
      await t.pumpAndSettle();
      expect(t.takeException(), isNull);
      // The header holds its two controls at every width.
      expect(find.byKey(const ValueKey('chat-read-aloud')), findsOneWidget);
      expect(find.byKey(const ValueKey('chat-call-shouq')), findsOneWidget);
      await t.pumpWidget(const SizedBox());
    });
  }
}
