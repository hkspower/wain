// The share panel as a ready plan (7 October, on request): closed, it is the
// place and the time in one line with a big send button; «غيّر» opens the
// chips. The time this device sent last is the next default when it is still
// on offer. The web's half is hangout-page.test.mjs.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/share/hangout.dart';
import 'package:wain/share/hangout_panel.dart';

// A Wednesday afternoon in December: an ordinary day, no summer heat.
final _wednesday = DateTime.utc(2026, 12, 16, 11, 5);

Future<void> _pump(WidgetTester t, Widget w) async {
  t.view.physicalSize = const Size(780, 1600);
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
      builder: (c, child) => Directionality(textDirection: TextDirection.rtl, child: child!),
      home: Scaffold(body: SingleChildScrollView(child: w)),
    ),
  );
  await t.pump();
  await t.pump();
}

String _text(WidgetTester t, String key) => (t.widget(find.byKey(ValueKey(key))) as Text).data ?? '';

void main() {
  final mall = getPlace('the-avenues')!;

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('closed: the plan in one line, no chips, and the send button', (t) async {
    await _pump(t, ShareHangout(place: mall, clock: () => _wednesday));
    expect(_text(t, 'plan-what'), mall.nameAr);
    expect(_text(t, 'plan-when'), planPhrase(defaultWhen(mall, _wednesday), kuwaitDay(_wednesday), _wednesday));
    expect(find.byKey(const ValueKey('when-tonight-8')), findsNothing, reason: 'no chips until «غيّر»');
    expect(find.byKey(const ValueKey('hangout-send')), findsOneWidget);
  });

  testWidgets('«غيّر» opens the chips, and a chip changes the line', (t) async {
    await _pump(t, ShareHangout(place: mall, clock: () => _wednesday));
    await t.tap(find.byKey(const ValueKey('hangout-change')));
    await t.pump();
    expect(find.byKey(const ValueKey('when-weekend')), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('when-weekend')));
    await t.pump();
    expect(_text(t, 'plan-when'), startsWith('الويكند'));
  });

  testWidgets('a list for the group, without opening the chips', (t) async {
    final choices = [mall, getPlace('marina-mall')!, getPlace('al-kout-mall')!, getPlace('khiran')!];
    await _pump(
      t,
      ShareHangout(place: mall, choices: choices, clock: () => _wednesday),
    );
    await t.tap(find.byKey(const ValueKey('hangout-list-toggle')));
    await t.pump();
    final what = _text(t, 'plan-what');
    expect(what.split('، ').length, 3, reason: 'three places, named on the line');
    expect(what.contains(getPlace('khiran')!.nameAr), isFalse, reason: 'the far one is passed over (fitShortlist)');
  });

  testWidgets('the time this device sent last is the next default, when still offered', (t) async {
    SharedPreferences.setMockInitialValues({kUsualWhenKey: 'weekend'});
    await _pump(t, ShareHangout(place: mall, clock: () => _wednesday));
    expect(_text(t, 'plan-when'), startsWith('الويكند'));
  });

  testWidgets('a remembered time that is no longer offered is not used', (t) async {
    SharedPreferences.setMockInitialValues({kUsualWhenKey: 'tonight-7'});
    // 21:05 Kuwait: «٧ مساءً» has gone.
    final late = DateTime.utc(2026, 12, 16, 18, 5);
    await _pump(t, ShareHangout(place: mall, clock: () => late));
    expect(_text(t, 'plan-when'), isNot(contains('٧')));
  });

  test('a poll id is twelve lowercase letters and digits', () {
    final id = newPollId();
    expect(RegExp(r'^[a-z0-9]{12}$').hasMatch(id), isTrue, reason: id);
    expect(newPollId() == id, isFalse);
  });
}
