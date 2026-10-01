/// A link opened from outside — a «رسّلها للربع» message forwarded to someone
/// who has the app — becomes a route inside it. Only our own host and only
/// the routes that exist are accepted; anything else is ignored rather than
/// navigated to, because a link is input from whoever sent it.
library;

import 'package:go_router/go_router.dart';

const Set<String> kOwnHosts = {'www.wainkw.com', 'wainkw.com'};

/// `https://www.wainkw.com/places/kuwait-towers/?when=tonight-8` →
/// `/places/kuwait-towers?when=tonight-8`; null for anything not ours.
String? locationFromLink(Uri link) {
  if (link.scheme != 'https' || !kOwnHosts.contains(link.host)) return null;
  final path = link.path.length > 1 && link.path.endsWith('/')
      ? link.path.substring(0, link.path.length - 1)
      : link.path;
  final ok =
      RegExp(r'^/places/[a-z0-9-]+$').hasMatch(path) ||
      const {
        '/',
        '/explore',
        '/search',
        '/find',
        '/about',
        '/privacy',
        '/add',
      }.contains(path);
  if (!ok) return null;
  return link.hasQuery ? '$path?${link.query}' : path;
}

/// The three tab roots; everything else a link can name opens over them.
const Set<String> _tabRoots = {'/', '/explore', '/search'};

/// Opens a link inside the app. A tab is switched to; anything else (a place,
/// /find, the static pages) is PUSHED over the tab that is showing, so back —
/// Android's button or the iOS edge swipe — lands in the app. It used to be
/// `go`, which replaced the whole stack: a place opened from WhatsApp had
/// nothing behind it, and back closed the app.
void openLink(GoRouter router, Uri link) {
  final where = locationFromLink(link);
  if (where == null) return;
  final path = Uri.parse(where).path;
  if (_tabRoots.contains(path)) {
    router.go(where);
  } else {
    router.push(where);
  }
}
