/// Routes, named exactly as the site names them, so a link copied from either
/// opens the same thing in the other.
library;

import 'package:flutter/material.dart';
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

/// A screen opened ON TOP of another: a place, /find, سالم, the static pages.
///
/// go_router's fallback page here was `NoTransitionPage`, which carries no
/// back gesture — and an iPhone has no back button, so a place opened from
/// search could be left only by its breadcrumb. Found by the simulator suite
/// (integration_test/app_test.dart). A `MaterialPage` is a Cupertino slide on
/// iOS, with the edge swipe (from the right, the app being right-to-left),
/// and Android's own transition and back button elsewhere.
Page<void> _pushed(GoRouterState s, Widget child) =>
    MaterialPage<void>(key: s.pageKey, child: child);

/// The three tab roots switch in place, the way a tab bar does: no slide, and
/// nothing behind them to swipe back to.
Page<void> _tab(GoRouterState s, Widget child) =>
    NoTransitionPage<void>(key: s.pageKey, child: child);

GoRouter buildRouter({String initialLocation = '/'}) {
  return GoRouter(
    initialLocation: initialLocation,
    errorBuilder: (_, _) => const NotFoundScreen(),
    routes: [
      ShellRoute(
        builder: (context, state, child) =>
            AppShell(location: state.uri.path, child: child),
        routes: [
          GoRoute(
            path: '/',
            pageBuilder: (_, s) => _tab(s, const HomeScreen()),
          ),
          GoRoute(
            path: '/explore',
            pageBuilder: (_, s) => _tab(
              s,
              ExploreScreen(
                initialCategory: s.uri.queryParameters['category'],
                initialQuery: s.uri.queryParameters['q'] ?? '',
              ),
            ),
          ),
          GoRoute(
            path: '/search',
            pageBuilder: (_, s) => _tab(
              s,
              SearchScreen(initialQuery: s.uri.queryParameters['q'] ?? ''),
            ),
          ),
          GoRoute(
            path: '/find',
            pageBuilder: (_, s) => _pushed(s, const FindScreen()),
          ),
          GoRoute(
            path: '/salem',
            pageBuilder: (_, s) => _pushed(s, const SalemScreen()),
          ),
          GoRoute(
            path: '/about',
            pageBuilder: (_, s) => _pushed(s, const AboutScreen()),
          ),
          GoRoute(
            path: '/privacy',
            pageBuilder: (_, s) => _pushed(s, const PrivacyScreen()),
          ),
          GoRoute(
            path: '/add',
            pageBuilder: (_, s) => _pushed(s, const AddScreen()),
          ),
          GoRoute(
            path: '/places/:slug',
            // An unknown slug is the site's 404, not a blank screen.
            redirect: (_, s) => getPlace(s.pathParameters['slug'] ?? '') == null
                ? '/404'
                : null,
            pageBuilder: (_, s) => _pushed(
              s,
              PlaceDetailScreen(
                place: getPlace(s.pathParameters['slug']!)!,
                invite: readInvite(s.uri.query),
              ),
            ),
          ),
          GoRoute(path: '/404', builder: (_, _) => const NotFoundScreen()),
        ],
      ),
    ],
  );
}
