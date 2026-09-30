// Smoke test: the home screen builds and shows the category rail — a real
// assertion over the generated catalogue rather than the counter-demo
// template this replaced, which no longer matches anything in the app.

import 'package:flutter_test/flutter_test.dart';

import 'package:wain/main.dart';
import 'package:wain/data/categories.g.dart';

void main() {
  testWidgets('home screen shows the title and every category',
      (WidgetTester tester) async {
    await tester.pumpWidget(const WainApp());
    await tester.pumpAndSettle();

    expect(find.text('وين'), findsOneWidget);
    for (final c in kCategories) {
      expect(find.text(c.ar), findsOneWidget);
    }
  });
}
