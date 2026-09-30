/// The site's drawings as widgets: a place's hero scene, its mark on a tinted
/// tile, and the category fallbacks. Which drawings exist is generated
/// (`art_index.g.dart`), so a place with no bespoke art falls through to its
/// category's instead of failing to load.
library;

import 'package:flutter/material.dart';

import '../data/categories.g.dart';
import '../data/models.dart';
import '../data/text_kit.dart';
import '../theme/art_index.g.dart';
import '../theme/colors.dart';
import 'svg.dart';

/// `placeGradient`: a direction chosen by the slug's variant over the
/// category's three-stop hero ground.
({AlignmentGeometry begin, AlignmentGeometry end}) _direction(int variant) =>
    switch (variant) {
      0 => (begin: Alignment.topLeft, end: Alignment.bottomRight),
      1 => (begin: Alignment.bottomLeft, end: Alignment.topRight),
      2 => (begin: Alignment.topCenter, end: Alignment.bottomCenter),
      _ => (begin: Alignment.topRight, end: Alignment.bottomLeft),
    };

LinearGradient placeGradient(Place p) {
  final d = _direction(placeVariant(p.slug));
  return LinearGradient(
    begin: d.begin,
    end: d.end,
    colors: heroGround(p.category),
  );
}

/// A place's hero: gradient ground with its scene drawn over it in white. The
/// drawing is 400×160 and cropped with "slice", so the band's aspect ratio is
/// what decides how much of it shows — the site uses 18:5, and so does this.
class PlaceHero extends StatelessWidget {
  final Place place;
  final BorderRadius radius;

  const PlaceHero({
    super.key,
    required this.place,
    this.radius = const BorderRadius.all(Radius.circular(WainRadius.s2xl)),
  });

  @override
  Widget build(BuildContext context) {
    final own = kPlaceArtSlugs.contains(place.slug);
    final asset = own
        ? 'assets/art/place/${place.slug}.svg'
        : 'assets/art/category/${place.category}-${placeVariant(place.slug)}.svg';
    final art = WainSvg(
      asset,
      fit: BoxFit.cover,
      width: double.infinity,
      height: double.infinity,
    );
    return AspectRatio(
      aspectRatio: 18 / 5,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: placeGradient(place),
          borderRadius: radius,
          boxShadow: WainShadows.lg,
        ),
        child: ClipRRect(borderRadius: radius, child: art),
      ),
    );
  }
}

/// The mark on a category-tinted tile: the place's own 48-grid drawing when it
/// has one, else its category's icon. A thumbnail carries its category before
/// the name has been read.
class PlaceMark extends StatelessWidget {
  final Place place;
  final double tile;
  final double mark;

  /// Fill the available width (a card's band) instead of being a square tile.
  final bool stretch;

  const PlaceMark({
    super.key,
    required this.place,
    this.tile = 56,
    this.mark = 32,
    this.stretch = false,
  });

  @override
  Widget build(BuildContext context) {
    final ink = catInk(place.category);
    final own = kPlaceMarkSlugs.contains(place.slug);
    final icon = kCategories.firstWhere((c) => c.id == place.category).icon;
    return Container(
      width: stretch ? double.infinity : tile,
      height: tile,
      alignment: Alignment.center,
      color: catTint(place.category),
      child: WainSvg(
        own
            ? 'assets/art/mark/${place.slug}.svg'
            : 'assets/art/cat-icon/$icon.svg',
        size: mark,
        color: ink,
      ),
    );
  }
}
