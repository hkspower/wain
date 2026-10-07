// /pick counts the group's votes (7 October): the app's half of the web's
// together.test §6. A stand-in server answers vote_cast / votes_get; the
// real endpoint is proved by test:wain-api.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/orders/order_api.dart';
import 'package:wain/screens/pick_screen.dart';
import 'package:wain/share/share_service.dart';
import 'package:wain/share/votes.dart';

class _Share extends ShareBackend {
  final sent = <String>[];
  @override
  Future<bool?> nativeShare(String text, String title) async {
    sent.add(text);
    return true;
  }

  @override
  Future<bool> openWhatsApp(Uri uri) async => false;
  @override
  Future<bool> copy(String text) async => true;
  @override
  Future<bool?> shareFile(List<int> bytes, String name, String mime, String title) async => null;
  @override
  Future<bool> openUrl(Uri uri) async => false;
}

final _towers = getPlace('kuwait-towers')!;
final _souq = getPlace('souq-al-mubarakiya')!;
final _park = getPlace('al-shaheed-park')!;
final _wednesday = DateTime.utc(2026, 12, 16, 11, 5);

/// Votes by voter id, answered the way wain-api.php does.
class _Server {
  final votes = <String, String>{'friend-a': 'souq-al-mubarakiya', 'friend-b': 'souq-al-mubarakiya', 'friend-c': 'al-shaheed-park'};
  final actions = <String>[];
  late final VoteClient client = VoteClient(
    OrderApi(
      url: 'https://test.invalid/api/wain.php',
      client: MockClient((req) async {
        final a = req.url.queryParameters['a']!;
        actions.add(a);
        final body = Map<String, Object?>.from(jsonDecode(req.body) as Map);
        if (a == 'vote_cast') votes[body['voter'] as String] = body['place_slug'] as String;
        final options = (body['options'] as List).cast<String>();
        final tally = {for (final o in options) o: votes.values.where((v) => v == o).length};
        return http.Response(jsonEncode({'ok': true, 'tally': tally, 'total': votes.length}), 200);
      }),
    ),
  );
}

Future<void> _pick(WidgetTester t, String query, VoteClient client) async {
  t.view.physicalSize = const Size(780, 3200);
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  await t.pumpWidget(
    MaterialApp(
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (c, w) => Directionality(textDirection: TextDirection.rtl, child: w!),
      home: Scaffold(body: PickScreen(query: query, clock: () => _wednesday, votes: client)),
    ),
  );
  await t.pump();
  await t.pump(const Duration(milliseconds: 50));
  await t.pump();
}

String _text(WidgetTester t, Finder f) => t.widgetList<Text>(find.descendant(of: f, matching: find.byType(Text))).map((x) => x.data ?? '').join(' ');

void main() {
  final slugs = [_towers.slug, _souq.slug, _park.slug].join(',');
  setUp(() => SharedPreferences.setMockInitialValues({}));
  tearDown(() => debugShareBackend = null);

  testWidgets('a link with a poll shows the count the group has cast, and who leads', (t) async {
    final s = _Server();
    await _pick(t, 'p=$slugs&when=tomorrow&v=abcdef123456', s.client);
    expect(_text(t, find.byKey(ValueKey('pick-tally-${_souq.slug}'))), contains('صوتين'));
    final summary = (t.widget(find.byKey(const ValueKey('pick-tally-summary'))) as Text).data!;
    expect(summary, contains('٣ أصوات'));
    expect(summary, contains(_souq.nameAr));
    // Stop the 20-second refresh before the test ends.
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('a vote is counted at once, still goes to the chat, and a tie is said as one', (t) async {
    final share = _Share();
    debugShareBackend = share;
    final s = _Server();
    await _pick(t, 'p=$slugs&when=tomorrow&v=abcdef123456', s.client);
    await t.tap(find.byKey(ValueKey('pick-vote-${_park.slug}')));
    await t.pump();
    await t.pump(const Duration(milliseconds: 50));
    await t.pump();
    expect(s.actions, contains('vote_cast'));
    expect(_text(t, find.byKey(ValueKey('pick-tally-${_park.slug}'))), contains('صوتين'));
    expect((t.widget(find.byKey(const ValueKey('pick-tally-summary'))) as Text).data, contains('متعادلين'));
    expect(share.sent, hasLength(1), reason: 'the reply still goes to the chat');
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('a link with no poll asks the server nothing and shows no count', (t) async {
    final s = _Server();
    await _pick(t, 'p=$slugs&when=tomorrow', s.client);
    expect(s.actions, isEmpty);
    expect(find.byKey(const ValueKey('pick-tally-summary')), findsNothing);
  });
}
