/// What the two desktop builds promise about the machines they run on.
///
/// These are plain file assertions rather than widget tests: they are about
/// the runners and the build config, which no widget can reach. They exist
/// because every one of them is a silent failure otherwise — a window with no
/// floor, a blurred window on a second monitor, an app that will not start on
/// an Intel Mac. None of those produces an error anyone would see in CI.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

String _read(String path) => File(path).readAsStringSync();

void main() {
  group('Windows 11', () {
    test('the window has a floor, and it is DPI-scaled', () {
      final win = _read('windows/runner/win32_window.cpp');
      expect(win, contains('WM_GETMINMAXINFO'),
          reason: 'without this a window can be dragged down to nothing');
      expect(RegExp(r'ptMinTrackSize\.x = Scale\(560').hasMatch(win), isTrue);
      expect(RegExp(r'ptMinTrackSize\.y = Scale\(480').hasMatch(win), isTrue);
      // scaled, or the floor means a different physical size on every monitor
      expect(win, contains('FlutterDesktopGetDpiForMonitor'));
    });

    test('it declares Windows 10 and 11, and per-monitor DPI', () {
      final manifest = _read('windows/runner/runner.exe.manifest');
      // one GUID covers Windows 10 and 11; dropping it makes Windows apply
      // compatibility shims meant for far older applications
      expect(manifest, contains('{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}'));
      // PerMonitorV2 is what stops the window rendering blurred when it is
      // dragged from a laptop screen to an external monitor — the most
      // visible defect a Windows desktop app can ship with
      expect(manifest, contains('PerMonitorV2'));
    });

    test('the installer targets the Windows versions Flutter supports', () {
      final iss = _read('windows/installer/nokhatha.iss');
      // Flutter's Windows embedder does not support anything older than 1809
      expect(iss, contains('MinVersion=10.0.17763'));
      expect(iss, contains('ArchitecturesAllowed=x64compatible'),
          reason: 'x64compatible lets Windows on ARM install it under emulation');
    });

    test('the window opens at a size a statement fits in', () {
      // `Win32Window::Size size(1180, 800)` — match the numbers, not the
      // scaffold's spelling of the type
      expect(_read('windows/runner/main.cpp'), contains('1180, 800'));
    });
  });

  group('macOS', () {
    test('the window has the same floor as the Windows build', () {
      final mac = _read('tool/macos_setup.sh');
      expect(mac, contains('contentMinSize'));
      expect(mac, contains('width: 560, height: 480'),
          reason: 'the two platforms disagree about the minimum window');
      expect(mac, contains('NSSize(width: 1180, height: 800)'),
          reason: 'and about the opening size');
    });

    test('the sandbox is on and grants no network', () {
      final mac = _read('tool/macos_setup.sh');
      expect(mac, contains('com.apple.security.app-sandbox'));
      expect(mac, contains('com.apple.security.network.client'),
          reason: 'the script must still be checking for the network '
              'entitlement in order to reject it');
    });

    test('the build is checked for both Apple Silicon and Intel', () {
      final wf = _read('../.github/workflows/nokhatha-windows.yml');
      expect(wf, contains('lipo -archs'),
          reason: 'nothing verifies which Macs the .app actually runs on');
      expect(wf, contains('arm64'));
      expect(wf, contains('x86_64'));
    });

    test('the identity is the product, not the scaffold', () {
      final mac = _read('tool/macos_setup.sh');
      expect(mac, contains('PRODUCT_BUNDLE_IDENTIFIER = com.almuhallab.nokhatha'));
      expect(mac, contains('PRODUCT_NAME = النوخذة'));
    });
  });

  group('both', () {
    test('the release is built from the locked dependency versions', () {
      final wf = _read('../.github/workflows/nokhatha-windows.yml');
      expect('--enforce-lockfile'.allMatches(wf).length, greaterThanOrEqualTo(2),
          reason: 'a build that resolves newer packages is not reproducible');
    });

    test('every release carries a checksum and a provenance attestation', () {
      final wf = _read('../.github/workflows/nokhatha-windows.yml');
      expect(wf, contains('attest-build-provenance'));
      expect(wf.toLowerCase(), contains('sha256'));
    });
  });
}
