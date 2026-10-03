// The five «معالم الكويت» places carry their generated picture on their card —
// in the 56 band the icon sits in (card A) — and at the top of their page,
// whole at 3:2 and no wider than 576, tagged «صورة توضيحية» (T1): the owner's
// picks on the 3 October canvas, mirrored from the web. Only once a picture
// may be shown: a drawn stand-in waits behind the gate's switch
// (landmark_gate.dart), and every other place keeps its icon and its drawing.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/data/landmark_gate.dart';
import 'package:wain/data/landmarks.g.dart';
import 'package:wain/data/places.g.dart';
import 'package:wain/data/text_kit.dart';
import 'package:wain/map/wain_map.dart';
import 'package:wain/theme/app_theme.dart';
import 'package:wain/theme/colors.dart';
import 'package:wain/widgets/art.dart';
import 'package:wain/widgets/illustrative_tag.dart';
import 'package:wain/widgets/landmark_picture.dart';
import 'package:wain/widgets/place_card.dart';

import 'app_smoke_test.dart' show pumpAt;

const _slots = [
  'kuwait-towers',
  'liberation-tower',
  'seif-palace',
  'al-hamra-tower',
  'sheikh-jaber-causeway',
];

/// The gate's switch, set for one test.
void _standIns(bool on) {
  final was = debugShowStandIns;
  debugShowStandIns = on;
  addTearDown(() => debugShowStandIns = was);
}

void _textScale(WidgetTester t, double s) {
  t.platformDispatcher.textScaleFactorTestValue = s;
  addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
}

Finder _card(String slug) =>
    find.byWidgetPredicate((w) => w is PlaceCard && w.place.slug == slug);

Finder _picture(String slug) => find.byWidgetPredicate(
  (w) =>
      w is Image &&
      w.image is AssetImage &&
      (w.image as AssetImage).assetName == kLandmarkPictures[slug]!.asset,
);

/// A card's band: the 3:1 strip, the web's card file.
Finder _strip(String slug) => find.byWidgetPredicate(
  (w) =>
      w is Image &&
      w.image is AssetImage &&
      (w.image as AssetImage).assetName == kLandmarkPictures[slug]!.cardAsset,
);

Finder _in(Finder of, Finder matching) =>
    find.descendant(of: of, matching: matching);

Future<void> _reveal(WidgetTester t, Finder f) async {
  await t.scrollUntilVisible(f, 150, scrollable: find.byType(Scrollable).first);
  await t.pump();
}

double _gutter(Size size) => size.width >= 640 ? 16 : 10;

/// The rating chip inside [scope]: its label merges into the card's own node,
/// so it is found by its number and measured by the box around it.
Rect _chip(WidgetTester t, Finder scope, double rating) => t.getRect(
  find
      .ancestor(
        of: _in(scope, find.text(toArabicNumber(rating))).first,
        matching: find.byType(Container),
      )
      .first,
);

void main() {
  setUp(() => debugTileUrl = '');
  tearDown(() => debugTileUrl = null);

  // The app's own font, not the test font, whose every glyph is a square as
  // wide as it is tall: «رسم مؤقت» measured twice its width in it, and every
  // overlap asked about here is a question about what a phone draws.
  setUpAll(() async {
    final loader = FontLoader(kFontFamily);
    for (final w in const ['Regular', 'SemiBold', 'Bold']) {
      loader.addFont(rootBundle.load('assets/fonts/IBMPlexSansArabic-$w.ttf'));
    }
    await loader.load();
  });

  group('the gate', () {
    test('only the five carry a picture, and every other place none', () {
      _standIns(true);
      expect(kLandmarkPlaceSlots, _slots.toSet());
      for (final p in kPlaces) {
        expect(
          placePictureOf(p.slug),
          _slots.contains(p.slug) ? kLandmarkPictures[p.slug] : isNull,
          reason: p.slug,
        );
      }
      // Has a picture (it is in the slideshow) and is not one of the five.
      expect(kLandmarkPictures['grand-mosque'], isNotNull);
      expect(placePictureOf('grand-mosque'), isNull);
    });

    test('the five have a card strip, the web\'s card file; the rest none', () {
      for (final MapEntry(key: slug, value: p) in kLandmarkPictures.entries) {
        expect(
          p.cardAsset,
          _slots.contains(slug)
              ? 'assets/img/landmarks/$slug-card.webp'
              : isNull,
          reason: slug,
        );
      }
    });

    test('switched off, a stand-in is not shown and a real picture is', () {
      _standIns(false);
      for (final s in _slots) {
        final p = kLandmarkPictures[s]!;
        expect(shownPicture(p), !p.standIn, reason: s);
        expect(placePictureOf(s), p.standIn ? isNull : p, reason: s);
      }
    });
  });

  testWidgets('switched off: the five cards keep their icon, until their '
      'picture is real', (t) async {
    _standIns(false);
    await pumpAt(t, '/explore?category=landmarks');
    for (final s in _slots) {
      final card = _card(s);
      await _reveal(t, card);
      final standIn = kLandmarkPictures[s]!.standIn;
      expect(
        _in(card, find.byType(PlaceMark)),
        standIn ? findsOneWidget : findsNothing,
        reason: s,
      );
      expect(_in(card, _strip(s)), standIn ? findsNothing : findsOneWidget);
      expect(
        _in(card, find.byType(IllustrativeTag)),
        standIn ? findsNothing : findsOneWidget,
      );
    }
    expect(t.takeException(), isNull);
  });

  for (final scale in const [1.0, 1.3]) {
    for (final size in const [
      Size(320, 568),
      Size(390, 844),
      Size(800, 1280),
    ]) {
      testWidgets(
        'switched on, ${size.width.toInt()}px, text ×$scale: the five cards '
        'carry their picture in the same 56 band, tagged, at the same height',
        (t) async {
          _standIns(true);
          _textScale(t, scale);
          await pumpAt(t, '/explore?category=landmarks', size: size);
          for (final s in _slots) {
            final card = _card(s);
            await _reveal(t, card);
            final rect = t.getRect(card);
            expect(
              rect.height,
              closeTo(placeCardExtent(t.element(card)), 0.01),
              reason: '$s: every card keeps its height',
            );
            expect(_in(card, find.byType(PlaceMark)), findsNothing);

            final bandFinder = _in(
              card,
              find.byKey(const ValueKey('card-band-picture')),
            );
            final band = t.getRect(bandFinder);
            expect(band.height, closeTo(56, 0.01), reason: '$s: the 56 band');
            expect(band.top, closeTo(rect.top + 1, 0.5), reason: 'at the top');

            // The strip was cut around the landmark when it was made, and is
            // shown the way the web shows it: covering the band, centred.
            final image = _in(bandFinder, _strip(s));
            expect(image, findsOneWidget, reason: s);
            final w = t.widget<Image>(image);
            expect(w.fit, BoxFit.cover);
            expect(w.alignment, Alignment.center, reason: s);
            expect(t.getRect(image), band);

            // «صورة توضيحية» at the band's bottom-end corner — the left, in
            // a right-to-left card. On a shareable card (Explore, the home
            // picks — 3 October) the share button holds the bottom-end, so
            // the tag takes the bottom-start; the preview flag keeps the
            // top-end either way (the bottom row cannot hold it beside the
            // tag on a 320 phone at large text).
            final shareable = t
                .widget<PlaceCard>(
                  find.descendant(
                    of: card,
                    matching: find.byType(PlaceCard),
                    matchRoot: true,
                  ),
                )
                .shareable;
            final tag = t.getRect(_in(card, find.byType(IllustrativeTag)));
            if (shareable) {
              expect(tag.right, closeTo(band.right - 6, 0.5), reason: s);
            } else {
              expect(tag.left, closeTo(band.left + 6, 0.5), reason: s);
            }
            expect(tag.bottom, closeTo(band.bottom - 6, 0.5), reason: s);

            // A stand-in says so, in the top-end corner.
            final flag = t.getRect(_in(card, find.byType(StandInFlag)));
            expect(flag.left, closeTo(band.left, 0.5), reason: '$s: flag');
            expect(flag.top, closeTo(band.top, 0.5), reason: '$s: flag');
            if (shareable) {
              // The button's 48 target reaches up into the flag's corner by
              // design (an invisible margin); its 32 disc must touch neither
              // the flag above it nor the tag beside it.
              final share = _in(card, find.byKey(const ValueKey('card-share')));
              final disc = t.getRect(
                find.descendant(of: share, matching: find.byType(Container)).first,
              );
              expect(disc.bottom, closeTo(band.bottom - 2, 0.5), reason: s);
              expect(disc.overlaps(flag), isFalse, reason: '$s: disc, flag');
              expect(disc.overlaps(tag), isFalse, reason: '$s: disc, tag');
            }
            expect(flag.overlaps(tag), isFalse, reason: '$s: flag, tag');

            // The rating chip stays where it was: the band's top-start. The
            // band stays 56 while the text grows, so the two badges stop
            // growing where both fit (they met at 1.3× on a 320 phone).
            final place = getPlace(s)!;
            if (place.rating != null) {
              final chip = _chip(t, card, place.rating!);
              expect(chip.right, closeTo(band.right - 6, 0.5), reason: s);
              expect(chip.top, closeTo(band.top + 6, 0.5), reason: s);
              expect(chip.overlaps(tag), isFalse, reason: '$s: chip, tag');
              expect(chip.overlaps(flag), isFalse, reason: '$s: chip, flag');
            }
          }
          expect(t.takeException(), isNull);
        },
      );
    }
  }

  // Past the sizes the page itself lays out without overflowing (2× on a
  // 320 phone overflows /explore, with or without a picture), one card on its
  // own, given all the height it wants.
  for (final scale in const [1.5, 2.0, 3.0]) {
    for (final width in const [145.0, 181.0, 256.0]) {
      testWidgets('text ×$scale, a ${width.toInt()} card: the rating and the '
          'tag still both fit in the 56 band', (t) async {
        _standIns(true);
        _textScale(t, scale);
        await t.pumpWidget(
          MaterialApp(
            home: Directionality(
              textDirection: TextDirection.rtl,
              child: Scaffold(
                body: Align(
                  alignment: Alignment.topCenter,
                  child: SizedBox(
                    width: width,
                    height: 800,
                    child: PlaceCard(place: getPlace('kuwait-towers')!),
                  ),
                ),
              ),
            ),
          ),
        );
        final band = t.getRect(find.byKey(const ValueKey('card-band-picture')));
        expect(band.height, closeTo(56, 0.01));
        final tag = t.getRect(find.byType(IllustrativeTag));
        final chip = _chip(
          t,
          find.byType(PlaceCard),
          getPlace('kuwait-towers')!.rating!,
        );
        expect(chip.overlaps(tag), isFalse, reason: 'chip $chip, tag $tag');
        expect(tag.bottom, lessThanOrEqualTo(band.bottom), reason: 'inside');
        expect(chip.top, greaterThanOrEqualTo(band.top), reason: 'inside');
        // At 2× and over, the narrowest cards overflow their area row
        // (kuwait-towers', with the icon as much as with the picture —
        // measured on 3 October). Not this test's question, and the band has
        // no flex to overflow, so that one is the only error let through.
        final e = t.takeException();
        if (e != null) expect('$e', contains('RenderFlex overflowed'));
      });
    }
  }

  testWidgets('switched on: a place outside the five keeps its icon', (
    t,
  ) async {
    _standIns(true);
    await pumpAt(t, '/explore?category=culture');
    final card = _card('grand-mosque');
    await _reveal(t, card);
    expect(_in(card, find.byType(PlaceMark)), findsOneWidget);
    expect(_in(card, _picture('grand-mosque')), findsNothing);
    expect(_in(card, find.byType(IllustrativeTag)), findsNothing);
  });

  testWidgets('switched off: a landmark\'s page keeps its drawing, until its '
      'picture is real', (t) async {
    _standIns(false);
    await pumpAt(t, '/places/kuwait-towers');
    final standIn = kLandmarkPictures['kuwait-towers']!.standIn;
    expect(find.byType(PlaceHero), standIn ? findsOneWidget : findsNothing);
    expect(find.byType(PictureHero), standIn ? findsNothing : findsOneWidget);
  });

  for (final size in const [Size(320, 568), Size(390, 844), Size(800, 1280)]) {
    testWidgets('switched on, ${size.width.toInt()}px: the five pages open on '
        'their picture, whole at 3:2, no wider than 576, at the start', (
      t,
    ) async {
      _standIns(true);
      final gutter = _gutter(size);
      for (final s in _slots) {
        await t.pumpWidget(const SizedBox());
        await pumpAt(t, '/places/$s', size: size);
        expect(find.byType(PlaceHero), findsNothing, reason: s);
        final heroFinder = find.byType(PictureHero);
        expect(heroFinder, findsOneWidget, reason: s);
        final hero = t.getRect(heroFinder);
        expect(hero.height, closeTo(hero.width * 2 / 3, 0.5), reason: s);
        expect(hero.width, lessThanOrEqualTo(576), reason: s);
        final room = size.width - 2 * gutter;
        expect(hero.width, closeTo(room < 576 ? room : 576, 0.5), reason: s);
        expect(
          hero.right,
          closeTo(size.width - gutter, 0.5),
          reason: '$s: at the start edge, the right',
        );

        final pic = kLandmarkPictures[s]!;
        final image = _in(heroFinder, _picture(s));
        expect(image, findsOneWidget, reason: s);
        expect(t.widget<Image>(image).fit, BoxFit.cover);
        expect(t.getRect(image), hero, reason: '$s: shown whole');
        expect(
          find.bySemanticsLabel(
            pic.standIn ? pic.alt : '${IllustrativeTag.text}: ${pic.alt}',
          ),
          findsOneWidget,
          reason: s,
        );

        final tag = t.getRect(_in(heroFinder, find.byType(IllustrativeTag)));
        expect(tag.left, closeTo(hero.left + 10, 0.5), reason: s);
        expect(tag.bottom, closeTo(hero.bottom - 10, 0.5), reason: s);

        final place = getPlace(s)!;
        if (place.rating != null) {
          // The Stack the hero sits in, where the page puts its chip.
          final top = find.ancestor(
            of: heroFinder,
            matching: find.byType(Stack),
          );
          final chip = _chip(t, top.first, place.rating!);
          expect(chip.right, closeTo(hero.right - 10, 0.5), reason: s);
          expect(chip.top, closeTo(hero.top + 10, 0.5), reason: s);
        }
        expect(t.takeException(), isNull, reason: s);
      }
    });
  }

  testWidgets('switched on: a place outside the five keeps its drawing', (
    t,
  ) async {
    _standIns(true);
    await pumpAt(t, '/places/grand-mosque');
    expect(find.byType(PictureHero), findsNothing);
    final hero = t.getRect(find.byType(PlaceHero));
    expect(hero.height, closeTo(hero.width * 5 / 18, 0.5), reason: '18:5');
  });

  group('the picture\'s words', () {
    Widget host(Widget child) => MaterialApp(
      home: Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(body: Center(child: child)),
      ),
    );

    testWidgets('a real picture is called «صورة توضيحية» in words; a '
        'stand-in only by its own alt', (t) async {
      final place = getPlace('kuwait-towers')!;
      const real = LandmarkPicture(
        'kuwait-towers',
        'assets/img/landmarks/kuwait-towers.webp',
        focusX: 0.52,
        focusY: 0.42,
        alt: 'أبراج الكويت على البحر',
        standIn: false,
      );
      await t.pumpWidget(host(PictureHero(place: place, picture: real)));
      expect(
        find.bySemanticsLabel('صورة توضيحية: أبراج الكويت على البحر'),
        findsOneWidget,
      );
      // A real picture carries the tag and no preview flag.
      expect(find.byType(IllustrativeTag), findsOneWidget);
      expect(find.byType(StandInFlag), findsNothing);

      final drawn = kLandmarkPictures['kuwait-towers']!;
      expect(drawn.standIn, isTrue);
      await t.pumpWidget(host(PictureHero(place: place, picture: drawn)));
      expect(find.bySemanticsLabel(drawn.alt), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp('^صورة توضيحية')), findsNothing);
      // And says what it is to the eye, as the web's preview does.
      expect(find.text(StandInFlag.text), findsOneWidget);
      expect(find.bySemanticsLabel(StandInFlag.text), findsNothing);
    });

    testWidgets('the tag is T1: a solid dark chip, white 11 semibold, fully '
        'rounded — seen and not read out', (t) async {
      await t.pumpWidget(host(const IllustrativeTag()));
      final tag = find.byType(IllustrativeTag);
      final box = t.widget<DecoratedBox>(
        _in(tag, find.byType(DecoratedBox)).first,
      );
      final d = box.decoration as BoxDecoration;
      expect(d.color, WainColors.ink900);
      expect(d.borderRadius, BorderRadius.circular(999));
      final pad = t.widget<Padding>(_in(tag, find.byType(Padding)).first);
      expect(
        pad.padding,
        const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      );
      final text = t.widget<Text>(find.text('صورة توضيحية'));
      expect(text.style!.color, Colors.white);
      expect(text.style!.fontSize, 11);
      expect(text.style!.fontWeight, FontWeight.w600);
      expect(find.bySemanticsLabel('صورة توضيحية'), findsNothing);
    });
  });
}
