/// The ownership facts, checked against the files that actually carry them.
///
/// Every one of these has a second copy somewhere a build reads — pubspec, the
/// Windows resource script, the installer, the licence — and a second copy is
/// a chance to disagree. A version on the About screen that does not match the
/// binary it shipped in, or a copyright line naming a bundle identifier
/// instead of the company, is worse than no line at all.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nokhatha/ui/about.dart';

String _read(String path) => File(path).readAsStringSync();

void main() {
  test('the About version is the version that gets built', () {
    final pubspec = _read('pubspec.yaml');
    final m = RegExp(r'^version:\s*([0-9]+\.[0-9]+\.[0-9]+)', multiLine: true)
        .firstMatch(pubspec);
    expect(m, isNotNull, reason: 'pubspec.yaml has no version:');
    expect(kAppVersion, m!.group(1),
        reason: 'about.dart prints a version pubspec does not build');
  });

  test('the owner is the company, everywhere it is named', () {
    expect(kOwner, contains('المهلب كود'));
    expect(kOwner, contains('Almuhallab Code'));
    expect(kCopyright, contains('2026'));
    expect(kCopyright, contains('المهلب كود'));
  });

  test('the channels are the real ones', () {
    expect(kPhone, '+965 6589 4110');
    expect(kMail, 'hello@almuhallab-code.com');
    expect(kSite, 'www.almuhallab-code.com');
  });

  test('the Windows binary names the company, not a bundle identifier', () {
    final rc = _read('windows/runner/Runner.rc');
    expect(rc, contains('VALUE "CompanyName", "Almuhallab Code"'));
    expect(rc, contains('Copyright © 2026 Almuhallab Code'));
    // it said "com.almuhallab" — an identifier, which names nobody to the
    // person reading the file's properties or a SmartScreen prompt
    expect(rc.contains('"CompanyName", "com.almuhallab"'), isFalse);
  });

  test('the installer carries publisher, copyright and version info', () {
    final iss = _read('windows/installer/nokhatha.iss');
    for (final key in [
      'AppPublisher=',
      'AppCopyright=',
      'VersionInfoCompany=',
      'VersionInfoCopyright=',
      'VersionInfoProductName=',
    ]) {
      expect(iss, contains(key), reason: '$key is missing from the installer');
    }
    expect(iss, contains('Almuhallab Code'));
  });

  test('the macOS build is stamped with the same owner', () {
    final setup = _read('tool/macos_setup.sh');
    expect(setup, contains('PRODUCT_COPYRIGHT'));
    expect(setup, contains('Almuhallab Code'));
    expect(setup, contains('com.almuhallab.nokhatha'));
  });

  test('a licence exists at the root and names the owner', () {
    final licence = _read('../LICENSE');
    expect(licence, contains('Almuhallab Code'));
    expect(licence, contains('جميع الحقوق محفوظة'));
    // the OFL text must travel with the font files it covers
    expect(licence, contains('LICENSE-Cairo.txt'));
    expect(File('../almuhallab/fonts/LICENSE-Cairo.txt').existsSync(), isTrue);
  });
}
