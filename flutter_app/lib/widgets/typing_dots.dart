import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/colors.dart';

/// «يكتب…» — three dots that rise in a wave, in the other speaker's bubble.
///
/// The web's (`typing-dot` in globals.css): 1.2s, each dot 160ms behind the
/// last, up 3px and from 40% to full opacity at the crest. The app had no
/// indicator at all, so for the seconds before her first line, and after
/// every message, the transcript just sat there.
///
/// Still when the system asks for less motion: the dots are drawn solid and
/// nothing repeats, the same thing the web's reduced-motion reset leaves.
class TypingDots extends StatefulWidget {
  final String label;
  final Color color;
  const TypingDots({
    super.key,
    required this.label,
    this.color = WainColors.ink500,
  });

  static const period = Duration(milliseconds: 1200);
  static const stagger = 160 / 1200;

  @override
  State<TypingDots> createState() => _TypingDotsState();
}

class _TypingDotsState extends State<TypingDots>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: TypingDots.period,
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _c.stop();
    } else if (!_c.isAnimating) {
      _c.repeat();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  /// 0 at rest, 1 at the crest — the keyframe's 0%/30%/60% shape: up over
  /// the first 30% of a dot's turn, down by 60%, still for the rest.
  static double crest(double t) {
    final p = t % 1;
    if (p >= 0.6) return 0;
    return math.sin(p / 0.6 * math.pi);
  }

  @override
  Widget build(BuildContext context) {
    final calm = MediaQuery.disableAnimationsOf(context);
    return Semantics(
      label: widget.label,
      liveRegion: true,
      child: ExcludeSemantics(
        child: AnimatedBuilder(
          animation: _c,
          builder: (_, _) => Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (var i = 0; i < 3; i++) ...[
                if (i > 0) const SizedBox(width: 6),
                Builder(
                  builder: (_) {
                    final k = calm
                        ? 1.0
                        : crest(_c.value - i * TypingDots.stagger);
                    return Transform.translate(
                      key: ValueKey('typing-dot-$i'),
                      offset: Offset(0, calm ? 0 : -3 * k),
                      child: Opacity(
                        opacity: calm ? 1 : 0.4 + 0.6 * k,
                        child: Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            color: widget.color,
                            shape: BoxShape.circle,
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// A chat line arriving: 280ms of fade and a 6px rise, once. The web's
/// `bubble-in`. Plays only for a line that is new — the screen marks each
/// entry seen — so scrolling the transcript back does not replay it.
class BubbleIn extends StatelessWidget {
  final bool play;
  final Widget child;
  const BubbleIn({super.key, required this.play, required this.child});

  @override
  Widget build(BuildContext context) {
    if (!play || MediaQuery.disableAnimationsOf(context)) return child;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 280),
      curve: const Cubic(0.2, 0.8, 0.2, 1),
      builder: (_, v, c) => Opacity(
        opacity: v,
        child: Transform.translate(offset: Offset(0, 6 * (1 - v)), child: c),
      ),
      child: child,
    );
  }
}
