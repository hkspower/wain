import 'dart:io';

import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/data/categories.g.dart';
import 'package:wain/data/places.g.dart';
import 'package:wain/theme/art_index.g.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final files = Directory('assets/art')
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('.svg'))
      .toList();

  test(
    'there are drawings at all',
    () => expect(files.length, greaterThan(120)),
  );

  test('every exported drawing parses into a picture', () async {
    for (final f in files) {
      final src = f.readAsStringSync();
      expect(
        src,
        isNot(contains('var(--')),
        reason: '${f.path}: unresolved CSS variable',
      );
      expect(
        src,
        isNot(contains('<style')),
        reason: '${f.path}: flutter_svg does not apply <style>',
      );
      final info = await vg.loadPicture(SvgStringLoader(src), null);
      expect(info.size.width, greaterThan(0), reason: f.path);
      info.picture.dispose();
    }
  });

  test('every category resolves all four hero variants, every place its mark or its category icon', () {
    for (final c in kCategories) {
      for (var v = 0; v < 4; v++) {
        expect(
          File('assets/art/category/${c.id}-$v.svg').existsSync(),
          isTrue,
          reason: '${c.id}-$v',
        );
      }
      expect(
        File('assets/art/cat-icon/${c.icon}.svg').existsSync(),
        isTrue,
        reason: c.icon,
      );
    }
    for (final p in kPlaces) {
      if (kPlaceMarkSlugs.contains(p.slug)) {
        expect(
          File('assets/art/mark/${p.slug}.svg').existsSync(),
          isTrue,
          reason: p.slug,
        );
      }
      if (kPlaceArtSlugs.contains(p.slug)) {
        expect(
          File('assets/art/place/${p.slug}.svg').existsSync(),
          isTrue,
          reason: p.slug,
        );
      }
    }
    for (final s in kPlaceArtSlugs) {
      expect(
        kPlaces.any((p) => p.slug == s),
        isTrue,
        reason: 'art for a place that does not exist: $s',
      );
    }
  });

  test('the icons the app asks for by name exist', () {
    for (final n in [
      'search',
      'go',
      'back',
      'star',
      'pinsolid',
      'send',
      'check',
      'clock',
      'coins',
      'sun',
      'sparkle',
      'home',
      'compass',
      'car',
      'close',
      'shouq',
      'speaker',
      'speakeroff',
    ]) {
      expect(kUiIconNames, contains(n));
    }
  });
}
