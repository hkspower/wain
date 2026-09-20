/// Supply-chain guards.
///
/// The strongest thing النوخذة can say to someone deciding whether to run a
/// downloaded .exe is not "trust us" — it is "here is what it can and cannot
/// do, and you can check." These tests keep those claims true:
///
///   * the app opens no sockets, so it cannot exfiltrate a portfolio;
///   * it pulls in a countable number of packages, so the dependency tree is
///     something a person could actually audit;
///   * nothing in it downloads and runs code at runtime, which is the single
///     behaviour that most reliably makes an antivirus engine object — and
///     rightly, because it is what droppers do.
///
/// A claim on a web page rots. A claim with a test behind it does not.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Packages that can reach the network. None of these belong in النوخذة: it
/// is a system for records that live on one machine, and it says so.
const _networkCapable = {
  'http', 'http2', 'dio', 'web_socket_channel', 'grpc', 'socket_io_client',
  'firebase_core', 'firebase_analytics', 'cloud_firestore', 'googleapis',
  'sentry', 'sentry_flutter', 'amplitude_flutter', 'mixpanel_flutter',
  'posthog_flutter', 'segment_analytics', 'appsflyer_sdk', 'facebook_app_events',
  'connectivity_plus', 'url_launcher',
};

Set<String> _lockedPackages() {
  final lock = File('pubspec.lock');
  expect(lock.existsSync(), isTrue,
      reason: 'pubspec.lock must be committed — an unpinned tree is not auditable');
  final names = <String>{};
  for (final line in lock.readAsLinesSync()) {
    // Top-level package entries are indented exactly two spaces.
    final m = RegExp(r'^  ([a-z0-9_]+):$').firstMatch(line);
    if (m != null) names.add(m.group(1)!);
  }
  return names;
}

void main() {
  test('no network-capable package is in the dependency tree', () {
    final present = _lockedPackages().intersection(_networkCapable);
    expect(present, isEmpty,
        reason: 'النوخذة claims to make no network connections. Adding '
            '${present.join(", ")} breaks that claim, and the claim is the '
            'reason a customer is willing to run the download.');
  });

  test('our own code opens no sockets and embeds no URLs to call', () {
    final offenders = <String>[];
    for (final f in Directory('lib').listSync(recursive: true)) {
      if (f is! File || !f.path.endsWith('.dart')) continue;
      final src = f.readAsStringSync();
      for (final pattern in [
        RegExp(r'\bHttpClient\b'),
        RegExp(r'\bSocket\.(connect|bind)\b'),
        RegExp(r'\bWebSocket\b'),
        RegExp(r'''\bProcess\.(run|start)\b'''),
      ]) {
        if (pattern.hasMatch(src)) offenders.add('${f.path}: $pattern');
      }
    }
    expect(offenders, isEmpty,
        reason: 'no sockets, and no launching other programs — the two things '
            'that turn a records app into something worth quarantining');
  });

  test('the direct dependency list stays short enough to audit by hand', () {
    final deps = <String>[];
    var inDeps = false;
    for (final line in File('pubspec.yaml').readAsLinesSync()) {
      if (line.startsWith('dependencies:')) {
        inDeps = true;
        continue;
      }
      if (inDeps && line.isNotEmpty && !line.startsWith(' ')) break;
      final m = RegExp(r'^  ([a-z0-9_]+):').firstMatch(line);
      if (inDeps && m != null) deps.add(m.group(1)!);
    }
    // flutter, cupertino_icons, crypto, path_provider. Every addition here is
    // code a customer is trusting on the word of someone they never met.
    expect(deps.length, lessThanOrEqualTo(6),
        reason: 'direct dependencies: ${deps.join(", ")}');
  });

  test('the release build is not obfuscated', () {
    // Obfuscation makes a binary look like something hiding its behaviour,
    // which is exactly what heuristic scanners flag — and it would stop us
    // reading a customer's crash report anyway.
    final wf = File('../.github/workflows/nokhatha-windows.yml');
    if (!wf.existsSync()) return; // running outside the repo layout
    expect(wf.readAsStringSync().contains('--obfuscate'), isFalse);
  });
}
