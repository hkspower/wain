/// A link opened from outside — a «رسّلها للربع» message forwarded to someone
/// who has the app — becomes a route inside it. Only our own host and only
/// the routes that exist are accepted; anything else is ignored rather than
/// navigated to, because a link is input from whoever sent it.
library;

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
