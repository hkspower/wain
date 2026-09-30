// Filters the real, generated catalogue (52 places) rather than a fixture,
// so a drift between this file and places.g.dart shows up as a wrong count
// instead of passing against data nobody ships.

import 'package:flutter_test/flutter_test.dart';
import 'package:wain/data/places.g.dart';
import 'package:wain/data/search.dart';

void main() {
  test('the generated catalogue has 52 places', () {
    expect(kPlaces.length, 52);
  });

  test('category filter narrows to only that category', () {
    final coffee = filterPlaces(kPlaces, category: 'coffee');
    expect(coffee, isNotEmpty);
    expect(coffee.every((p) => p.category == 'coffee'), isTrue);
  });

  test('free-text query matches the place by name', () {
    final results = filterPlaces(kPlaces, query: 'أبراج الكويت');
    expect(results.any((p) => p.slug == 'kuwait-towers'), isTrue);
  });

  test('a query matching nothing returns an empty list, not everything', () {
    final results = filterPlaces(kPlaces, query: 'ٱلعبارة هذي ما موجودة أبداً');
    expect(results, isEmpty);
  });

  test('category and query combine as AND, not OR', () {
    // Kuwait Towers is "landmarks", not "coffee" — asking for coffee places
    // named like it should find nothing, not fall back to the name match.
    final results = filterPlaces(kPlaces, category: 'coffee', query: 'أبراج الكويت');
    expect(results, isEmpty);
  });
}
