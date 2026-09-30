/// Routes, named exactly as the site names them, so a link copied from either
/// opens the same thing in the other.
library;

import 'package:go_router/go_router.dart';

import '../data/catalogue.dart';
import '../screens/about_screen.dart';
import '../screens/add_screen.dart';
import '../screens/explore_screen.dart';
import '../screens/find_screen.dart';
import '../screens/home_screen.dart';
import '../screens/not_found_screen.dart';
import '../screens/place_detail_screen.dart';
import '../screens/privacy_screen.dart';
import '../screens/salem_screen.dart';
import '../screens/search_screen.dart';
import '../share/hangout.dart';
import 'shell.dart';

GoRouter buildRouter({String initialLocation = '/'}) {
  return GoRouter(
    initialLocation: initialLocation,
    errorBuilder: (_, _) => const NotFoundScreen(),
    routes: [
      ShellRoute(
        builder: (context, state, child) =>
            AppShell(location: state.uri.path, child: child),
        routes: [
          GoRoute(path: '/', builder: (_, _) => const HomeScreen()),
          GoRoute(
            path: '/explore',
            builder: (_, s) => ExploreScreen(
              initialCategory: s.uri.queryParameters['category'],
              initialQuery: s.uri.queryParameters['q'] ?? '',
            ),
          ),
          GoRoute(
            path: '/search',
            builder: (_, s) =>
                SearchScreen(initialQuery: s.uri.queryParameters['q'] ?? ''),
          ),
          GoRoute(path: '/find', builder: (_, _) => const FindScreen()),
          GoRoute(path: '/salem', builder: (_, _) => const SalemScreen()),
          GoRoute(path: '/about', builder: (_, _) => const AboutScreen()),
          GoRoute(path: '/privacy', builder: (_, _) => const PrivacyScreen()),
          GoRoute(path: '/add', builder: (_, _) => const AddScreen()),
          GoRoute(
            path: '/places/:slug',
            // An unknown slug is the site's 404, not a blank screen.
            redirect: (_, s) => getPlace(s.pathParameters['slug'] ?? '') == null
                ? '/404'
                : null,
            builder: (_, s) => PlaceDetailScreen(
              place: getPlace(s.pathParameters['slug']!)!,
              invite: readInvite(s.uri.query),
            ),
          ),
          GoRoute(path: '/404', builder: (_, _) => const NotFoundScreen()),
        ],
      ),
    ],
  );
}
