// What the search screen answers when the question is not a search (8
// October, mirroring the web's SearchClient): a greeting is answered as a
// greeting with the hour's picks under it, thanks with nothing under it and
// no dead end, a part of Kuwait with nothing in it is named back, and a word
// the place named did not answer is owned up to before the place.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/main.dart';
import 'package:wain/map/wain_map.dart';

Future<void> at(WidgetTester t, String location) async {
  t.view.physicalSize = const Size(390 * 2, 844 * 2);
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  await t.pumpWidget(
    WainApp(state: AppState.ephemeral(), initialLocation: location),
  );
  await t.pump(const Duration(milliseconds: 400));
}

bool shows(String needle) => find
    .byWidgetPredicate((w) => w is Text && (w.data ?? '').contains(needle))
    .evaluate()
    .isNotEmpty;

void main() {
  setUp(() => debugTileUrl = '');
  tearDown(() => debugTileUrl = null);

  testWidgets('«السلام عليكم» is answered as a greeting, with picks under it', (
    t,
  ) async {
    await at(t, '/search?q=${Uri.encodeComponent('السلام عليكم')}');
    expect(find.byKey(const ValueKey('search-answer')), findsOneWidget);
    expect(shows('وعليكم السلام'), isTrue, reason: 'the word back');
    expect(shows('قول لي وش تبي'), isTrue, reason: 'the question back');
    expect(shows('ما لقينا شي'), isFalse, reason: 'no dead end');
    expect(shows('أقترح عليك'), isFalse, reason: 'nothing recommended');
    expect(
      find.byKey(const ValueKey('search-map-bar')),
      findsOneWidget,
      reason: "the hour's picks are on the list",
    );
    expect(find.byKey(const ValueKey('answer-share')), findsNothing);
  });

  testWidgets('«شكراً» is thanked, and nothing is shown under it', (t) async {
    await at(t, '/search?q=${Uri.encodeComponent('شكراً')}');
    expect(shows('العفو'), isTrue);
    expect(shows('ما لقينا شي'), isFalse, reason: 'nothing was asked');
    expect(find.byKey(const ValueKey('search-map-bar')), findsNothing);
  });

  testWidgets('a greeting in front of a question is said back first', (
    t,
  ) async {
    await at(t, '/search?q=${Uri.encodeComponent('هلا، أبي قهوة')}');
    expect(shows('هلا والله!'), isTrue);
    expect(shows('أقترح عليك: جرّب'), isTrue, reason: 'and then the answer');
    expect(find.byKey(const ValueKey('search-map-bar')), findsOneWidget);
  });

  testWidgets('«قريب مني» asks where you are', (t) async {
    await at(t, '/search?q=${Uri.encodeComponent('قريب مني')}');
    expect(shows('ما أدري وين أنت'), isTrue);
    expect(find.byKey(const ValueKey('search-map-bar')), findsOneWidget);
  });

  testWidgets('a part of Kuwait with nothing in it is named back', (t) async {
    await at(t, '/search?q=${Uri.encodeComponent('مطعم بالجهراء')}');
    expect(shows('ما عندي أماكن بالجهراء'), isTrue);
    expect(shows('ما لقينا شي عن'), isFalse, reason: 'said once, by name');
    expect(find.byKey(const ValueKey('search-map-bar')), findsNothing);
  });

  testWidgets('a word the place did not answer is owned up to', (t) async {
    await at(t, '/search?q=${Uri.encodeComponent('مطعم ياباني')}');
    expect(shows('ما عندي «ياباني» بالضبط'), isTrue);
    expect(shows('أقترح عليك: جرّب'), isTrue, reason: 'the nearest thing');
  });
}
