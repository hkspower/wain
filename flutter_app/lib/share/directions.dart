/// «الطريق»: hand the place to the phone's own maps app for directions.
/// Apple Maps on iOS (it is always there), the system's `geo:` handler on
/// Android (Google Maps, or whatever the visitor chose), and Google Maps in a
/// browser when neither opens. The app never reads the visitor's position:
/// the maps app does that, under its own permission.
library;

import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/models.dart';

/// The links tried in order. Pure, so a test can read them.
List<Uri> directionsLinks(Place p, TargetPlatform platform) {
  final at = '${p.lat},${p.lng}';
  final web = Uri.parse(
    'https://www.google.com/maps/dir/?api=1&destination=$at',
  );
  return switch (platform) {
    TargetPlatform.iOS => [
      Uri.https('maps.apple.com', '/', {'daddr': at, 'q': p.nameAr}),
      web,
    ],
    TargetPlatform.android => [
      Uri.parse('geo:$at?q=$at(${Uri.encodeComponent(p.nameAr)})'),
      web,
    ],
    _ => [web],
  };
}

Future<bool> openDirections(Place p) async {
  for (final uri in directionsLinks(p, defaultTargetPlatform)) {
    try {
      if (await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        return true;
      }
    } catch (_) {
      /* no handler for this one: try the next */
    }
  }
  return false;
}
