/// The frame around every screen: a bottom bar with the site's three tabs
/// (الرئيسية، استكشف، بحث), and the same safe-area handling on every route.
/// The site only shows this bar to the installed app; a native app is always
/// the installed app.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/svg.dart';

class _Tab {
  final String path;
  final String label;
  final String icon;
  final bool exact;
  const _Tab(this.path, this.label, this.icon, {this.exact = false});
}

const _tabs = [
  _Tab('/', 'الرئيسية', 'home', exact: true),
  _Tab('/explore', 'استكشف', 'compass'),
  _Tab('/search', 'بحث', 'search'),
];

class AppShell extends StatelessWidget {
  final String location;
  final Widget child;
  const AppShell({super.key, required this.location, required this.child});

  bool _active(_Tab t) =>
      t.exact ? location == t.path : location.startsWith(t.path);

  @override
  Widget build(BuildContext context) {
    // /find and /salem are full-bleed and carry their own way back.
    final showBar =
        !location.startsWith('/find') && !location.startsWith('/salem');
    return Scaffold(
      body: SafeArea(bottom: !showBar, child: child),
      bottomNavigationBar: showBar
          ? DecoratedBox(
              decoration: const BoxDecoration(
                color: Colors.white,
                border: Border(top: BorderSide(color: WainColors.line)),
              ),
              child: SafeArea(
                top: false,
                child: Row(
                  children: [
                    for (final t in _tabs)
                      Expanded(
                        child: _TabButton(
                          tab: t,
                          active: _active(t),
                          onTap: () {
                            HapticFeedback.selectionClick();
                            context.go(t.path);
                          },
                        ),
                      ),
                  ],
                ),
              ),
            )
          : null,
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
