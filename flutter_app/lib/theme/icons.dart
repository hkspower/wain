/// Maps the catalogue's icon keys (`Category.icon`, e.g. "tower", "cutlery")
/// to Material icons. The keys themselves come from the generated
/// `categories.g.dart` — this file only says how the native app draws them.
library;

import 'package:flutter/material.dart';

IconData categoryIconData(String key) {
  switch (key) {
    case 'tower':
      return Icons.location_city;
    case 'cutlery':
      return Icons.restaurant;
    case 'burger':
      return Icons.lunch_dining;
    case 'coffee':
      return Icons.coffee;
    case 'palm':
      return Icons.park;
    case 'bag':
      return Icons.shopping_bag;
    case 'masks':
      return Icons.theater_comedy;
    case 'ferris':
      return Icons.attractions;
    default:
      return Icons.place;
  }
}
