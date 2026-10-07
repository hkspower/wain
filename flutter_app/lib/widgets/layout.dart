import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/app_theme.dart';
import '../theme/colors.dart';

/// The page gutter: 10px on a phone, 16px from `sm` — one value each, every
/// route, which is what the site's `audit:padding` asserts.
EdgeInsets pageGutter(BuildContext context, {double vertical = 8}) {
  final wide = MediaQuery.sizeOf(context).width >= 640;
  return EdgeInsets.symmetric(
    horizontal: wide ? 16 : 10,
    vertical: wide ? 12 : vertical,
  );
}

/// Centres content at a readable width on tablets and the web build, and gives
/// it the page gutter.
class PageColumn extends StatelessWidget {
  final double maxWidth;
  final Widget child;
  final EdgeInsets? padding;
  const PageColumn({
    super.key,
    this.maxWidth = 720,
    required this.child,
    this.padding,
  });

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Padding(padding: padding ?? pageGutter(context), child: child),
      ),
    );
  }
}

/// A white panel with the site's card border and shadow.
class Panel extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;
  final Color color;
  const Panel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(12),
    this.color = Colors.white,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(WainRadius.s2xl),
        border: Border.all(color: WainColors.line),
        boxShadow: WainShadows.xs,
      ),
      child: child,
    );
  }
}

/// A tap target of at least 48×48 around a smaller drawing: Android's
/// accessibility guideline, which `meetsGuideline(androidTapTargetGuideline)`
/// measured this app failing on every chip, the hangout times, the call
/// button, the breadcrumb and the map pins. The drawing keeps its size; only
/// the area that answers a finger grows. A tap on the drawing itself is still
/// the inner control's (its ripple), because the innermost recognizer wins
/// the arena; this one only catches the margin.
class HitArea extends StatelessWidget {
  final VoidCallback? onTap;
  final Widget child;
  const HitArea({super.key, required this.onTap, required this.child});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      excludeFromSemantics: true,
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
        child: Center(widthFactor: 1, heightFactor: 1, child: child),
      ),
    );
  }
}

/// A filter chip in the site's two states: ink-filled when on, bordered when off.
class WainChip extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback? onTap;
  final Widget? leading;
  const WainChip({
    super.key,
    required this.label,
    required this.active,
    this.onTap,
    this.leading,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: active,
      enabled: onTap != null,
      child: HitArea(
        onTap: onTap == null
            ? null
            : () {
                HapticFeedback.selectionClick();
                onTap!();
              },
        child: Opacity(
          opacity: onTap == null ? 0.4 : 1,
          child: Material(
            color: active ? WainColors.ink900 : Colors.white,
            shape: StadiumBorder(
              side: active
                  ? BorderSide.none
                  : const BorderSide(color: WainColors.lineControl),
            ),
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: onTap == null
                  ? null
                  : () {
                      HapticFeedback.selectionClick();
                      onTap!();
                    },
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 32),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (leading != null) ...[
                        leading!,
                        const SizedBox(width: 6),
                      ],
                      Text(
                        label,
                        style: wainText(
                          WainText.xs,
                          weight: FontWeight.w600,
                          color: active ? Colors.white : WainColors.ink600,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The site's empty state: dashed panel, compass tile, a line, an action.
class EmptyState extends StatelessWidget {
  final String title;
  final String? body;
  final Widget? action;
  const EmptyState({super.key, required this.title, this.body, this.action});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 16),
      decoration: BoxDecoration(
        color: WainColors.sand100,
        borderRadius: BorderRadius.circular(WainRadius.s3xl),
        border: Border.all(color: WainColors.lineStrong),
      ),
      child: Column(
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: WainColors.sand100,
              borderRadius: BorderRadius.circular(WainRadius.s3xl),
            ),
            child: const Icon(
              Icons.explore_outlined,
              size: 36,
              color: WainColors.sand600,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            title,
            textAlign: TextAlign.center,
            style: wainText(
              WainText.xl,
              weight: FontWeight.w600,
              color: WainColors.ink900,
            ),
          ),
          if (body != null) ...[
            const SizedBox(height: 4),
            Text(
              body!,
              textAlign: TextAlign.center,
              style: wainText(WainText.base, color: WainColors.ink500),
            ),
          ],
          if (action != null) ...[const SizedBox(height: 20), action!],
        ],
      ),
    );
  }
}
