/// Desktop and phone are different shapes, not the same shape at two sizes.
///
/// On a phone the four units belong in a bottom bar under the thumb. On a
/// Windows window they belong in a rail down the side, because a 1200px-wide
/// bottom bar with four items in the middle is a phone layout that has been
/// stretched, and it reads as one.
library;

import 'package:flutter/material.dart';

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
  });

  final List<UnitTab> tabs;
  final int index;
  final ValueChanged<int> onSelect;
  final Widget title;
  final Widget body;

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= kRailBreakpoint;

    if (!wide) {
      return Scaffold(
        appBar: AppBar(toolbarHeight: 78, title: title),
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
      appBar: AppBar(toolbarHeight: 68, title: title),
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
