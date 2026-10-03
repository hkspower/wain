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
import '../screens/orders_screen.dart';
import '../screens/pick_screen.dart';
import '../screens/place_detail_screen.dart';
import '../screens/privacy_screen.dart';
import '../screens/salem_screen.dart';
import '../screens/search_screen.dart';
import '../share/hangout.dart';
import '../widgets/back_fab.dart';
import 'shell.dart';

/// A screen opened ON TOP of the tabs: a place, /find, سالم, the static pages.
///
/// go_router's fallback page here was `NoTransitionPage`, which carries no
/// back gesture — and an iPhone has no back button, so a place opened from
/// search could be left only by its breadcrumb. Found by the simulator suite
/// (integration_test/app_test.dart). A `MaterialPage` is a Cupertino slide on
/// iOS, with the edge swipe (from the right, the app being right-to-left),
/// and Android's own transition and back button elsewhere.
///
/// These live on the ROOT navigator, outside the tab shell, so they cover the
/// tab bar the way a pushed screen does in a native app, and the tab they
/// were opened from is still there, scrolled where it was, when they close.
///
/// Each carries the round back button (BackFab) at the top-start corner, over
/// a 56px band the screen starts below, so at rest it covers nothing — the
/// website's BackButton, 3 October. /find and /salem draw their own: one is a
/// full-bleed photograph, the other a header with a portrait in that corner.
Page<void> _pushed(
  GoRouterState s,
  Widget child, {
  bool back = true,
  String fallback = '/',
}) => MaterialPage<void>(
  key: s.pageKey,
  child: Scaffold(
    body: SafeArea(
      child: back
          ? Stack(
              children: [
                Padding(padding: const EdgeInsets.only(top: 56), child: child),
                PositionedDirectional(
                  top: 4,
                  start: 8,
                  child: BackFab(fallback: fallback),
                ),
              ],
            )
          : child,
    ),
  ),
);

/// The three tab roots switch in place, the way a tab bar does: no slide, and
/// nothing behind them to swipe back to.
Page<void> _tab(GoRouterState s, int index, Widget child) =>
    NoTransitionPage<void>(
      key: s.pageKey,
      child: ReselectScrollsToTop(index: index, child: child),
    );

GoRouter buildRouter({String initialLocation = '/'}) {
  return GoRouter(
    initialLocation: initialLocation,
    errorBuilder: (_, _) => const NotFoundScreen(),
    routes: [
      // Each tab keeps its own navigator, so its state — the words in the
      // search box, Explore's filter, how far down a list was scrolled —
      // survives a trip to another tab. It was a plain ShellRoute switched
      // with `go`, which rebuilt the tab from nothing every time.
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/',
                pageBuilder: (_, s) => _tab(s, 0, const HomeScreen()),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/explore',
                pageBuilder: (_, s) => _tab(
                  s,
                  1,
                  ExploreScreen(
                    initialCategory: s.uri.queryParameters['category'],
                    initialQuery: s.uri.queryParameters['q'] ?? '',
                  ),
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/search',
                pageBuilder: (_, s) => _tab(
                  s,
                  2,
                  SearchScreen(initialQuery: s.uri.queryParameters['q'] ?? ''),
                ),
              ),
            ],
          ),
          // «طلباتي» — a fourth branch that is always routable (a place's
          // «تابع طلبك» pushes it), while the shell draws its tab only on a
          // device that holds an order (the site's AppTabBar does the same).
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/orders',
                pageBuilder: (_, s) => _tab(s, 3, const OrdersScreen()),
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        path: '/find',
        pageBuilder: (_, s) => _pushed(s, const FindScreen(), back: false),
      ),
      GoRoute(
        path: '/salem',
        // `?q=` is a question handed over («كمّل مع سالم», «اسأل سالم»),
        // asked once as the visitor's own message.
        pageBuilder: (_, s) => _pushed(
          s,
          SalemScreen(initialQuery: s.uri.queryParameters['q']),
          back: false,
        ),
      ),
      // «خلّهم يختارون» — a shortlist a friend sent (`?p=a,b,c&when=…`).
      GoRoute(
        path: '/pick',
        pageBuilder: (_, s) => _pushed(s, PickScreen(query: s.uri.query)),
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
        redirect: (_, s) =>
            getPlace(s.pathParameters['slug'] ?? '') == null ? '/404' : null,
        pageBuilder: (_, s) => _pushed(
          s,
          PlaceDetailScreen(
            place: getPlace(s.pathParameters['slug']!)!,
            invite: readInvite(s.uri.query),
            day: readInviteDay(s.uri.query),
            share: s.uri.queryParameters['share'] == '1',
          ),
          fallback: '/explore',
        ),
      ),
      GoRoute(path: '/404', builder: (_, _) => const NotFoundScreen()),
    ],
  );
}
