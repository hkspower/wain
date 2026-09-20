/// Desktop and phone are different shapes, not the same shape at two sizes.
///
/// On a phone the four units belong in a bottom bar under the thumb. On a
/// Windows window they belong in a rail down the side, because a 1200px-wide
/// bottom bar with four items in the middle is a phone layout that has been
/// stretched, and it reads as one.
library;

import 'package:flutter/material.dart';

import 'about.dart';
import 'brand.dart';

/// Below this width the bottom bar wins; at or above it, the rail does.
/// Chosen at the point where a stretched bottom bar starts to look adrift.
const double kRailBreakpoint = 720;

class UnitTab {
  const UnitTab(this.icon, this.label);
  final IconData icon;
  final String label;
}

class AdaptiveShell extends StatelessWidget {
  const AdaptiveShell({
    super.key,
    required this.tabs,
    required this.index,
    required this.onSelect,
    required this.title,
    required this.body,
    this.action,
    this.onSignOut,
  });

  final List<UnitTab> tabs;
  final int index;
  final ValueChanged<int> onSelect;
  final Widget title;
  final Widget body;
  final Widget? action;
  final Future<void> Function()? onSignOut;

  Widget _signOut() => Builder(
        builder: (context) => IconButton(
          tooltip: 'تسجيل الخروج',
          icon: const Icon(Icons.logout),
          onPressed: onSignOut == null ? null : () => onSignOut!(),
        ),
      );

  /// Who made this. On a downloaded binary that is not a footnote: the
  /// installer and the file properties say it, but neither is reachable once
  /// the window is open — and a macOS build has no installer at all.
  Widget _about() => Builder(
        builder: (context) => IconButton(
          tooltip: 'عن النوخذة',
          icon: const Icon(Icons.info_outline),
          onPressed: () => showAboutNokhatha(context),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= kRailBreakpoint;

    if (!wide) {
      return Scaffold(
        appBar: AppBar(
            toolbarHeight: 78, title: title, actions: [_about(), _signOut()]),
        floatingActionButton: action,
        body: body,
        bottomNavigationBar: NavigationBar(
          selectedIndex: index,
          onDestinationSelected: onSelect,
          backgroundColor: Brand.bg,
          indicatorColor: Brand.panel2,
          destinations: [
            for (final t in tabs)
              NavigationDestination(icon: Icon(t.icon), label: t.label),
          ],
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
          toolbarHeight: 68, title: title, actions: [_about(), _signOut()]),
      floatingActionButton: action,
      body: Row(
        children: [
          NavigationRail(
            selectedIndex: index,
            onDestinationSelected: onSelect,
            backgroundColor: Brand.panel2,
            labelType: NavigationRailLabelType.all,
            indicatorColor: Brand.bg,
            destinations: [
              for (final t in tabs)
                NavigationRailDestination(
                  icon: Icon(t.icon),
                  label: Text(t.label),
                ),
            ],
          ),
          const VerticalDivider(width: 1, color: Brand.border),
          // A statement is unreadable at 1600px of line length, so the content
          // keeps a measure and centres in whatever window it is given.
          Expanded(
            child: Align(
              alignment: Alignment.topCenter,
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1060),
                child: body,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
