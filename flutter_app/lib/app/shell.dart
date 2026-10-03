/// The frame around the three tabs: a bottom bar with the site's three tabs
/// (الرئيسية، استكشف، بحث). The site only shows this bar to the installed app;
/// a native app is always the installed app. Pushed screens (a place, /find,
/// سالم, the static pages) open over it, on the root navigator.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../orders/order_store.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/svg.dart';

class _Tab {
  final String label;
  final String icon;
  const _Tab(this.label, this.icon);
}

/// In branch order: router.dart's StatefulShellBranches. The fourth,
/// «طلباتي», is drawn only on a device that holds an order — see [AppShell].
const _tabs = [
  _Tab('الرئيسية', 'home'),
  _Tab('استكشف', 'compass'),
  _Tab('بحث', 'search'),
];
const _ordersTab = _Tab('طلباتي', 'bag');

/// Re-tapping the tab you are already on: back to the top, the way every
/// native tab bar answers it. The tab's page listens; the bar only announces.
class _Reselect extends ChangeNotifier {
  int index = -1;
  void announce(int i) {
    index = i;
    notifyListeners();
  }
}

final _reselect = _Reselect();

/// Wraps a tab root: when its tab is tapped again, its primary scroll view
/// (every tab root is one — no screen gives its list its own controller)
/// returns to the top.
class ReselectScrollsToTop extends StatefulWidget {
  final int index;
  final Widget child;
  const ReselectScrollsToTop({
    super.key,
    required this.index,
    required this.child,
  });

  @override
  State<ReselectScrollsToTop> createState() => _ReselectScrollsToTopState();
}

class _ReselectScrollsToTopState extends State<ReselectScrollsToTop> {
  @override
  void initState() {
    super.initState();
    _reselect.addListener(_onReselect);
  }

  @override
  void dispose() {
    _reselect.removeListener(_onReselect);
    super.dispose();
  }

  void _onReselect() {
    if (_reselect.index != widget.index) return;
    final c = PrimaryScrollController.maybeOf(context);
    if (c == null || !c.hasClients) return;
    final reduce = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (reduce) {
      c.jumpTo(0);
    } else {
      c.animateTo(
        0,
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeOutCubic,
      );
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

class AppShell extends StatelessWidget {
  final StatefulNavigationShell shell;
  const AppShell({super.key, required this.shell});

  void _tap(int i) {
    HapticFeedback.selectionClick();
    if (i == shell.currentIndex) {
      // Only the scroll moves. Going to the branch's initial location would
      // also drop `?q=`, and SearchScreen reads a changed query as a new
      // search — re-tapping «بحث» would wipe what was typed.
      _reselect.announce(i);
    } else {
      shell.goBranch(i);
    }
  }

  @override
  Widget build(BuildContext context) {
    final index = shell.currentIndex;
    // «طلباتي» appears only while this device holds an order, the way the
    // site's AppTabBar grows a tab for one: a permanent tab for a feature
    // most visitors never use would advertise a door onto nothing. It also
    // stays while that branch is the one on screen (a deep link, or the last
    // order just forgotten), so the bar never shows no tab at all; it goes
    // the moment the visitor leaves.
    final hasOrders = context.watch<OrderStore>().count > 0;
    final tabs = [..._tabs, if (hasOrders || index == 3) _ordersTab];
    // Android's back button on Explore or Search goes Home, the way a tabbed
    // app answers it; on Home it leaves the app as usual. Before this the
    // tabs were switched with `go`, which left nothing behind them, so back
    // on Explore closed the app.
    return PopScope(
      canPop: index == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && index != 0) shell.goBranch(0);
      },
      child: Scaffold(
        body: SafeArea(bottom: false, child: shell),
        bottomNavigationBar: DecoratedBox(
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: WainColors.line)),
          ),
          child: SafeArea(
            top: false,
            child: Row(
              children: [
                for (var i = 0; i < tabs.length; i++)
                  Expanded(
                    child: _TabButton(
                      tab: tabs[i],
                      active: i == index,
                      onTap: () => _tap(i),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _TabButton extends StatelessWidget {
  final _Tab tab;
  final bool active;
  final VoidCallback onTap;
  const _TabButton({
    required this.tab,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = active ? WainColors.coral700 : WainColors.ink500;
    return Semantics(
      button: true,
      selected: active,
      label: tab.label,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                curve: Curves.easeOut,
                padding: const EdgeInsets.symmetric(
                  horizontal: 18,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: active ? WainColors.coral100 : Colors.transparent,
                  borderRadius: BorderRadius.circular(99),
                ),
                child: WainSvg.icon(tab.icon, size: 24, color: color),
              ),
              const SizedBox(height: 2),
              Text(
                tab.label,
                style: wainText(
                  WainText.s2xs,
                  weight: FontWeight.w600,
                  color: color,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
