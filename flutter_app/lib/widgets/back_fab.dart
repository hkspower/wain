import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../theme/colors.dart';
import 'svg.dart';

/// The round back button every pushed screen carries — the website's
/// BackButton.tsx (asked for on 3 October: «add back button sticky», a
/// floating round button).
///
/// Back when there is something of ours to go back to, otherwise to
/// [fallback]: a place opened from a WhatsApp link has nothing behind it, and
/// the edge swipe and Android's back are no help on a screen that was the
/// first thing opened.
class BackFab extends StatelessWidget {
  const BackFab({super.key, this.fallback = '/'});

  final String fallback;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      key: const ValueKey('back-fab'),
      button: true,
      label: 'رجوع',
      excludeSemantics: true,
      child: Material(
        color: Colors.white,
        shape: const CircleBorder(side: BorderSide(color: Color(0x1A14120F))),
        elevation: 3,
        shadowColor: WainColors.ink900.withValues(alpha: 0.25),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: () => context.canPop() ? context.pop() : context.go(fallback),
          child: SizedBox(
            width: 48,
            height: 48,
            child: Center(
              child: WainSvg.icon('back', size: 22, color: WainColors.ink800),
            ),
          ),
        ),
      ),
    );
  }
}
