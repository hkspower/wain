/// Brand colours live in `tokens.g.dart`, generated from
/// `src/app/theme.css` (`npm run flutter:tokens`). This file only holds what
/// the stylesheet does not express as a token: which ramp stops paint each
/// category's gradient, matching `categoryGradient()` in `place-kit.ts`
/// (the first and last stop of each Tailwind gradient).
library;

import 'package:flutter/painting.dart';

import 'tokens.g.dart';

export 'tokens.g.dart';

const Map<String, List<Color>> categoryGradients = {
  'landmarks': [WainColors.sea500, WainColors.sea800],
  'restaurants': [WainColors.coral500, WainColors.coral700],
  'fastfood': [WainColors.sun600, WainColors.sun700],
  'coffee': [WainColors.sand600, WainColors.sand700],
  'outdoors': [WainColors.palm500, WainColors.sea700],
  'shopping': [WainColors.sun600, WainColors.coral700],
  'culture': [WainColors.sea600, WainColors.ink800],
  'family': [WainColors.palm500, WainColors.palm600],
};

/// The tile/ink pair for a category (`--color-cat-<id>-tint/-ink`), and its
/// three-stop hero ground (`--color-hero-<id>-1/2/3`). Looked up by id so a
/// new category fails loudly in the test rather than painting grey.
Color catTint(String id) => _cat[id]!.$1;
Color catInk(String id) => _cat[id]!.$2;
List<Color> heroGround(String id) => _hero[id]!;

const Map<String, (Color, Color)> _cat = {
  'landmarks': (WainColors.catLandmarksTint, WainColors.catLandmarksInk),
  'restaurants': (WainColors.catRestaurantsTint, WainColors.catRestaurantsInk),
  'fastfood': (WainColors.catFastfoodTint, WainColors.catFastfoodInk),
  'coffee': (WainColors.catCoffeeTint, WainColors.catCoffeeInk),
  'outdoors': (WainColors.catOutdoorsTint, WainColors.catOutdoorsInk),
  'shopping': (WainColors.catShoppingTint, WainColors.catShoppingInk),
  'culture': (WainColors.catCultureTint, WainColors.catCultureInk),
  'family': (WainColors.catFamilyTint, WainColors.catFamilyInk),
};

const Map<String, List<Color>> _hero = {
  'landmarks': [
    WainColors.heroLandmarks1,
    WainColors.heroLandmarks2,
    WainColors.heroLandmarks3,
  ],
  'restaurants': [
    WainColors.heroRestaurants1,
    WainColors.heroRestaurants2,
    WainColors.heroRestaurants3,
  ],
  'fastfood': [
    WainColors.heroFastfood1,
    WainColors.heroFastfood2,
    WainColors.heroFastfood3,
  ],
  'coffee': [
    WainColors.heroCoffee1,
    WainColors.heroCoffee2,
    WainColors.heroCoffee3,
  ],
  'outdoors': [
    WainColors.heroOutdoors1,
    WainColors.heroOutdoors2,
    WainColors.heroOutdoors3,
  ],
  'shopping': [
    WainColors.heroShopping1,
    WainColors.heroShopping2,
    WainColors.heroShopping3,
  ],
  'culture': [
    WainColors.heroCulture1,
    WainColors.heroCulture2,
    WainColors.heroCulture3,
  ],
  'family': [
    WainColors.heroFamily1,
    WainColors.heroFamily2,
    WainColors.heroFamily3,
  ],
};
